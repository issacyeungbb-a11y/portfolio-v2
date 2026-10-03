import { createHash } from "node:crypto";
import { QUOTE_FRESHNESS_WINDOW_MS } from "./priceFreshness.js";
function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
const number = (value, label, signed = false) => {
  if (typeof value !== "number" || !Number.isFinite(value) || !signed && value < 0 || Math.abs(value) > 1e15) throw new Error(`${label}\u5FC5\u9808\u662F\u6709\u6548${signed ? "" : "\u975E\u8CA0"}\u6578\u5B57\u3002`);
  return value;
};
const text = (value, label, required = true) => {
  if (typeof value !== "string" || value.length > 160 || required && !value.trim()) throw new Error(`${label}\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002`);
  return value.trim();
};
function validateState(state) {
  if (!state || !Array.isArray(state.coins) || !Array.isArray(state.positions) || !Array.isArray(state.liabilities) || !Array.isArray(state.funding)) throw new Error("\u7BA1\u7406\u8CC7\u6599\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002");
  if (state.coins.length > 100 || state.positions.length + state.liabilities.length > 200 || state.funding.length > 1e3) throw new Error("\u8A18\u9304\u6578\u91CF\u8D85\u51FA\u4E0A\u9650\u3002");
  const symbols = /* @__PURE__ */ new Set();
  for (const coin of state.coins) {
    coin.symbol = text(coin.symbol, "\u4EE3\u865F").toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(coin.symbol) || symbols.has(coin.symbol)) throw new Error("\u5E63\u7A2E\u4EE3\u865F\u7121\u6548\u6216\u91CD\u8907\u3002");
    symbols.add(coin.symbol);
    coin.name = text(coin.name, "\u5E63\u7A2E\u540D\u7A31");
    if (!["coingecko", "manual"].includes(coin.priceSource)) throw new Error("\u8ACB\u9078\u64C7\u50F9\u683C\u4F86\u6E90\u3002");
    coin.priceSourceId = text(coin.priceSourceId, "CoinGecko ID", coin.priceSource === "coingecko");
    if (coin.priceSource === "coingecko" && !/^[a-z0-9-]+$/.test(coin.priceSourceId)) throw new Error("CoinGecko ID \u683C\u5F0F\u4E0D\u6B63\u78BA\u3002");
    if (coin.manualPriceUsd !== null) number(coin.manualPriceUsd, "\u624B\u52D5\u50F9\u683C");
    if (coin.manualPriceAt !== null && !Number.isFinite(Date.parse(coin.manualPriceAt))) throw new Error("\u624B\u52D5\u50F9\u683C\u65E5\u671F\u7121\u6548\u3002");
  }
  const ids = /* @__PURE__ */ new Set();
  for (const row of [...state.positions, ...state.liabilities, ...state.funding]) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || ids.has(row.id)) throw new Error("\u8A18\u9304 ID \u7121\u6548\u6216\u91CD\u8907\u3002");
    ids.add(row.id);
  }
  for (const row of [...state.positions, ...state.liabilities]) {
    if (!symbols.has(row.symbol)) throw new Error(`\u8ACB\u5148\u8A2D\u5B9A ${row.symbol} \u5605\u50F9\u683C\u4F86\u6E90\u3002`);
    number(row.quantity, "\u6578\u91CF");
    row.custodian = text(row.custodian, "\u5E73\u53F0");
    row.status = text(row.status, "\u72C0\u614B");
    row.network = text(row.network, "\u7DB2\u7D61", false);
    row.collateralSymbol = text(row.collateralSymbol, "\u62B5\u62BC\u8CC7\u7522", false).toUpperCase();
    if (row.collateralSymbol && !symbols.has(row.collateralSymbol)) throw new Error("\u62B5\u62BC\u8CC7\u7522\u5FC5\u9808\u662F\u5DF2\u8A2D\u5B9A\u5E63\u7A2E\u3002");
  }
  for (const row of state.funding) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || (/* @__PURE__ */ new Date(`${row.date}T00:00:00Z`)).toISOString().slice(0, 10) !== row.date) throw new Error("\u8CC7\u91D1\u65E5\u671F\u7121\u6548\u3002");
    if (!["deposit", "withdrawal", "adjustment"].includes(row.type)) throw new Error("\u8CC7\u91D1\u985E\u578B\u7121\u6548\u3002");
    row.source = text(row.source, "\u8CC7\u91D1\u8AAA\u660E");
    number(row.hkd, "\u6E2F\u5143", row.type === "adjustment");
    number(row.usd, "\u7F8E\u5143", row.type === "adjustment");
  }
  if (principal(state.funding) < 0) throw new Error("\u672C\u91D1\u4E0D\u80FD\u4F4E\u65BC\u96F6\u3002");
  return state;
}
function principal(funding) {
  return funding.filter((r) => r.type !== "withdrawal").reduce((sum, r) => sum + r.hkd, 0);
}
function aggregate(rows) {
  return rows.reduce((result, row) => ({ ...result, [row.symbol]: (result[row.symbol] ?? 0) + row.quantity }), {});
}
function valueCrypto(state, quotes, now = Date.now()) {
  const quantities = aggregate(state.positions);
  const debt = aggregate(state.liabilities);
  const prices = {};
  const warnings = [];
  let grossUsd = 0;
  let debtUsd = 0;
  for (const coin of state.coins) {
    const quote = coin.priceSource === "manual" ? { price: coin.manualPriceUsd ?? 0, at: coin.manualPriceAt ?? "" } : quotes[coin.symbol];
    const valid = quote && quote.price > 0 && Number.isFinite(quote.price) && Number.isFinite(Date.parse(quote.at)) && now - Date.parse(quote.at) <= QUOTE_FRESHNESS_WINDOW_MS.crypto && Date.parse(quote.at) <= now + 3e5;
    prices[coin.symbol] = valid ? quote.price : null;
    if (!valid && ((quantities[coin.symbol] ?? 0) > 0 || (debt[coin.symbol] ?? 0) > 0)) warnings.push(`${coin.symbol} \u50F9\u683C\u5F85\u88DC\u6216\u5DF2\u904E\u671F`);
    grossUsd += (quantities[coin.symbol] ?? 0) * (prices[coin.symbol] ?? 0);
    debtUsd += (debt[coin.symbol] ?? 0) * (prices[coin.symbol] ?? 0);
  }
  return { quantities, prices, warnings, grossUsd, debtUsd, netUsd: grossUsd - debtUsd, principalHkd: principal(state.funding), withdrawnUsd: state.funding.filter((r) => r.type === "withdrawal").reduce((sum, r) => sum + r.usd, 0) };
}
function monthlyMetrics(valuation, fx, previousNetUsd) {
  if (valuation.warnings.length || !Number.isFinite(fx) || fx <= 0) throw new Error("\u7F3A\u5C11\u6709\u6548\u50F9\u683C\u6216\u532F\u7387\uFF0C\u4E0D\u80FD\u6B63\u5F0F\u6708\u7D50\u3002");
  const totalHkd = valuation.netUsd * fx;
  return { currentNetUsd: valuation.netUsd, cumulativeWithdrawnUsd: valuation.withdrawnUsd, performanceTotalUsd: valuation.netUsd, totalHkd, principalHkd: valuation.principalHkd, returnHkd: totalHkd - valuation.principalHkd, returnPct: valuation.principalHkd ? totalHkd / valuation.principalHkd - 1 : 0, monthOverMonthPct: previousNetUsd !== null && previousNetUsd > 0 ? valuation.netUsd / previousNetUsd - 1 : null };
}
const COIN_IDS = { BTC: "bitcoin", ETH: "ethereum", ADA: "cardano", BNB: "binancecoin", CRO: "crypto-com-chain", ATOM: "cosmos", ATONE: "atomone", OSMO: "osmosis", SNEK: "snek", WLD: "worldcoin-wld", NEAR: "near", USDT: "tether", USDC: "usd-coin", NIGHT: "midnight-3" };
function parseCryptoSheet(rows) {
  if (rows[39]?.[0] !== "\u8CC7\u7522" || rows[68]?.[0] !== "\u8CA0\u50B5" || rows[0]?.[2] !== "HKD") throw new Error("\u4F86\u6E90\u5DE5\u4F5C\u8868\u7D50\u69CB\u5DF2\u6539\u8B8A\uFF0C\u9077\u79FB\u5DF2\u505C\u6B62\u3002");
  const position = (row, index, debt = false) => ({ id: `${debt ? "debt" : "position"}_${index + 1}`, symbol: String(row[0]), custodian: String(row[1]), quantity: number(row[2], "\u4F86\u6E90\u6578\u91CF"), status: String(row[3]), network: String(row[1]).includes("BNB") ? "BNB Chain" : String(row[1]).includes("Ethereum") ? "Ethereum" : "", collateralSymbol: debt ? String(row[5] ?? "") : "" });
  const positions = rows.slice(40, 67).filter((r) => r[0]).map((r, i) => position(r, i));
  const liabilities = rows.slice(69, 71).filter((r) => r[0]).map((r, i) => position(r, i, true));
  const symbols = [...new Set([...positions, ...liabilities].map((r) => r.symbol))];
  const coins = symbols.map((symbol) => ({ symbol, name: symbol, priceSource: COIN_IDS[symbol] ? "coingecko" : "manual", priceSourceId: COIN_IDS[symbol] ?? "", manualPriceUsd: null, manualPriceAt: null }));
  const funding = rows.slice(1, 37).filter((r) => typeof r[0] === "number" && typeof r[2] === "number").map((r, i) => ({ id: `funding_${i + 1}`, date: new Date((Number(r[0]) - 25569) * 864e5).toISOString().slice(0, 10), source: String(r[1]), type: "deposit", hkd: Number(r[2]), usd: number(r[3], "\u4F86\u6E90\u7F8E\u5143") }));
  const withdrawn = rows[71]?.[16];
  if (typeof withdrawn === "number" && withdrawn > 0) funding.push({ id: "opening_withdrawals", date: "2026-10-01", source: "\u9077\u79FB\u524D\u7D2F\u8A08\u63D0\u53D6\uFF0F\u6D88\u8CBB\uFF08\u539F\u8868\u672A\u9010\u7B46\u5217\u660E\uFF09", type: "withdrawal", hkd: 0, usd: withdrawn });
  const state = { version: 1, migratedAt: "", sourceChecksum: checksum(rows), coins, positions, liabilities, funding };
  validateState(state);
  return state;
}
export {
  COIN_IDS,
  aggregate,
  checksum,
  monthlyMetrics,
  parseCryptoSheet,
  principal,
  validateState,
  valueCrypto
};
