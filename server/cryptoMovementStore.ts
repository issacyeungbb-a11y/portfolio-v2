import { planCryptoMovement } from '../src/lib/cryptoMovements.js';
import { saveCryptoPlatform } from '../src/lib/cryptoPlatforms.js';
import { checksum, validateState } from './cryptoManagementCore.js';
import { normalizeCryptoState, linkStakingReward } from '../src/lib/cryptoClassification.js';
import type { CryptoManagementState, CryptoMovementInput, CryptoPosition } from '../src/types/cryptoManagement';

export function assertRecordedPositions(previous: CryptoManagementState, next: CryptoManagementState, rename?: unknown, stakingRewardLink?: unknown) {
  let expected = normalizeCryptoState(previous);
  if (rename !== undefined) {
    const r = rename as { previousName?: string; name?: string };
    if (!r || typeof r.previousName !== 'string' || typeof r.name !== 'string') throw new Error('平台改名格式不正確。');
    expected = saveCryptoPlatform(expected, r.name, r.previousName);
  }
  if (stakingRewardLink !== undefined) {
    const link = stakingRewardLink as { positionId?: string; parentId?: string };
    if (!link || typeof link.positionId !== 'string' || typeof link.parentId !== 'string') throw new Error('質押收益關聯格式不正確。');
    expected = linkStakingReward(expected, link.positionId, link.parentId);
  }
  const canonical = (rows: CryptoPosition[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id)).map(p => ({ id: p.id, symbol: p.symbol, custodian: p.custodian, quantity: p.quantity, status: p.status, network: p.network, collateralSymbol: p.collateralSymbol, stakingPositionId: p.stakingPositionId ?? '' }));
  if (checksum(canonical(expected.positions)) !== checksum(canonical(normalizeCryptoState(next).positions))) throw new Error('持倉數量、平台及鎖定狀態請透過 Crypto 變動記錄交易或轉移。');
}

export class CryptoMovementConflict extends Error {}
type Ref = FirebaseFirestore.DocumentReference;
export async function commitCryptoMovement(
  tx: FirebaseFirestore.Transaction,
  refs: { meta: Ref; movement: Ref; audit: Ref; opening: Ref; assets: FirebaseFirestore.CollectionReference },
  payload: Record<string, unknown>,
  sync: (state: CryptoManagementState, stored: FirebaseFirestore.QuerySnapshot, previous: CryptoManagementState) => void,
  now = new Date(),
) {
  const [meta, completed, stored, opening] = await Promise.all([tx.get(refs.meta), tx.get(refs.audit), tx.get(refs.assets), tx.get(refs.opening)]);
  const requestChecksum = checksum(payload);
  if (completed.exists) {
    if (completed.data()?.requestChecksum !== requestChecksum) throw new CryptoMovementConflict('操作 ID 已用於另一筆往來。');
    return;
  }
  const previous = meta.data() as CryptoManagementState | undefined;
  if (!previous || previous.version !== payload.expectedVersion) throw new CryptoMovementConflict('持倉已被更新，請重新整理再記錄往來。');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const planned = planCryptoMovement(previous, payload.movement as CryptoMovementInput, `position_${checksum(payload.operationId).slice(0, 32)}`, today);
  const next = { ...planned.state, version: previous.version + 1 };
  validateState(next);
  const at = now.toISOString();
  const entry = { ...planned.input, id: refs.movement.id, createdAt: at, version: next.version, legs: planned.legs, totalAmount: planned.totalAmount, sourceLabel: planned.sourceLabel, destinationLabel: planned.destinationLabel, sourceCustodian: planned.sourceCustodian, destinationCustodian: planned.destinationCustodian };
  // All effects and the durable record commit together; a retry cannot apply a quantity twice.
  sync(next, stored, previous);
  tx.set(refs.meta, next);
  tx.create(refs.movement, entry);
  if (!opening.exists) tx.create(refs.opening, { at, version: previous.version, positions: previous.positions });
  tx.create(refs.audit, { action: 'record-movement', reason: planned.input.note, at, version: next.version, previous, next, movementId: refs.movement.id, requestChecksum });
}
