import { aggregate, checksum, validateState } from './cryptoManagementCore.js';
import { CryptoManagementError, validateCryptoInput } from './cryptoManagementErrors.js';
import type { CryptoManagementState, CryptoAssetSyncStatus } from '../src/types/cryptoManagement';

export type CryptoAssetRow = { id: string; data: Record<string, any> };
const iso = (value: unknown) => typeof value === 'string' ? value : (value as { toDate?: () => Date })?.toDate?.().toISOString() ?? '';
const isCrypto = (row: CryptoAssetRow) => row.data.accountSource === 'Crypto' && row.data.assetType === 'crypto';
function canonicalValue(value: any): any {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  return value;
}
// Keep a linked document stable; legacy duplicates choose the newest usable USD quote, then a stable ID.
export function canonicalCryptoAsset(rows: CryptoAssetRow[], symbol: string) {
  return rows.filter(row => isCrypto(row) && row.data.symbol === symbol).sort((a, b) =>
    Number(Boolean(a.data.archivedAt)) - Number(Boolean(b.data.archivedAt)) ||
    Number(!a.data.managedCryptoQuantityChecksum) - Number(!b.data.managedCryptoQuantityChecksum) ||
    Number(!a.data.managedCrypto) - Number(!b.data.managedCrypto) ||
    (Date.parse(iso(b.data.priceAsOf)) || 0) - (Date.parse(iso(a.data.priceAsOf)) || 0) || a.id.localeCompare(b.id),
  )[0];
}
export function cryptoAssetQuotes(rows: CryptoAssetRow[]) {
  const symbols = new Set(rows.filter(row => isCrypto(row) && !row.data.archivedAt).map(row => row.data.symbol as string));
  return Object.fromEntries([...symbols].flatMap(symbol => {
    const row = canonicalCryptoAsset(rows, symbol);
    return row?.data.currency === 'USD' ? [[symbol, { price: row.data.currentPrice as number, at: iso(row.data.priceAsOf) }]] : [];
  }));
}
export function planCryptoAssetSync(state: CryptoManagementState, rows: CryptoAssetRow[], options: {
  previous?: CryptoManagementState; quantityOnly?: boolean; quotes?: Record<string, { price: number; at: string }>; at?: string;
} = {}) {
  const at = options.at ?? new Date().toISOString();
  const quantities = aggregate(state.positions);
  const quantityChecksum = checksum(Object.entries(quantities).sort(([a], [b]) => a.localeCompare(b)));
  const assetsChecksum = checksum(rows.filter(row => row.data.accountSource === 'Crypto' || row.id.startsWith('crypto_')).sort((a, b) => a.id.localeCompare(b.id)).map(row => ({ id: row.id, data: canonicalValue(row.data) })));
  const writes: Array<{ id: string; patch: Record<string, unknown>; before: Record<string, any> | null }> = [];
  const differences: CryptoAssetSyncStatus['differences'] = [];
  const conflicts: string[] = [];
  const chosen = new Set<string>();
  for (const coin of state.coins) {
    const existing = canonicalCryptoAsset(rows, coin.symbol);
    const id = existing?.id ?? `crypto_${coin.symbol}`;
    const old = existing?.data;
    const quantity = quantities[coin.symbol] ?? 0;
    const collision = !existing && rows.some(row => row.id === id);
    if (collision || (old && old.currency !== 'USD')) {
      conflicts.push(`${coin.symbol} 資產資料需核對，不能自動覆蓋幣別或其他帳戶。`);
      differences.push({ symbol: coin.symbol, expectedQuantity: quantity, assetQuantity: old?.quantity ?? null, reason: '資產資料衝突' });
      continue;
    }
    chosen.add(id);
    const patch: Record<string, unknown> = { name: coin.name, symbol: coin.symbol, accountSource: 'Crypto', assetType: 'crypto', currency: 'USD', quantity, managedCrypto: true, managedManualPrice: coin.priceSource === 'manual', managedCryptoVersion: state.version, managedCryptoQuantityChecksum: quantityChecksum, archivedAt: quantity > 0 ? null : old?.archivedAt ?? at };
    if (!old) Object.assign(patch, { averageCost: 0, currentPrice: 0, priceAsOf: null });
    if (!options.quantityOnly) {
      const quote = options.quotes?.[coin.symbol];
      const previousCoin = options.previous?.coins.find(c => c.symbol === coin.symbol);
      const changedSource = previousCoin && (previousCoin.priceSource !== coin.priceSource || previousCoin.priceSourceId !== coin.priceSourceId);
      if (coin.priceSource === 'manual') Object.assign(patch, { currentPrice: coin.manualPriceUsd ?? 0, priceAsOf: coin.manualPriceAt ?? null });
      else if (quote) Object.assign(patch, { currentPrice: quote.price, priceAsOf: quote.at, lastPriceUpdatedAt: at });
      else if (changedSource) Object.assign(patch, { currentPrice: 0, priceAsOf: null });
    }
    if (!old || old.quantity !== quantity || Boolean(old.archivedAt) !== (quantity === 0) || !old.managedCrypto || old.managedCryptoVersion !== state.version || old.managedCryptoQuantityChecksum !== quantityChecksum) {
      differences.push({ symbol: coin.symbol, expectedQuantity: quantity, assetQuantity: old?.quantity ?? null, reason: !old ? '缺少對應資產' : old.quantity !== quantity ? '數量不一致' : '同步版本待核對' });
    }
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => !old || JSON.stringify(old[key]) !== JSON.stringify(value)));
    if (Object.keys(changed).length) writes.push({ id, patch: changed, before: old ?? null });
  }
  for (const row of rows.filter(row => isCrypto(row) && !row.data.archivedAt && !chosen.has(row.id))) {
    if (conflicts.length) continue;
    writes.push({ id: row.id, patch: { archivedAt: at, managedCrypto: true, migrationRetired: true }, before: row.data });
    differences.push({ symbol: row.data.symbol, expectedQuantity: quantities[row.data.symbol] ?? 0, assetQuantity: row.data.quantity, reason: '重複或不屬於平台持倉的資產' });
  }
  const status: CryptoAssetSyncStatus = { status: differences.length || conflicts.length ? 'pending' : 'synced', version: state.version, checkedAt: at, coinCount: state.coins.length, checksum: assetsChecksum, differences, conflicts };
  return { writes, status, quantityChecksum };
}

export class CryptoAssetSyncConflict extends Error {}
export async function commitCryptoAssetReconciliation(tx: FirebaseFirestore.Transaction, refs: {
  meta: FirebaseFirestore.DocumentReference; audit: FirebaseFirestore.DocumentReference; assets: FirebaseFirestore.CollectionReference;
}, payload: Record<string, unknown>, at = new Date().toISOString()) {
  const [meta, audit, assets] = await Promise.all([tx.get(refs.meta), tx.get(refs.audit), tx.get(refs.assets)]);
  const requestChecksum = checksum(payload);
  if (audit.exists) {
    if (audit.data()?.requestChecksum !== requestChecksum) throw new CryptoAssetSyncConflict('操作 ID 已用於另一筆同步。');
    return;
  }
  const state = meta.data() as CryptoManagementState | undefined;
  if (!state || state.version !== payload.expectedVersion) throw new CryptoAssetSyncConflict('平台持倉已更新，請重新核對再同步。');
  validateCryptoInput(() => validateState(structuredClone(state)));
  const plan = validateCryptoInput(() => planCryptoAssetSync(state, assets.docs.map(doc => ({ id: doc.id, data: doc.data() })), { quantityOnly: true, at }));
  if (plan.status.checksum !== payload.expectedAssetsChecksum) throw new CryptoAssetSyncConflict('資產或價格已更新，請重新核對再同步。');
  if (plan.status.conflicts.length) throw new CryptoManagementError(plan.status.conflicts.join('；'));
  for (const write of plan.writes) tx.set(refs.assets.doc(write.id), { ...write.patch, updatedAt: at }, { merge: true });
  tx.create(refs.audit, { action: 'reconcile-assets', reason: '以平台持倉核對並同步資產大表數量；保留既有價格和歷史', at, version: state.version, requestChecksum, quantityChecksum: plan.quantityChecksum, changedCount: plan.writes.length, changes: plan.writes });
}
