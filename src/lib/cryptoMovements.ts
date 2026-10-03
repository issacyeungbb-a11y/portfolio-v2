import type { CryptoManagementState, CryptoMovementInput, CryptoMovementLeg, CryptoMovementType, CryptoPosition } from '../types/cryptoManagement';

export const cryptoMovementLabels: Record<CryptoMovementType, string> = {
  buy: '買入', sell: '賣出', transfer: '平台轉移', transfer_in: '外部轉入', transfer_out: '外部轉出',
  stake: '投入質押', unstake: '解除質押', staking_reward: '質押收益',
};
export const sourceRequired = (type: CryptoMovementType) => ['sell', 'transfer', 'transfer_out', 'stake', 'unstake', 'staking_reward'].includes(type);
export const destinationRequired = (type: CryptoMovementType) => !['sell', 'transfer_out'].includes(type);
export const isStakedPosition = (row: CryptoPosition) => /質押|staking|staked/i.test(row.status) && !/非質押|未質押|解除|unstak/i.test(row.status);
export const positionLabel = (row: CryptoPosition) => `${row.custodian} · ${row.symbol} · ${row.status}${row.network ? ` · ${row.network}` : ''}`;
const amount = (value: unknown, label: string, positive = true) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > 1e15 || (positive ? value <= 0 : value < 0)) throw new Error(`${label}必須是有效${positive ? '正' : '非負'}數字。`);
  return value;
};
const cleanText = (value: unknown, label: string, required = true, max = 160) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}格式不正確。`);
  return value.trim();
};

// Decimal arithmetic avoids drift when adding small rewards or moving an entire balance.
function decimalParts(value: number): [bigint, number] {
  const [mantissa, exponent = '0'] = value.toString().split('e');
  const places = (mantissa.split('.')[1]?.length ?? 0) - Number(exponent);
  const digits = BigInt(mantissa.replace('.', ''));
  return places < 0 ? [digits * 10n ** BigInt(-places), 0] : [digits, places];
}
export function addCryptoQuantity(a: number, b: number) {
  const [ai, ap] = decimalParts(a); const [bi, bp] = decimalParts(b); const scale = Math.max(ap, bp);
  return Number(`${ai * 10n ** BigInt(scale - ap) + bi * 10n ** BigInt(scale - bp)}e-${scale}`);
}
function multiply(a: number, b: number) {
  const [ai, ap] = decimalParts(a); const [bi, bp] = decimalParts(b);
  return Number(`${ai * bi}e-${ap + bp}`);
}

export function planCryptoMovement(state: CryptoManagementState, raw: CryptoMovementInput, newPositionId: string, today: string) {
  if (!raw || typeof raw.type !== 'string' || !Object.prototype.hasOwnProperty.call(cryptoMovementLabels, raw.type)) throw new Error('請選擇有效的交易或轉移類型。');
  const input: CryptoMovementInput = {
    type: raw.type, date: cleanText(raw.date, '日期'), symbol: cleanText(raw.symbol, '幣種').toUpperCase(),
    quantity: amount(raw.quantity, '數量'), note: cleanText(raw.note, '往來說明', true, 300),
  };
  const date = new Date(`${input.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date || input.date > today) throw new Error('請填寫有效日期，不能預先計入未發生的往來。');
  if (!state.coins.some(c => c.symbol === input.symbol)) throw new Error('請先在管理中心新增此幣種。');
  const next = structuredClone(state); const legs: CryptoMovementLeg[] = [];
  const source = sourceRequired(input.type) ? next.positions.find(p => p.id === raw.sourcePositionId && p.symbol === input.symbol) : undefined;
  if (sourceRequired(input.type) && !source) throw new Error('請選擇此幣種的來源持倉。');
  if (source) input.sourcePositionId = source.id;
  if (['unstake', 'staking_reward'].includes(input.type) && source && !isStakedPosition(source)) throw new Error('來源必須是質押持倉。');
  if (input.type === 'stake' && source && isStakedPosition(source)) throw new Error('投入質押的來源必須是非質押持倉。');
  if (input.type === 'sell' && source && isStakedPosition(source)) throw new Error('請先記錄解除質押，再賣出可用持倉。');
  let destination: CryptoPosition | undefined;
  if (destinationRequired(input.type)) {
    if (raw.destinationPositionId) {
      destination = next.positions.find(p => p.id === raw.destinationPositionId && p.symbol === input.symbol);
      if (!destination) throw new Error('找不到目的地持倉。');
      input.destinationPositionId = destination.id;
    } else {
      if (!raw.destination) throw new Error('請選擇目的地或填寫新持倉資料。');
      const details = { custodian: cleanText(raw.destination.custodian, '目的地平台'), status: raw.destination.status, network: cleanText(raw.destination.network, '網絡', false) };
      if (!['可用', '質押'].includes(details.status)) throw new Error('請選擇可用或質押狀態。');
      destination = next.positions.find(p => p.symbol === input.symbol && p.custodian === details.custodian && p.status === details.status && p.network === details.network && !p.collateralSymbol);
      if (!destination) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(newPositionId) || next.positions.some(p => p.id === newPositionId)) throw new Error('新持倉 ID 無效。');
        destination = { id: newPositionId, symbol: input.symbol, ...details, quantity: 0, collateralSymbol: '' };
        next.positions.push(destination);
      }
      input.destination = details;
    }
    if (input.type === 'stake' && !isStakedPosition(destination)) throw new Error('投入質押的目的地必須是質押持倉。');
    if (['unstake', 'buy'].includes(input.type) && isStakedPosition(destination)) throw new Error('目的地必須是非質押持倉。');
    if (input.type === 'transfer' && source && isStakedPosition(source) !== isStakedPosition(destination)) throw new Error('質押狀態改變請選擇投入質押或解除質押。');
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
  if (source && input.type !== 'staking_reward') change(source, -input.quantity);
  if (destination) change(destination, input.quantity);
  let totalAmount: number | null = null;
  if (['buy', 'sell'].includes(input.type)) {
    input.unitPrice = amount(raw.unitPrice, '成交單價'); input.fees = amount(raw.fees ?? 0, '手續費', false);
    input.quoteCurrency = cleanText(raw.quoteCurrency ?? 'USD', '成交貨幣').toUpperCase();
    const gross = multiply(input.quantity, input.unitPrice);
    totalAmount = addCryptoQuantity(gross, input.type === 'buy' ? input.fees : -input.fees);
    amount(totalAmount, '成交總額', false);
    if (raw.settlementPositionId) {
      const settlement = next.positions.find(p => p.id === raw.settlementPositionId && p.symbol === input.quoteCurrency);
      if (!settlement || settlement.symbol === input.symbol || isStakedPosition(settlement)) throw new Error('請選擇另一幣種的非質押結算持倉。');
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
