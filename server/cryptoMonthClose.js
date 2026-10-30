import { randomUUID } from "node:crypto";
import { checksum, monthlyMetrics, valueCrypto } from "./cryptoManagementCore.js";
import { cryptoAssetQuotes } from "./cryptoAssetSync.js";
import { CryptoManagementError } from "./cryptoManagementErrors.js";
import { normalizeCryptoState } from "../src/lib/cryptoClassification.js";
const iso = (value) => typeof value === "string" ? value : value?.toDate?.().toISOString() ?? "";
async function commitManualCryptoMonth(tx, ref, expectedVersion, now = /* @__PURE__ */ new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const month = date.slice(0, 7);
  const snapshotRef = ref.collection("cryptoMonthlySnapshots").doc(`monthly-${month}`);
  const [meta, existing, stored, portfolio, snapshots] = await Promise.all([
    tx.get(ref.collection("cryptoManagement").doc("current")),
    tx.get(snapshotRef),
    tx.get(ref.collection("assets")),
    tx.get(ref),
    tx.get(ref.collection("cryptoMonthlySnapshots").where("month", "<", month).orderBy("month", "desc").limit(1))
  ]);
  if (!meta.exists) return { status: "not-migrated" };
  if (existing.exists) return { status: "locked", month };
  const state = normalizeCryptoState(meta.data());
  if (expectedVersion !== state.version) throw new CryptoManagementError("\u5E73\u53F0\u6301\u5009\u5DF2\u66F4\u65B0\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u518D\u6708\u7D50\u3002", 409);
  const valuation = valueCrypto(state, cryptoAssetQuotes(stored.docs.map((doc) => ({ id: doc.id, data: doc.data() }))), now.getTime());
  const fxData = portfolio.data()?.fxRates;
  const fx = fxData?.USD;
  const fxAt = Date.parse(iso(fxData?.updatedAt));
  const warnings = [...valuation.warnings];
  if (!Number.isFinite(fx) || !(fx > 0) || !Number.isFinite(fxAt) || now.getTime() - fxAt > 48 * 36e5 || fxAt > now.getTime() + 3e5) warnings.push("\u6E2F\u5143\u532F\u7387\u5F85\u66F4\u65B0");
  const draftRef = ref.collection("cryptoMonthlyDrafts").doc(month);
  if (warnings.length) {
    tx.set(draftRef, { month, warnings, valuation, managementVersion: state.version, updatedAt: now.toISOString() });
    return { status: "blocked", month, warnings };
  }
  const previousSnapshot = snapshots.docs[0]?.data();
  const metrics = monthlyMetrics(valuation, fx, previousSnapshot?.currentNetUsd ?? previousSnapshot?.performanceTotalUsd ?? null);
  const allocations = { BTC: 0, ETH: 0, ADA: 0, USDT: 0, OTHER: 0 };
  const values = Object.fromEntries(Object.entries(valuation.quantities).map(([symbol, quantity]) => [symbol, quantity * (valuation.prices[symbol] ?? 0)]));
  for (const debt of state.liabilities) {
    const symbol = debt.collateralSymbol || debt.symbol;
    values[symbol] = (values[symbol] ?? 0) - debt.quantity * (valuation.prices[debt.symbol] ?? 0);
  }
  for (const [symbol, value] of Object.entries(values)) allocations[symbol in allocations ? symbol : "OTHER"] += valuation.netUsd ? value / valuation.netUsd : 0;
  const platforms = /* @__PURE__ */ new Map();
  for (const position of state.positions) platforms.set(position.custodian, (platforms.get(position.custodian) ?? 0) + position.quantity * (valuation.prices[position.symbol] ?? 0));
  const at = now.toISOString();
  tx.create(snapshotRef, {
    month,
    snapshotDate: date,
    snapshotTimestamp: at,
    locked: true,
    ...metrics,
    btcEquivalent: valuation.prices.BTC ? valuation.netUsd / valuation.prices.BTC : null,
    usdHkdRate: fx,
    allocations,
    historicalHoldings: [...platforms].map(([platform, valueUsd]) => ({ rawLabel: platform, normalizedLabel: platform, valueUsd })),
    historicalQuantities: state.positions.map((p) => ({ rawLabel: p.id, symbol: p.symbol, platform: p.custodian, status: p.status, quantity: p.quantity })),
    prices: Object.entries(valuation.prices).filter(([, price]) => price !== null).map(([symbol, priceUsd]) => ({ rawLabel: symbol, symbol, priceUsd })),
    liabilities: state.liabilities.map((p) => ({ ...p, platform: p.custodian })),
    sourceType: "system_management",
    sourceSpreadsheetId: "",
    sourceSpreadsheetTitle: "",
    sourceSheet: "",
    sourceRange: "",
    importBatchId: "",
    importedAt: at,
    updatedAt: at,
    sourceChecksum: checksum({ state, valuation, fx }),
    dataQuality: "verified",
    warnings: [],
    rawSourceValues: { managementVersion: state.version, valuationBasis: "net_assets_withdrawals_separate", closingMode: "manual" },
    managementState: state
  });
  tx.delete(draftRef);
  tx.create(ref.collection("cryptoManagementAudit").doc(randomUUID()), { action: "close-month", reason: "\u6309\u5E73\u53F0\u6301\u5009\u624B\u52D5\u57F7\u884C\u7576\u6708\u6708\u7D50", at, version: state.version, month });
  return { status: "created", month };
}
export {
  commitManualCryptoMonth
};
