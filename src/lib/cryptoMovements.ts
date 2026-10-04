import { addCryptoQuantity, multiplyCryptoQuantity, cryptoAssetStatus, cryptoAssetStatuses, isSpendablePosition, isCollateralPosition, normalizeCryptoPlatform, normalizeCryptoState, stakingRewards, stakingRewardQuantity } from './cryptoClassification.js';
export { addCryptoQuantity } from './cryptoClassification.js';
import type { CryptoAssetStatus, CryptoManagementState, CryptoMovementInput, CryptoMovementLeg, CryptoMovementType, CryptoPosition } from '../types/cryptoManagement';

export const cryptoMovementLabels: Record<CryptoMovementType, string> = {
  buy: '買入', sell: '賣出', transfer: '資產轉移', transfer_in: '外部轉入', transfer_out: '外部轉出',
  stake: '投入質押', unstake: '解除質押', staking_reward: '質押收益', collateral_lock: '投入抵押', collateral_unlock: '解除抵押',
  staking_reward_release: '解除質押收益',
};
export const sourceRequired = (type: CryptoMovementType) => ['sell', 'transfer', 'transfer_out', 'stake', 'unstake', 'staking_reward', 'staking_reward_release', 'collateral_lock', 'collateral_unlock'].includes(type);
export const destinationRequired = (type: CryptoMovementType) => !['sell', 'transfer_out'].includes(type);
export const isStakedPosition = (row: CryptoPosition) => cryptoAssetStatus(row.status) === '鎖定(質押)';
export const positionLabel = (row: CryptoPosition) => `${row.custodian} · ${row.symbol} · ${row.status}${row.network ? ` · ${row.network}` : ''}`;
export function cryptoMovementSources(state: CryptoManagementState, type: CryptoMovementType, symbol: string) {
  return state.positions.filter(p => p.symbol === symbol && (p.quantity > 0 || ['staking_reward', 'staking_reward_release'].includes(type))
    && (type === 'staking_reward_release' ? isStakedPosition(p) && stakingRewardQuantity(state, p.id) > 0
      : ['unstake', 'staking_reward'].includes(type) ? isStakedPosition(p)
      : type === 'collateral_unlock' ? isCollateralPosition(p)
      : ['stake', 'collateral_lock', 'sell'].includes(type) ? isSpendablePosition(p) : true));
}
export function cryptoMovementDestinationStatuses(type: CryptoMovementType, source?: CryptoPosition): readonly CryptoAssetStatus[] {
  if (type === 'stake') return ['鎖定(質押)'];
  if (type === 'collateral_lock') return ['鎖定(抵押)'];
  if (['unstake', 'collateral_unlock', 'buy', 'staking_reward_release'].includes(type)) return ['可用'];
  if (type === 'staking_reward') return ['質押所賺', '鎖定(質押)', '可用'];
  if (type === 'transfer' && source) { const s = cryptoAssetStatus(source.status); return s === '質押所賺' ? [s, '可用'] : [s]; }
  return cryptoAssetStatuses;
}
// Choose a valid existing destination, or prepare a new status on the same platform.
export function cryptoMovementDefaultDestination(state: CryptoManagementState, type: CryptoMovementType, symbol: string, source?: CryptoPosition) {
  const status = cryptoMovementDestinationStatuses(type, source)[0];
  const candidates = normalizeCryptoState(state).positions.filter(p => p.symbol === symbol && (!sourceRequired(type) || p.id !== source?.id) && cryptoAssetStatus(p.status) === status && (type !== 'staking_reward' || p.stakingPositionId === source?.id));
  const samePlatform = candidates.find(p => p.custodian === source?.custodian && p.network === source?.network);
  const target = type === 'transfer'
    ? candidates.find(p => p.custodian !== source?.custodian) ?? candidates[0]
    : samePlatform ?? (!source ? candidates[0] : undefined);
  return {
    destinationPositionId: target?.id ?? '',
    custodian: target?.custodian ?? (type === 'transfer' ? '' : source?.custodian ?? cryptoPlatformsForDestination(state)),
    status, network: target?.network ?? source?.network ?? '',
  };
}
function cryptoPlatformsForDestination(state: CryptoManagementState) {
  return state.platforms?.[0] ?? state.positions[0]?.custodian ?? '';
}
export function cryptoMovementDefaultNote(input: CryptoMovementInput, state: CryptoManagementState) {
  const source = state.positions.find(p => p.id === input.sourcePositionId);
  const destination = state.positions.find(p => p.id === input.destinationPositionId);
  const target = destination ? positionLabel(destination) : input.destination ? `${input.destination.custodian} · ${input.symbol} · ${input.destination.status}` : input.counterparty;
  return `${cryptoMovementLabels[input.type]} ${input.quantity} ${input.symbol}${source ? ` · ${positionLabel(source)}` : input.counterparty ? ` · ${input.counterparty}` : ''}${target ? ` → ${target}` : ''}`.slice(0, 300);
}
const amount = (value: unknown, label: string, positive = true) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > 1e15 || (positive ? value <= 0 : value < 0)) throw new Error(`${label}必須是有效${positive ? '正' : '非負'}數字。`);
  return value;
};
const cleanText = (value: unknown, label: string, required = true, max = 160) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}格式不正確。`);
  return value.trim();
};

export function planCryptoMovement(state: CryptoManagementState, raw: CryptoMovementInput, newPositionId: string, today: string) {
  if (!raw || typeof raw.type !== 'string' || !Object.prototype.hasOwnProperty.call(cryptoMovementLabels, raw.type)) throw new Error('請選擇有效的交易或轉移類型。');
  const input: CryptoMovementInput = {
    type: raw.type, date: cleanText(raw.date, '日期'), symbol: cleanText(raw.symbol, '幣種').toUpperCase(),
    quantity: amount(raw.quantity, '數量'), note: cleanText(raw.note, '往來說明', true, 300),
  };
  const date = new Date(`${input.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date || input.date > today) throw new Error('請填寫有效日期，不能預先計入未發生的往來。');
  if (!state.coins.some(c => c.symbol === input.symbol)) throw new Error('請先在管理中心新增此幣種。');
  const next = structuredClone(normalizeCryptoState(state)); const legs: CryptoMovementLeg[] = [];
  const source = sourceRequired(input.type) ? next.positions.find(p => p.id === raw.sourcePositionId && p.symbol === input.symbol) : undefined;
  if (sourceRequired(input.type) && !source) throw new Error('請選擇此幣種的來源持倉。');
  if (source) input.sourcePositionId = source.id;
  if (['unstake', 'staking_reward', 'staking_reward_release'].includes(input.type) && source && !isStakedPosition(source)) throw new Error('來源必須是質押持倉。');
  if (raw.stakingPositionId !== undefined && (!source || raw.stakingPositionId !== source.id || !['staking_reward', 'staking_reward_release'].includes(input.type))) throw new Error('質押收益關聯格式不正確。');
  if (source && ['staking_reward', 'staking_reward_release'].includes(input.type)) input.stakingPositionId = source.id;
  if (['stake', 'collateral_lock', 'sell'].includes(input.type) && source && !isSpendablePosition(source)) throw new Error('請先記錄解除質押或解除抵押，再使用可動用持倉。');
  if (input.type === 'collateral_unlock' && source && !isCollateralPosition(source)) throw new Error('來源必須是鎖定(抵押)持倉。');

  let destination: CryptoPosition | undefined;
  if (destinationRequired(input.type)) {
    if (input.type === 'staking_reward_release' || (input.type === 'staking_reward' && !raw.destinationPositionId && !raw.destination)) {
      if (!source) throw new Error('請選擇質押持倉。');
      const status = input.type === 'staking_reward_release' ? '可用' : '質押所賺';
      destination = next.positions.find(p => p.symbol === source.symbol && p.custodian === source.custodian && p.status === status && p.network === source.network && !p.collateralSymbol && (status !== '質押所賺' || p.stakingPositionId === source.id));
      if (!destination) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(newPositionId) || next.positions.some(p => p.id === newPositionId)) throw new Error('新持倉 ID 無效。');
        destination = { id: newPositionId, symbol: source.symbol, custodian: source.custodian, status, network: source.network, quantity: 0, collateralSymbol: '', ...(status === '質押所賺' ? { stakingPositionId: source.id } : {}) };
        next.positions.push(destination);
      }
      input.destinationPositionId = destination.id;
    } else if (raw.destinationPositionId) {
      destination = next.positions.find(p => p.id === raw.destinationPositionId && p.symbol === input.symbol);
      if (!destination) throw new Error('找不到目的地持倉。');
      input.destinationPositionId = destination.id;
    } else {
      if (!raw.destination) throw new Error('請選擇目的地或填寫新持倉資料。');
      const details = { custodian: normalizeCryptoPlatform(cleanText(raw.destination.custodian, '目的地平台')), status: cryptoAssetStatus(raw.destination.status), network: cleanText(raw.destination.network, '網絡', false) };
      if (![...cryptoAssetStatuses, '質押', '抵押'].includes(raw.destination.status)) throw new Error('請選擇有效的四種資產狀態。');
      destination = next.positions.find(p => p.symbol === input.symbol && p.custodian === details.custodian && p.status === details.status && p.network === details.network && !p.collateralSymbol && (input.type !== 'staking_reward' || details.status !== '質押所賺' || p.stakingPositionId === source?.id));
      if (!destination) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(newPositionId) || next.positions.some(p => p.id === newPositionId)) throw new Error('新持倉 ID 無效。');
        destination = { id: newPositionId, symbol: input.symbol, ...details, quantity: 0, collateralSymbol: '' };
        next.positions.push(destination);
      }
      input.destination = details;
    }
    if (input.type === 'stake' && !isStakedPosition(destination)) throw new Error('投入質押的目的地必須是質押持倉。');
    if (['unstake', 'collateral_unlock', 'buy'].includes(input.type) && cryptoAssetStatus(destination.status) !== '可用') throw new Error('目的地必須是可用持倉。');
    if (input.type === 'collateral_lock' && !isCollateralPosition(destination)) throw new Error('投入抵押的目的地必須是鎖定(抵押)持倉。');
    if (input.type === 'staking_reward' && isCollateralPosition(destination)) throw new Error('質押收益不能直接計入抵押本金。');
    if (input.type === 'staking_reward' && destination.status === '質押所賺' && source) {
      if (destination.custodian !== source.custodian || (destination.stakingPositionId && destination.stakingPositionId !== source.id)) throw new Error('質押所賺必須留在對應質押持倉的平台。');
      destination.stakingPositionId = source.id;
    }
    if (input.type === 'transfer' && source && cryptoAssetStatus(source.status) !== cryptoAssetStatus(destination.status) && !(cryptoAssetStatus(source.status) === '質押所賺' && cryptoAssetStatus(destination.status) === '可用')) throw new Error('鎖定狀態改變請選擇投入或解除質押／抵押。');
    if (source?.id === destination.id && input.type !== 'staking_reward') throw new Error('來源與目的地不能是同一筆持倉。');
  }
  let sourceLabel = source ? positionLabel(source) : '';
  let destinationLabel = destination ? positionLabel(destination) : '';
  let sourceCustodian = source?.custodian ?? '';
  let destinationCustodian = destination?.custodian ?? '';
  function change(row: CryptoPosition, delta: number) {
    const after = addCryptoQuantity(row.quantity, delta);
    if (after < 0) throw new Error(`${row.custodian} ${row.symbol} 數量不足。`);
    if (!Number.isFinite(after) || after > 1e15) throw new Error('變動後數量超出上限。');
    if (after === row.quantity && delta !== 0) throw new Error('此筆數量太小，超出目前持倉可記錄的數字精度。');
    legs.push({ positionId: row.id, symbol: row.symbol, custodian: row.custodian, status: row.status, network: row.network, delta, before: row.quantity, after });
    row.quantity = after;
  }
  if (input.type === 'staking_reward_release' && source) {
    const rewards = stakingRewards(next, source.id).sort((a, b) => a.id.localeCompare(b.id));
    if (stakingRewardQuantity(next, source.id) < input.quantity) throw new Error('解除數量不可超過尚未解除的質押所賺。');
    let remaining = input.quantity;
    for (const reward of rewards) {
      if (!remaining) break;
      const row = next.positions.find(p => p.id === reward.id)!;
      const quantity = Math.min(row.quantity, remaining);
      if (quantity) change(row, -quantity);
      remaining = addCryptoQuantity(remaining, -quantity);
    }
    sourceLabel = `${source.custodian} · ${source.symbol} · 質押所賺`;
  } else if (source && input.type !== 'staking_reward') change(source, -input.quantity);
  if (destination) change(destination, input.quantity);
  let totalAmount: number | null = null;
  if (['buy', 'sell'].includes(input.type)) {
    input.unitPrice = amount(raw.unitPrice, '成交單價'); input.fees = amount(raw.fees ?? 0, '手續費', false);
    input.quoteCurrency = cleanText(raw.quoteCurrency ?? 'USD', '成交貨幣').toUpperCase();
    const gross = multiplyCryptoQuantity(input.quantity, input.unitPrice);
    totalAmount = addCryptoQuantity(gross, input.type === 'buy' ? input.fees : -input.fees);
    amount(totalAmount, '成交總額', false);
    if (raw.settlementPositionId) {
      const settlement = next.positions.find(p => p.id === raw.settlementPositionId && p.symbol === input.quoteCurrency);
      if (!settlement || settlement.symbol === input.symbol || !isSpendablePosition(settlement)) throw new Error('請選擇另一幣種的可動用結算持倉。');
      input.settlementPositionId = settlement.id;
      if (input.type === 'buy') { sourceLabel = positionLabel(settlement); sourceCustodian = settlement.custodian; }
      else { destinationLabel = positionLabel(settlement); destinationCustodian = settlement.custodian; }
      if (totalAmount) change(settlement, input.type === 'buy' ? -totalAmount : totalAmount);
    } else if (input.quoteCurrency !== 'USD') throw new Error('以其他幣種成交，必須選擇結算持倉。');
  }
  if (['transfer_in', 'transfer_out'].includes(input.type)) input.counterparty = cleanText(raw.counterparty, '外部來源／目的地');
  next.platforms = [...new Set([...(next.platforms ?? []), ...next.positions.map(p => p.custodian), ...next.liabilities.map(p => p.custodian)])];
  return { state: next, input, legs, totalAmount, sourceLabel, destinationLabel, sourceCustodian, destinationCustodian };
}
