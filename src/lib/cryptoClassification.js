const cryptoAssetStatuses = ["\u53EF\u7528", "\u9396\u5B9A(\u8CEA\u62BC)", "\u9396\u5B9A(\u62B5\u62BC)", "\u8CEA\u62BC\u6240\u8CFA"];
function normalizeCryptoPlatform(name) {
  return /^coolwallet(?:\s*[（(]\s*賺幣\s*[）)])?$/i.test(name.trim()) ? "CoolWallet" : name.trim();
}
function cryptoAssetStatus(value) {
  if (/質押(?:所賺|所得|收益)|staking[_ -]?(?:reward|earnings)/i.test(value)) return "\u8CEA\u62BC\u6240\u8CFA";
  if (/非質押|未質押|解除質押|unstak|非抵押|未抵押|解除抵押/i.test(value)) return "\u53EF\u7528";
  if (/抵押|collateral/i.test(value)) return "\u9396\u5B9A(\u62B5\u62BC)";
  if (/質押|stak/i.test(value)) return "\u9396\u5B9A(\u8CEA\u62BC)";
  return "\u53EF\u7528";
}
function normalizeCryptoState(state) {
  return {
    ...state,
    platforms: [...new Set([...state.platforms ?? [], ...state.positions.map((p) => p.custodian), ...state.liabilities.map((p) => p.custodian)].map(normalizeCryptoPlatform))],
    positions: state.positions.map((p) => ({ ...p, custodian: normalizeCryptoPlatform(p.custodian), status: cryptoAssetStatus(p.status) })),
    liabilities: state.liabilities.map((p) => ({ ...p, custodian: normalizeCryptoPlatform(p.custodian) }))
  };
}
function decimalParts(value) {
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const places = (mantissa.split(".")[1]?.length ?? 0) - Number(exponent);
  const digits = BigInt(mantissa.replace(".", ""));
  return places < 0 ? [digits * 10n ** BigInt(-places), 0] : [digits, places];
}
function addCryptoQuantity(a, b) {
  const [ai, ap] = decimalParts(a);
  const [bi, bp] = decimalParts(b);
  const scale = Math.max(ap, bp);
  return Number(`${ai * 10n ** BigInt(scale - ap) + bi * 10n ** BigInt(scale - bp)}e-${scale}`);
}
function multiplyCryptoQuantity(a, b) {
  const [ai, ap] = decimalParts(a);
  const [bi, bp] = decimalParts(b);
  return Number(`${ai * bi}e-${ap + bp}`);
}
function summarizeCryptoCoins(state) {
  return state.coins.map((coin) => {
    const rows = state.positions.filter((p) => p.symbol === coin.symbol);
    const byStatus = Object.fromEntries(cryptoAssetStatuses.map((s) => [s, 0]));
    rows.forEach((p) => {
      const status = cryptoAssetStatus(p.status);
      byStatus[status] = addCryptoQuantity(byStatus[status], p.quantity);
    });
    return { ...coin, quantity: rows.reduce((n, p) => addCryptoQuantity(n, p.quantity), 0), byStatus, platforms: new Set(rows.map((p) => normalizeCryptoPlatform(p.custodian))).size };
  });
}
const isSpendablePosition = (p) => ["\u53EF\u7528", "\u8CEA\u62BC\u6240\u8CFA"].includes(cryptoAssetStatus(p.status));
const isCollateralPosition = (p) => cryptoAssetStatus(p.status) === "\u9396\u5B9A(\u62B5\u62BC)";
export {
  addCryptoQuantity,
  cryptoAssetStatus,
  cryptoAssetStatuses,
  isCollateralPosition,
  isSpendablePosition,
  multiplyCryptoQuantity,
  normalizeCryptoPlatform,
  normalizeCryptoState,
  summarizeCryptoCoins
};
