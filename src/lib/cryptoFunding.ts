import { addCryptoQuantity, cryptoAssetStatus, normalizeCryptoPlatform } from './cryptoClassification.js';
import { positionLabel } from './cryptoMovements.js';
import type { CryptoFunding, CryptoManagementState, CryptoMovementEntry } from '../types/cryptoManagement';

export const cryptoFundingToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

/** Apply funding differences to current balances, never replay historical funding. */
export function planCryptoFundingChanges(previous: CryptoManagementState, submitted: CryptoManagementState, reason: string, now = new Date()) {
  const state = structuredClone(submitted);
  const entries: Array<Omit<CryptoMovementEntry, 'id'>> = [];
  const ids = new Set([...previous.funding, ...state.funding].map(r => r.id));
  const changed = [...ids].filter(id => JSON.stringify(previous.funding.find(r => r.id === id)) !== JSON.stringify(state.funding.find(r => r.id === id)));
  if (changed.length > 1) throw new Error('請逐筆修改資金紀錄，以便核對持倉變動。');
  for (const id of changed) {
    const old = previous.funding.find(r => r.id === id);
    const row = state.funding.find(r => r.id === id);
    if (row) {
      const date = new Date(`${row.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date || row.date > cryptoFundingToday(now)) throw new Error('請填寫有效的資金日期，不能預先計入未發生的資金。');
      if (row.type === 'adjustment') {
        if (row.positionId || row.destination || row.quantity !== undefined) throw new Error('本金調整只更新本金；實際入金或提取請選擇對應類型。');
      } else {
        if (row.destination) {
          if (row.positionId) throw new Error('請只選擇一個資金位置。');
          const { symbol, network } = row.destination;
          const custodian = normalizeCryptoPlatform(row.destination.custodian);
          if (!custodian || custodian.length > 160 || typeof network !== 'string' || network.length > 160 || !state.coins.some(c => c.symbol === symbol)) throw new Error('新資金位置資料不正確，請先設定幣種。');
          let target = state.positions.find(p => p.custodian === custodian && p.symbol === symbol && p.network === network.trim() && cryptoAssetStatus(p.status) === '可用' && !p.collateralSymbol);
          if (!target) {
            if (row.type === 'withdrawal') throw new Error('提取資金請選擇已有的可用持倉。');
            const positionId = `funding_position_${row.id}`;
            if (positionId.length > 80 || state.positions.some(p => p.id === positionId)) throw new Error('新資金位置 ID 無效。');
            target = { id: positionId, custodian, symbol, network: network.trim(), quantity: 0, status: '可用', collateralSymbol: '' };
            state.positions.push(target);
          }
          row.positionId = target.id;
          delete row.destination;
        }
        if (!row.positionId) {
          // Unlinked legacy amounts were already reflected in opening holdings.
          if (!old || old.positionId || old.type !== row.type || old.hkd !== row.hkd || old.usd !== row.usd || row.quantity !== undefined) throw new Error('入金／提取必須選擇平台持倉及實際幣數。');
        } else {
          const target = state.positions.find(p => p.id === row.positionId);
          if (!target || cryptoAssetStatus(target.status) !== '可用') throw new Error('請選擇可用持倉；鎖定及質押收益須先解除。');
          if (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 1e15) throw new Error('實際到帳／提取幣數必須是有效正數。');
          if (!(row.hkd > 0) || !(row.usd > 0)) throw new Error('請填寫大於零的港元及美元金額。');
        }
      }
    }
    const effects = new Map<string, number>();
    const effect = (funding: CryptoFunding | undefined, direction: number) => {
      if (!funding?.positionId || funding.quantity === undefined) return;
      const delta = funding.quantity * (funding.type === 'withdrawal' ? -1 : 1) * direction;
      effects.set(funding.positionId, addCryptoQuantity(effects.get(funding.positionId) ?? 0, delta));
    };
    effect(old, -1); effect(row, 1);
    for (const [positionId, delta] of effects) {
      if (!delta) continue;
      const position = state.positions.find(p => p.id === positionId);
      if (!position) throw new Error('找不到原有資金位置，不能撤回舊有變動。');
      const before = position.quantity;
      const after = addCryptoQuantity(before, delta);
      if (after < 0) throw new Error(`${position.custodian} ${position.symbol} 可用數量不足；請先處理相關買賣或轉移。`);
      if (!Number.isFinite(after) || after > 1e15 || after === before) throw new Error('資金變動超出可記錄的數量或精度。');
      position.quantity = after;
      const label = positionLabel(position);
      entries.push({
        fundingId: id, type: delta > 0 ? 'transfer_in' : 'transfer_out',
        date: old ? cryptoFundingToday(now) : row!.date, symbol: position.symbol, quantity: Math.abs(delta),
        ...(delta > 0 ? { destinationPositionId: position.id } : { sourcePositionId: position.id }),
        counterparty: (row ?? old)!.source,
        note: `${old ? row ? '更正資金紀錄' : '移除資金紀錄' : row!.type === 'deposit' ? '資金入帳' : '資金提取'}：${(row ?? old)!.source}；${reason}`.slice(0, 300),
        createdAt: now.toISOString(), version: state.version,
        legs: [{ positionId, symbol: position.symbol, custodian: position.custodian, status: position.status, network: position.network, delta, before, after }],
        totalAmount: null, sourceLabel: delta < 0 ? label : '', destinationLabel: delta > 0 ? label : '',
        sourceCustodian: delta < 0 ? position.custodian : '', destinationCustodian: delta > 0 ? position.custodian : '',
      });
    }
  }
  state.platforms = [...new Set([...(state.platforms ?? []), ...state.positions.map(p => p.custodian)])];
  return { state, entries };
}
