import { normalizeCryptoPlatform } from "./cryptoClassification.js";
function cryptoPlatforms(state) {
  return [...new Set([...state.platforms ?? [], ...state.positions.map((r) => r.custodian), ...state.liabilities.map((r) => r.custodian)].map(normalizeCryptoPlatform))].sort((a, b) => a.localeCompare(b, "zh-HK"));
}
function saveCryptoPlatform(state, name, previousName) {
  const nextName = normalizeCryptoPlatform(name);
  if (previousName) previousName = normalizeCryptoPlatform(previousName);
  if (!nextName || nextName.length > 160) throw new Error("\u8ACB\u586B\u5BEB\u6709\u6548\u7684\u5E73\u53F0\u540D\u7A31\u3002");
  const platforms = cryptoPlatforms(state);
  if (previousName && !platforms.includes(previousName)) throw new Error("\u5E73\u53F0\u5DF2\u8B8A\u66F4\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u3002");
  if (nextName !== previousName && platforms.includes(nextName)) throw new Error("\u6B64\u5E73\u53F0\u5DF2\u5B58\u5728\uFF0C\u8ACB\u4F7F\u7528\u5176\u4ED6\u540D\u7A31\u3002");
  const rename = (rows) => rows.map((r) => normalizeCryptoPlatform(r.custodian) === previousName ? { ...r, custodian: nextName } : { ...r, custodian: normalizeCryptoPlatform(r.custodian) });
  return { ...state, platforms: previousName ? platforms.map((p) => p === previousName ? nextName : p) : [...platforms, nextName], positions: rename(state.positions), liabilities: rename(state.liabilities) };
}
function filterCryptoPositions(rows, category, selection, search) {
  const query = search.toLowerCase().trim();
  return rows.filter((r) => (!selection || (category === "platform" ? normalizeCryptoPlatform(r.custodian) : r.symbol) === (category === "platform" ? normalizeCryptoPlatform(selection) : selection)) && `${r.symbol} ${r.custodian} ${r.status} ${r.network}`.toLowerCase().includes(query));
}
export {
  cryptoPlatforms,
  filterCryptoPositions,
  saveCryptoPlatform
};
