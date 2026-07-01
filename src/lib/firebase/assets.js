import {
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch
} from "firebase/firestore";
import { getEffectiveHoldingPrice } from "../portfolio/priceValidity";
import { hasFirebaseConfig, missingFirebaseEnvKeys } from "./client";
import { callPortfolioFunction } from "../api/vercelFunctions";
import {
  getSharedAssetTransactionsCollectionRef,
  getSharedAssetsCollectionRef
} from "./sharedPortfolio";
function createMissingConfigError() {
  return new Error(
    `Missing Firebase env vars: ${missingFirebaseEnvKeys.join(", ")}`
  );
}
function normalizePortfolioAssetInput(payload) {
  const normalizedCurrency = payload.currency.trim().toUpperCase();
  const normalizedQuantity = Number(payload.quantity) || 0;
  const normalizedAverageCost = Number(payload.averageCost) || 0;
  const normalizedCurrentPrice = Number(payload.currentPrice) || 0;
  if (payload.assetType === "cash") {
    const cashAmount = normalizedCurrentPrice || normalizedAverageCost || normalizedQuantity || 0;
    return {
      name: payload.name.trim(),
      symbol: payload.symbol.trim().toUpperCase(),
      assetType: payload.assetType,
      accountSource: payload.accountSource,
      currency: normalizedCurrency,
      quantity: 1,
      averageCost: cashAmount,
      currentPrice: cashAmount
    };
  }
  return {
    name: payload.name.trim(),
    symbol: payload.symbol.trim().toUpperCase(),
    assetType: payload.assetType,
    accountSource: payload.accountSource,
    currency: normalizedCurrency,
    quantity: normalizedQuantity,
    averageCost: normalizedAverageCost,
    currentPrice: normalizedCurrentPrice
  };
}
function formatTimestamp(value) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value && typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1e3).toISOString();
  }
  return typeof value === "string" ? value : "";
}
function isClosedNonCashPosition(holding) {
  return holding.assetType !== "cash" && !(holding.quantity > 0);
}
function normalizeTickerList(values) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}
function queueCoinGeckoSync(tickers) {
  const cryptoTickers = normalizeTickerList(tickers);
  if (cryptoTickers.length === 0) {
    return;
  }
  void callPortfolioFunction("update-prices", { syncTickers: cryptoTickers }).catch((error) => {
    console.warn("\u80CC\u666F CoinGecko \u4EE3\u865F\u540C\u6B65\u5931\u6557\u3002", error);
  });
}
function buildHoldingFromInput(id, payload) {
  const normalized = normalizePortfolioAssetInput(payload);
  const effectiveCurrentPrice = getEffectiveHoldingPrice({
    id,
    ...normalized,
    marketValue: 0,
    unrealizedPnl: 0,
    unrealizedPct: 0,
    allocation: 0,
    priceAsOf: formatTimestamp(payload.priceAsOf),
    lastPriceUpdatedAt: formatTimestamp(payload.lastPriceUpdatedAt)
  });
  const marketValue = normalized.assetType === "cash" ? effectiveCurrentPrice : normalized.quantity * effectiveCurrentPrice;
  const costBasis = normalized.assetType === "cash" ? normalized.averageCost : normalized.quantity * normalized.averageCost;
  const unrealizedPnl = marketValue - costBasis;
  const unrealizedPct = costBasis === 0 ? 0 : unrealizedPnl / costBasis * 100;
  return {
    id,
    ...normalized,
    currentPrice: effectiveCurrentPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    allocation: 0,
    priceAsOf: formatTimestamp(payload.priceAsOf),
    lastPriceUpdatedAt: formatTimestamp(payload.lastPriceUpdatedAt),
    archivedAt: formatTimestamp(payload.archivedAt)
  };
}
function recalculateHoldingAllocations(holdings, getHoldingValue = (holding) => holding.marketValue) {
  const totalValue = holdings.reduce((sum, holding) => sum + getHoldingValue(holding), 0);
  return holdings.map((holding) => ({
    ...holding,
    allocation: totalValue === 0 ? 0 : getHoldingValue(holding) / totalValue * 100
  }));
}
function getFirebaseAssetsErrorMessage(error) {
  if (!hasFirebaseConfig) {
    return `Firebase \u5C1A\u672A\u8A2D\u5B9A\u5B8C\u6210\uFF0C\u8ACB\u5148\u586B\u5165 .env.local \u6216 .env \u5167\u7684\u8A2D\u5B9A\u503C\uFF1A${missingFirebaseEnvKeys.join(", ")}`;
  }
  if (error instanceof Error) {
    if (error.message.includes("permission-denied")) {
      return "Firestore \u6B0A\u9650\u88AB\u62D2\u7D55\uFF0C\u8ACB\u78BA\u8A8D rules \u5DF2\u5BB9\u8A31\u5171\u4EAB\u6295\u8CC7\u7D44\u5408\u8B80\u5BEB `portfolio/app/assets`\u3002";
    }
    return error.message;
  }
  return "\u8B80\u53D6\u6216\u5BEB\u5165\u8CC7\u7522\u8CC7\u6599\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002";
}
function subscribeToPortfolioAssets(onData, onError) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }
  const assetsRef = getSharedAssetsCollectionRef();
  const assetsQuery = query(assetsRef, orderBy("updatedAt", "desc"));
  return onSnapshot(
    assetsQuery,
    (snapshot) => {
      const holdings = snapshot.docs.map(
        (document) => buildHoldingFromInput(document.id, document.data())
      );
      onData(
        holdings.filter(
          (holding) => !holding.archivedAt && !isClosedNonCashPosition(holding)
        )
      );
    },
    onError
  );
}
function subscribeToAllPortfolioAssets(onData, onError) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }
  const assetsRef = getSharedAssetsCollectionRef();
  const assetsQuery = query(assetsRef, orderBy("updatedAt", "desc"));
  return onSnapshot(
    assetsQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map(
          (document) => buildHoldingFromInput(document.id, document.data())
        )
      );
    },
    onError
  );
}
async function createPortfolioAsset(payload) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }
  const normalized = normalizePortfolioAssetInput(payload);
  const createdHolding = buildHoldingFromInput("pending", normalized);
  const assetsCollection = getSharedAssetsCollectionRef();
  const assetRef = doc(assetsCollection);
  const txRef = doc(getSharedAssetTransactionsCollectionRef());
  const batch = writeBatch(assetsCollection.firestore);
  batch.set(assetRef, {
    ...normalized,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  if (createdHolding.quantity > 0) {
    batch.set(txRef, {
      assetId: assetRef.id,
      assetName: normalized.name,
      symbol: normalized.symbol,
      assetType: normalized.assetType,
      accountSource: normalized.accountSource,
      transactionType: "buy",
      recordType: "seed",
      quantity: normalized.quantity,
      price: normalized.averageCost,
      fees: 0,
      currency: normalized.currency,
      date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      realizedPnlHKD: 0,
      quantityAfter: normalized.quantity,
      averageCostAfter: normalized.averageCost,
      note: "\u65B0\u589E\u8CC7\u7522",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } else {
    batch.set(txRef, {
      assetId: assetRef.id,
      assetName: normalized.name,
      symbol: normalized.symbol,
      assetType: normalized.assetType,
      accountSource: normalized.accountSource,
      transactionType: "buy",
      recordType: "asset_created",
      quantity: 0,
      price: 0,
      fees: 0,
      currency: normalized.currency,
      date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      realizedPnlHKD: 0,
      quantityAfter: 0,
      averageCostAfter: 0,
      note: "\u65B0\u589E\u8CC7\u7522",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
  if (normalized.assetType === "crypto") {
    queueCoinGeckoSync([normalized.symbol]);
  }
  return assetRef.id;
}
async function createPortfolioAssets(payloads) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }
  const assetsCollection = getSharedAssetsCollectionRef();
  const batch = writeBatch(assetsCollection.firestore);
  for (const payload of payloads) {
    const normalized = normalizePortfolioAssetInput(payload);
    const assetRef = doc(assetsCollection);
    batch.set(assetRef, {
      ...normalized,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    if (normalized.quantity > 0) {
      const transactionRef = doc(getSharedAssetTransactionsCollectionRef());
      batch.set(transactionRef, {
        assetId: assetRef.id,
        assetName: normalized.name,
        symbol: normalized.symbol,
        assetType: normalized.assetType,
        accountSource: normalized.accountSource,
        transactionType: "buy",
        recordType: "seed",
        quantity: normalized.quantity,
        price: normalized.averageCost,
        fees: 0,
        currency: normalized.currency,
        date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        realizedPnlHKD: 0,
        quantityAfter: normalized.quantity,
        averageCostAfter: normalized.averageCost,
        note: "\u65B0\u589E\u8CC7\u7522",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      const transactionRef = doc(getSharedAssetTransactionsCollectionRef());
      batch.set(transactionRef, {
        assetId: assetRef.id,
        assetName: normalized.name,
        symbol: normalized.symbol,
        assetType: normalized.assetType,
        accountSource: normalized.accountSource,
        transactionType: "buy",
        recordType: "asset_created",
        quantity: 0,
        price: 0,
        fees: 0,
        currency: normalized.currency,
        date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        realizedPnlHKD: 0,
        quantityAfter: 0,
        averageCostAfter: 0,
        note: "\u65B0\u589E\u8CC7\u7522",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  }
  await batch.commit();
  queueCoinGeckoSync(
    payloads.filter((payload) => payload.assetType === "crypto").map((payload) => payload.symbol)
  );
}
async function updatePortfolioAsset(assetId, payload) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }
  const normalized = normalizePortfolioAssetInput(payload);
  const assetRef = doc(getSharedAssetsCollectionRef(), assetId);
  await updateDoc(assetRef, {
    ...normalized,
    updatedAt: serverTimestamp()
  });
  if (normalized.assetType === "crypto") {
    queueCoinGeckoSync([normalized.symbol]);
  }
}
async function deletePortfolioAsset(assetId) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }
  const assetRef = doc(getSharedAssetsCollectionRef(), assetId);
  await updateDoc(assetRef, {
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}
export {
  buildHoldingFromInput,
  createPortfolioAsset,
  createPortfolioAssets,
  deletePortfolioAsset,
  getFirebaseAssetsErrorMessage,
  recalculateHoldingAllocations,
  subscribeToAllPortfolioAssets,
  subscribeToPortfolioAssets,
  updatePortfolioAsset
};
