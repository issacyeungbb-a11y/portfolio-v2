import { randomUUID } from 'node:crypto';
import { checksum, monthlyMetrics, valueCrypto } from './cryptoManagementCore.js';
import { cryptoAssetQuotes } from './cryptoAssetSync.js';
import { CryptoManagementError } from './cryptoManagementErrors.js';
import { normalizeCryptoState } from '../src/lib/cryptoClassification.js';
import type { CryptoManagementState } from '../src/types/cryptoManagement';

const iso = (value: unknown) => typeof value === 'string' ? value : (value as { toDate?: () => Date })?.toDate?.().toISOString() ?? '';

// Called only by the protected manual close action. Quantities always come from platform positions.
export async function commitManualCryptoMonth(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, expectedVersion: unknown, now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const month = date.slice(0, 7);
  const snapshotRef = ref.collection('cryptoMonthlySnapshots').doc(`monthly-${month}`);
  const [meta, existing, stored, portfolio, snapshots] = await Promise.all([
    tx.get(ref.collection('cryptoManagement').doc('current')), tx.get(snapshotRef),
    tx.get(ref.collection('assets')), tx.get(ref),
    tx.get(ref.collection('cryptoMonthlySnapshots').where('month', '<', month).orderBy('month', 'desc').limit(1)),
  ]);
  if (!meta.exists) return { status: 'not-migrated' };
  if (existing.exists) return { status: 'locked', month };
  const state = normalizeCryptoState(meta.data() as CryptoManagementState);
  if (expectedVersion !== state.version) throw new CryptoManagementError('平台持倉已更新，請重新整理再月結。', 409);
  const valuation = valueCrypto(state, cryptoAssetQuotes(stored.docs.map(doc => ({ id: doc.id, data: doc.data() }))), now.getTime());
  const fxData = portfolio.data()?.fxRates;
  const fx = fxData?.USD;
  const fxAt = Date.parse(iso(fxData?.updatedAt));
  const warnings = [...valuation.warnings];
  if (!Number.isFinite(fx) || !(fx > 0) || !Number.isFinite(fxAt) || now.getTime() - fxAt > 48 * 3600000 || fxAt > now.getTime() + 300000) warnings.push('港元匯率待更新');
  const draftRef = ref.collection('cryptoMonthlyDrafts').doc(month);
  if (warnings.length) {
    tx.set(draftRef, { month, warnings, valuation, managementVersion: state.version, updatedAt: now.toISOString() });
    return { status: 'blocked', month, warnings };
  }
  const previousSnapshot = snapshots.docs[0]?.data();
  const metrics = monthlyMetrics(valuation, fx, previousSnapshot?.currentNetUsd ?? previousSnapshot?.performanceTotalUsd ?? null);
  const allocations: Record<string, number> = { BTC: 0, ETH: 0, ADA: 0, USDT: 0, OTHER: 0 };
  const values = Object.fromEntries(Object.entries(valuation.quantities).map(([symbol, quantity]) => [symbol, quantity * (valuation.prices[symbol] ?? 0)]));
  for (const debt of state.liabilities) {
    const symbol = debt.collateralSymbol || debt.symbol;
    values[symbol] = (values[symbol] ?? 0) - debt.quantity * (valuation.prices[debt.symbol] ?? 0);
  }
  for (const [symbol, value] of Object.entries(values)) allocations[symbol in allocations ? symbol : 'OTHER'] += valuation.netUsd ? value / valuation.netUsd : 0;
  const platforms = new Map<string, number>();
  for (const position of state.positions) platforms.set(position.custodian, (platforms.get(position.custodian) ?? 0) + position.quantity * (valuation.prices[position.symbol] ?? 0));
  const at = now.toISOString();
  tx.create(snapshotRef, {
    month, snapshotDate: date, snapshotTimestamp: at, locked: true, ...metrics,
    btcEquivalent: valuation.prices.BTC ? valuation.netUsd / valuation.prices.BTC : null,
    usdHkdRate: fx, allocations,
    historicalHoldings: [...platforms].map(([platform, valueUsd]) => ({ rawLabel: platform, normalizedLabel: platform, valueUsd })),
    historicalQuantities: state.positions.map(p => ({ rawLabel: p.id, symbol: p.symbol, platform: p.custodian, status: p.status, quantity: p.quantity })),
    prices: Object.entries(valuation.prices).filter(([, price]) => price !== null).map(([symbol, priceUsd]) => ({ rawLabel: symbol, symbol, priceUsd })),
    liabilities: state.liabilities.map(p => ({ ...p, platform: p.custodian })),
    sourceType: 'system_management', sourceSpreadsheetId: '', sourceSpreadsheetTitle: '', sourceSheet: '', sourceRange: '', importBatchId: '',
    importedAt: at, updatedAt: at, sourceChecksum: checksum({ state, valuation, fx }),
    dataQuality: 'verified', warnings: [],
    rawSourceValues: { managementVersion: state.version, valuationBasis: 'net_assets_withdrawals_separate', closingMode: 'manual' },
    managementState: state,
  });
  tx.delete(draftRef);
  tx.create(ref.collection('cryptoManagementAudit').doc(randomUUID()), { action: 'close-month', reason: '按平台持倉手動執行當月月結', at, version: state.version, month });
  return { status: 'created', month };
}
