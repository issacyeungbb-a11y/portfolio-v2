import type { CryptoAssetStatus, CryptoManagementState, CryptoPosition } from '../types/cryptoManagement';

export const cryptoAssetStatuses: readonly CryptoAssetStatus[] = ['可用', '鎖定(質押)', '鎖定(抵押)', '質押所賺'];
export function normalizeCryptoPlatform(name: string) {
  return /^coolwallet(?:\s*[（(]\s*賺幣\s*[）)])?$/i.test(name.trim()) ? 'CoolWallet' : name.trim();
}
export function cryptoAssetStatus(value: string): CryptoAssetStatus {
  if (/質押(?:所賺|所得|收益)|staking[_ -]?(?:reward|earnings)/i.test(value)) return '質押所賺';
  if (/非質押|未質押|解除質押|unstak|非抵押|未抵押|解除抵押/i.test(value)) return '可用';
  if (/抵押|collateral/i.test(value)) return '鎖定(抵押)';
  if (/質押|stak/i.test(value)) return '鎖定(質押)';
  return '可用';
}
export function normalizeCryptoState(state: CryptoManagementState): CryptoManagementState {
  return {
    ...state,
    platforms: [...new Set([...(state.platforms ?? []), ...state.positions.map(p => p.custodian), ...state.liabilities.map(p => p.custodian)].map(normalizeCryptoPlatform))],
    positions: state.positions.map(p => ({ ...p, custodian: normalizeCryptoPlatform(p.custodian), status: cryptoAssetStatus(p.status) })),
    liabilities: state.liabilities.map(p => ({ ...p, custodian: normalizeCryptoPlatform(p.custodian) })),
  };
}
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
export function multiplyCryptoQuantity(a: number, b: number) {
  const [ai, ap] = decimalParts(a); const [bi, bp] = decimalParts(b);
  return Number(`${ai * bi}e-${ap + bp}`);
}
export function summarizeCryptoCoins(state: CryptoManagementState) {
  return state.coins.map(coin => {
    const rows = state.positions.filter(p => p.symbol === coin.symbol);
    const byStatus = Object.fromEntries(cryptoAssetStatuses.map(s => [s, 0])) as Record<CryptoAssetStatus, number>;
    rows.forEach(p => { const status = cryptoAssetStatus(p.status); byStatus[status] = addCryptoQuantity(byStatus[status], p.quantity); });
    return { ...coin, quantity: rows.reduce((n, p) => addCryptoQuantity(n, p.quantity), 0), byStatus, platforms: new Set(rows.map(p => normalizeCryptoPlatform(p.custodian))).size };
  });
}
export const isSpendablePosition = (p: CryptoPosition) => ['可用', '質押所賺'].includes(cryptoAssetStatus(p.status));
export const isCollateralPosition = (p: CryptoPosition) => cryptoAssetStatus(p.status) === '鎖定(抵押)';
