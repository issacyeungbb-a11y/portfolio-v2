import { addCryptoQuantity, cryptoAssetStatus, normalizeCryptoPlatform } from "./cryptoClassification.js";
import { positionLabel } from "./cryptoMovements.js";
const cryptoFundingToday = (now = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(now);
function planCryptoFundingChanges(previous, submitted, reason, now = /* @__PURE__ */ new Date()) {
  const state = structuredClone(submitted);
  const entries = [];
  const ids = new Set([...previous.funding, ...state.funding].map((r) => r.id));
  const changed = [...ids].filter((id) => JSON.stringify(previous.funding.find((r) => r.id === id)) !== JSON.stringify(state.funding.find((r) => r.id === id)));
  if (changed.length > 1) throw new Error("\u8ACB\u9010\u7B46\u4FEE\u6539\u8CC7\u91D1\u7D00\u9304\uFF0C\u4EE5\u4FBF\u6838\u5C0D\u6301\u5009\u8B8A\u52D5\u3002");
  for (const id of changed) {
    const old = previous.funding.find((r) => r.id === id);
    const row = state.funding.find((r) => r.id === id);
    if (row) {
      const date = /* @__PURE__ */ new Date(`${row.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date || row.date > cryptoFundingToday(now)) throw new Error("\u8ACB\u586B\u5BEB\u6709\u6548\u7684\u8CC7\u91D1\u65E5\u671F\uFF0C\u4E0D\u80FD\u9810\u5148\u8A08\u5165\u672A\u767C\u751F\u7684\u8CC7\u91D1\u3002");
      if (row.type === "adjustment") {
        if (row.positionId || row.destination || row.quantity !== void 0) throw new Error("\u672C\u91D1\u8ABF\u6574\u53EA\u66F4\u65B0\u672C\u91D1\uFF1B\u5BE6\u969B\u5165\u91D1\u6216\u63D0\u53D6\u8ACB\u9078\u64C7\u5C0D\u61C9\u985E\u578B\u3002");
      } else {
        if (row.destination) {
          if (row.positionId) throw new Error("\u8ACB\u53EA\u9078\u64C7\u4E00\u500B\u8CC7\u91D1\u4F4D\u7F6E\u3002");
          const { symbol, network } = row.destination;
          const custodian = normalizeCryptoPlatform(row.destination.custodian);
          if (!custodian || custodian.length > 160 || typeof network !== "string" || network.length > 160 || !state.coins.some((c) => c.symbol === symbol)) throw new Error("\u65B0\u8CC7\u91D1\u4F4D\u7F6E\u8CC7\u6599\u4E0D\u6B63\u78BA\uFF0C\u8ACB\u5148\u8A2D\u5B9A\u5E63\u7A2E\u3002");
          let target = state.positions.find((p) => p.custodian === custodian && p.symbol === symbol && p.network === network.trim() && cryptoAssetStatus(p.status) === "\u53EF\u7528" && !p.collateralSymbol);
          if (!target) {
            if (row.type === "withdrawal") throw new Error("\u63D0\u53D6\u8CC7\u91D1\u8ACB\u9078\u64C7\u5DF2\u6709\u7684\u53EF\u7528\u6301\u5009\u3002");
            const positionId = `funding_position_${row.id}`;
            if (positionId.length > 80 || state.positions.some((p) => p.id === positionId)) throw new Error("\u65B0\u8CC7\u91D1\u4F4D\u7F6E ID \u7121\u6548\u3002");
            target = { id: positionId, custodian, symbol, network: network.trim(), quantity: 0, status: "\u53EF\u7528", collateralSymbol: "" };
            state.positions.push(target);
          }
          row.positionId = target.id;
          delete row.destination;
        }
        if (!row.positionId) {
          if (!old || old.positionId || old.type !== row.type || old.hkd !== row.hkd || old.usd !== row.usd || row.quantity !== void 0) throw new Error("\u5165\u91D1\uFF0F\u63D0\u53D6\u5FC5\u9808\u9078\u64C7\u5E73\u53F0\u6301\u5009\u53CA\u5BE6\u969B\u5E63\u6578\u3002");
        } else {
          const target = state.positions.find((p) => p.id === row.positionId);
          if (!target || cryptoAssetStatus(target.status) !== "\u53EF\u7528") throw new Error("\u8ACB\u9078\u64C7\u53EF\u7528\u6301\u5009\uFF1B\u9396\u5B9A\u53CA\u8CEA\u62BC\u6536\u76CA\u9808\u5148\u89E3\u9664\u3002");
          if (typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 1e15) throw new Error("\u5BE6\u969B\u5230\u5E33\uFF0F\u63D0\u53D6\u5E63\u6578\u5FC5\u9808\u662F\u6709\u6548\u6B63\u6578\u3002");
          if (!(row.hkd > 0) || !(row.usd > 0)) throw new Error("\u8ACB\u586B\u5BEB\u5927\u65BC\u96F6\u7684\u6E2F\u5143\u53CA\u7F8E\u5143\u91D1\u984D\u3002");
        }
      }
    }
    const effects = /* @__PURE__ */ new Map();
    const effect = (funding, direction) => {
      if (!funding?.positionId || funding.quantity === void 0) return;
      const delta = funding.quantity * (funding.type === "withdrawal" ? -1 : 1) * direction;
      effects.set(funding.positionId, addCryptoQuantity(effects.get(funding.positionId) ?? 0, delta));
    };
    effect(old, -1);
    effect(row, 1);
    for (const [positionId, delta] of effects) {
      if (!delta) continue;
      const position = state.positions.find((p) => p.id === positionId);
      if (!position) throw new Error("\u627E\u4E0D\u5230\u539F\u6709\u8CC7\u91D1\u4F4D\u7F6E\uFF0C\u4E0D\u80FD\u64A4\u56DE\u820A\u6709\u8B8A\u52D5\u3002");
      const before = position.quantity;
      const after = addCryptoQuantity(before, delta);
      if (after < 0) throw new Error(`${position.custodian} ${position.symbol} \u53EF\u7528\u6578\u91CF\u4E0D\u8DB3\uFF1B\u8ACB\u5148\u8655\u7406\u76F8\u95DC\u8CB7\u8CE3\u6216\u8F49\u79FB\u3002`);
      if (!Number.isFinite(after) || after > 1e15 || after === before) throw new Error("\u8CC7\u91D1\u8B8A\u52D5\u8D85\u51FA\u53EF\u8A18\u9304\u7684\u6578\u91CF\u6216\u7CBE\u5EA6\u3002");
      position.quantity = after;
      const label = positionLabel(position);
      entries.push({
        fundingId: id,
        type: delta > 0 ? "transfer_in" : "transfer_out",
        date: old ? cryptoFundingToday(now) : row.date,
        symbol: position.symbol,
        quantity: Math.abs(delta),
        ...delta > 0 ? { destinationPositionId: position.id } : { sourcePositionId: position.id },
        counterparty: (row ?? old).source,
        note: `${old ? row ? "\u66F4\u6B63\u8CC7\u91D1\u7D00\u9304" : "\u79FB\u9664\u8CC7\u91D1\u7D00\u9304" : row.type === "deposit" ? "\u8CC7\u91D1\u5165\u5E33" : "\u8CC7\u91D1\u63D0\u53D6"}\uFF1A${(row ?? old).source}\uFF1B${reason}`.slice(0, 300),
        createdAt: now.toISOString(),
        version: state.version,
        legs: [{ positionId, symbol: position.symbol, custodian: position.custodian, status: position.status, network: position.network, delta, before, after }],
        totalAmount: null,
        sourceLabel: delta < 0 ? label : "",
        destinationLabel: delta > 0 ? label : "",
        sourceCustodian: delta < 0 ? position.custodian : "",
        destinationCustodian: delta > 0 ? position.custodian : ""
      });
    }
  }
  state.platforms = [.../* @__PURE__ */ new Set([...state.platforms ?? [], ...state.positions.map((p) => p.custodian)])];
  return { state, entries };
}
export {
  cryptoFundingToday,
  planCryptoFundingChanges
};
