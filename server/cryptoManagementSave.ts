import { FieldValue } from 'firebase-admin/firestore';
import { normalizeCryptoState } from '../src/lib/cryptoClassification.js';
import { planCryptoFundingChanges } from '../src/lib/cryptoFunding.js';
import { checksum, validateState } from './cryptoManagementCore.js';
import { assertRecordedPositions, CryptoMovementConflict } from './cryptoMovementStore.js';
import { validateCryptoInput } from './cryptoManagementErrors.js';
import type { CryptoManagementState } from '../src/types/cryptoManagement';

/** Commit the ledger, cash flow, holdings, asset sync and audit as one transaction. */
export async function commitCryptoManagementSave(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  payload: Record<string, unknown>,
  sync: (next: CryptoManagementState, stored: FirebaseFirestore.QuerySnapshot, previous: CryptoManagementState) => void,
  now = new Date(),
) {
  const operationId = payload.operationId as string;
  const metaRef = ref.collection('cryptoManagement').doc('current');
  const auditRef = ref.collection('cryptoManagementAudit').doc(operationId);
  const openingRef = ref.collection('cryptoMovementOpening').doc('current');
  const [meta, audit, stored, opening] = await Promise.all([tx.get(metaRef), tx.get(auditRef), tx.get(ref.collection('assets')), tx.get(openingRef)]);
  const requestChecksum = checksum(payload);
  if (audit.exists) {
    if (audit.data()?.requestChecksum !== requestChecksum) throw new CryptoMovementConflict('操作 ID 已用於另一個操作。');
    return;
  }
  const previous = meta.data() as CryptoManagementState | undefined;
  if (!previous || payload.expectedVersion !== previous.version) throw new CryptoMovementConflict('資料已被其他操作更新，請重新整理再修改。');
  const reason = payload.reason as string;
  const planned = validateCryptoInput(() => {
    const submitted = normalizeCryptoState(JSON.parse(JSON.stringify(payload.state)) as CryptoManagementState);
    validateState(submitted);
    assertRecordedPositions(previous, submitted, payload.platformRename, payload.stakingRewardLink);
    const next = { ...submitted, version: previous.version + 1, migratedAt: previous.migratedAt, sourceChecksum: previous.sourceChecksum };
    const result = planCryptoFundingChanges(previous, next, reason, now);
    validateState(result.state);
    return result;
  });
  const next = planned.state;
  sync(next, stored, previous);
  tx.set(metaRef, next);
  for (const [index, entry] of planned.entries.entries()) {
    const id = checksum({ operationId, index });
    tx.create(ref.collection('cryptoMovements').doc(id), { ...entry, id });
  }
  if (planned.entries.length && !opening.exists) tx.create(openingRef, { at: now.toISOString(), version: previous.version, positions: previous.positions });
  const imported = (id: string) => /^(funding_|opening_)/.test(id);
  for (const row of next.funding) {
    const old = previous.funding.find(r => r.id === row.id);
    if (old && imported(row.id) && !row.positionId) continue;
    if (!old || checksum(old) !== checksum(row)) {
      tx.set(ref.collection('accountCashFlows').doc(`crypto_funding_${row.id}`), {
        accountSource: 'Crypto', type: row.type, amount: row.hkd || row.usd, currency: row.hkd ? 'HKD' : 'USD',
        date: row.date, note: row.source, managedCrypto: true,
        positionId: row.positionId ?? null, quantity: row.quantity ?? null,
        ...(!old ? { createdAt: FieldValue.serverTimestamp() } : {}), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
  for (const old of previous.funding.filter(r => !next.funding.some(n => n.id === r.id))) {
    if (!imported(old.id) || old.positionId) tx.delete(ref.collection('accountCashFlows').doc(`crypto_funding_${old.id}`));
  }
  tx.create(auditRef, { action: 'save', reason, at: now.toISOString(), version: next.version, previous, next, requestChecksum });
}
