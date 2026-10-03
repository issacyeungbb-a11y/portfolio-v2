import type { CryptoManagementState, CryptoPosition } from '../types/cryptoManagement';

export function cryptoPlatforms(state: CryptoManagementState): string[] {
  return [...new Set([...(state.platforms ?? []), ...state.positions.map(r => r.custodian), ...state.liabilities.map(r => r.custodian)])]
    .sort((a, b) => a.localeCompare(b, 'zh-HK'));
}

export function saveCryptoPlatform(state: CryptoManagementState, name: string, previousName?: string): CryptoManagementState {
  const nextName = name.trim();
  if (!nextName || nextName.length > 160) throw new Error('請填寫有效的平台名稱。');
  const platforms = cryptoPlatforms(state);
  if (previousName && !platforms.includes(previousName)) throw new Error('平台已變更，請重新整理。');
  if (nextName !== previousName && platforms.includes(nextName)) throw new Error('此平台已存在，請使用其他名稱。');
  const rename = (rows: CryptoPosition[]) => rows.map(r => r.custodian === previousName ? { ...r, custodian: nextName } : r);
  return { ...state, platforms: previousName ? platforms.map(p => p === previousName ? nextName : p) : [...platforms, nextName], positions: rename(state.positions), liabilities: rename(state.liabilities) };
}

export function filterCryptoPositions(rows: CryptoPosition[], category: 'platform' | 'coin', selection: string, search: string) {
  const query = search.toLowerCase().trim();
  return rows.filter(r => (!selection || (category === 'platform' ? r.custodian : r.symbol) === selection)
    && `${r.symbol} ${r.custodian} ${r.status} ${r.network}`.toLowerCase().includes(query));
}
