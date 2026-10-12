import { aggregate, checksum, validateState } from "./cryptoManagementCore.js";
import { CryptoManagementError, validateCryptoInput } from "./cryptoManagementErrors.js";
const iso = (value) => typeof value === "string" ? value : value?.toDate?.().toISOString() ?? "";
const isCrypto = (row) => row.data.accountSource === "Crypto" && row.data.assetType === "crypto";
function canonicalValue(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}
function canonicalCryptoAsset(rows, symbol) {
  return rows.filter((row) => isCrypto(row) && row.data.symbol === symbol).sort(
    (a, b) => Number(Boolean(a.data.archivedAt)) - Number(Boolean(b.data.archivedAt)) || Number(!a.data.managedCryptoQuantityChecksum) - Number(!b.data.managedCryptoQuantityChecksum) || Number(!a.data.managedCrypto) - Number(!b.data.managedCrypto) || (Date.parse(iso(b.data.priceAsOf)) || 0) - (Date.parse(iso(a.data.priceAsOf)) || 0) || a.id.localeCompare(b.id)
  )[0];
}
function cryptoAssetQuotes(rows) {
  const symbols = new Set(rows.filter((row) => isCrypto(row) && !row.data.archivedAt).map((row) => row.data.symbol));
  return Object.fromEntries([...symbols].flatMap((symbol) => {
    const row = canonicalCryptoAsset(rows, symbol);
    return row?.data.currency === "USD" ? [[symbol, { price: row.data.currentPrice, at: iso(row.data.priceAsOf) }]] : [];
  }));
}
function planCryptoAssetSync(state, rows, options = {}) {
  const at = options.at ?? (/* @__PURE__ */ new Date()).toISOString();
  const quantities = aggregate(state.positions);
  const quantityChecksum = checksum(Object.entries(quantities).sort(([a], [b]) => a.localeCompare(b)));
  const assetsChecksum = checksum(rows.filter((row) => row.data.accountSource === "Crypto" || row.id.startsWith("crypto_")).sort((a, b) => a.id.localeCompare(b.id)).map((row) => ({ id: row.id, data: canonicalValue(row.data) })));
  const writes = [];
  const differences = [];
  const conflicts = [];
  const chosen = /* @__PURE__ */ new Set();
  for (const coin of state.coins) {
    const existing = canonicalCryptoAsset(rows, coin.symbol);
    const id = existing?.id ?? `crypto_${coin.symbol}`;
    const old = existing?.data;
    const quantity = quantities[coin.symbol] ?? 0;
    const collision = !existing && rows.some((row) => row.id === id);
    if (collision || old && old.currency !== "USD") {
      conflicts.push(`${coin.symbol} \u8CC7\u7522\u8CC7\u6599\u9700\u6838\u5C0D\uFF0C\u4E0D\u80FD\u81EA\u52D5\u8986\u84CB\u5E63\u5225\u6216\u5176\u4ED6\u5E33\u6236\u3002`);
      differences.push({ symbol: coin.symbol, expectedQuantity: quantity, assetQuantity: old?.quantity ?? null, reason: "\u8CC7\u7522\u8CC7\u6599\u885D\u7A81" });
      continue;
    }
    chosen.add(id);
    const patch = { name: coin.name, symbol: coin.symbol, accountSource: "Crypto", assetType: "crypto", currency: "USD", quantity, managedCrypto: true, managedManualPrice: coin.priceSource === "manual", managedCryptoVersion: state.version, managedCryptoQuantityChecksum: quantityChecksum, archivedAt: quantity > 0 ? null : old?.archivedAt ?? at };
    if (!old) Object.assign(patch, { averageCost: 0, currentPrice: 0, priceAsOf: null });
    if (!options.quantityOnly) {
      const quote = options.quotes?.[coin.symbol];
      const previousCoin = options.previous?.coins.find((c) => c.symbol === coin.symbol);
      const changedSource = previousCoin && (previousCoin.priceSource !== coin.priceSource || previousCoin.priceSourceId !== coin.priceSourceId);
      if (coin.priceSource === "manual") Object.assign(patch, { currentPrice: coin.manualPriceUsd ?? 0, priceAsOf: coin.manualPriceAt ?? null });
      else if (quote) Object.assign(patch, { currentPrice: quote.price, priceAsOf: quote.at, lastPriceUpdatedAt: at });
      else if (changedSource) Object.assign(patch, { currentPrice: 0, priceAsOf: null });
    }
    if (!old || old.quantity !== quantity || Boolean(old.archivedAt) !== (quantity === 0) || !old.managedCrypto || old.managedCryptoVersion !== state.version || old.managedCryptoQuantityChecksum !== quantityChecksum) {
      differences.push({ symbol: coin.symbol, expectedQuantity: quantity, assetQuantity: old?.quantity ?? null, reason: !old ? "\u7F3A\u5C11\u5C0D\u61C9\u8CC7\u7522" : old.quantity !== quantity ? "\u6578\u91CF\u4E0D\u4E00\u81F4" : "\u540C\u6B65\u7248\u672C\u5F85\u6838\u5C0D" });
    }
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => !old || JSON.stringify(old[key]) !== JSON.stringify(value)));
    if (Object.keys(changed).length) writes.push({ id, patch: changed, before: old ?? null });
  }
  for (const row of rows.filter((row2) => isCrypto(row2) && !row2.data.archivedAt && !chosen.has(row2.id))) {
    if (conflicts.length) continue;
    writes.push({ id: row.id, patch: { archivedAt: at, managedCrypto: true, migrationRetired: true }, before: row.data });
    differences.push({ symbol: row.data.symbol, expectedQuantity: quantities[row.data.symbol] ?? 0, assetQuantity: row.data.quantity, reason: "\u91CD\u8907\u6216\u4E0D\u5C6C\u65BC\u5E73\u53F0\u6301\u5009\u7684\u8CC7\u7522" });
  }
  const status = { status: differences.length || conflicts.length ? "pending" : "synced", version: state.version, checkedAt: at, coinCount: state.coins.length, checksum: assetsChecksum, differences, conflicts };
  return { writes, status, quantityChecksum };
}
class CryptoAssetSyncConflict extends Error {
}
async function commitCryptoAssetReconciliation(tx, refs, payload, at = (/* @__PURE__ */ new Date()).toISOString()) {
  const [meta, audit, assets] = await Promise.all([tx.get(refs.meta), tx.get(refs.audit), tx.get(refs.assets)]);
  const requestChecksum = checksum(payload);
  if (audit.exists) {
    if (audit.data()?.requestChecksum !== requestChecksum) throw new CryptoAssetSyncConflict("\u64CD\u4F5C ID \u5DF2\u7528\u65BC\u53E6\u4E00\u7B46\u540C\u6B65\u3002");
    return;
  }
  const state = meta.data();
  if (!state || state.version !== payload.expectedVersion) throw new CryptoAssetSyncConflict("\u5E73\u53F0\u6301\u5009\u5DF2\u66F4\u65B0\uFF0C\u8ACB\u91CD\u65B0\u6838\u5C0D\u518D\u540C\u6B65\u3002");
  validateCryptoInput(() => validateState(structuredClone(state)));
  const plan = validateCryptoInput(() => planCryptoAssetSync(state, assets.docs.map((doc) => ({ id: doc.id, data: doc.data() })), { quantityOnly: true, at }));
  if (plan.status.checksum !== payload.expectedAssetsChecksum) throw new CryptoAssetSyncConflict("\u8CC7\u7522\u6216\u50F9\u683C\u5DF2\u66F4\u65B0\uFF0C\u8ACB\u91CD\u65B0\u6838\u5C0D\u518D\u540C\u6B65\u3002");
  if (plan.status.conflicts.length) throw new CryptoManagementError(plan.status.conflicts.join("\uFF1B"));
  for (const write of plan.writes) tx.set(refs.assets.doc(write.id), { ...write.patch, updatedAt: at }, { merge: true });
  tx.create(refs.audit, { action: "reconcile-assets", reason: "\u4EE5\u5E73\u53F0\u6301\u5009\u6838\u5C0D\u4E26\u540C\u6B65\u8CC7\u7522\u5927\u8868\u6578\u91CF\uFF1B\u4FDD\u7559\u65E2\u6709\u50F9\u683C\u548C\u6B77\u53F2", at, version: state.version, requestChecksum, quantityChecksum: plan.quantityChecksum, changedCount: plan.writes.length, changes: plan.writes });
}
export {
  CryptoAssetSyncConflict,
  canonicalCryptoAsset,
  commitCryptoAssetReconciliation,
  cryptoAssetQuotes,
  planCryptoAssetSync
};
