import { addCryptoQuantity, multiplyCryptoQuantity, cryptoAssetStatus, cryptoAssetStatuses, isSpendablePosition, isCollateralPosition, normalizeCryptoPlatform, normalizeCryptoState } from "./cryptoClassification.js";
import { addCryptoQuantity as addCryptoQuantity2 } from "./cryptoClassification.js";
const cryptoMovementLabels = {
  buy: "\u8CB7\u5165",
  sell: "\u8CE3\u51FA",
  transfer: "\u8CC7\u7522\u8F49\u79FB",
  transfer_in: "\u5916\u90E8\u8F49\u5165",
  transfer_out: "\u5916\u90E8\u8F49\u51FA",
  stake: "\u6295\u5165\u8CEA\u62BC",
  unstake: "\u89E3\u9664\u8CEA\u62BC",
  staking_reward: "\u8CEA\u62BC\u6536\u76CA",
  collateral_lock: "\u6295\u5165\u62B5\u62BC",
  collateral_unlock: "\u89E3\u9664\u62B5\u62BC"
};
const sourceRequired = (type) => ["sell", "transfer", "transfer_out", "stake", "unstake", "staking_reward", "collateral_lock", "collateral_unlock"].includes(type);
const destinationRequired = (type) => !["sell", "transfer_out"].includes(type);
const isStakedPosition = (row) => cryptoAssetStatus(row.status) === "\u9396\u5B9A(\u8CEA\u62BC)";
const positionLabel = (row) => `${row.custodian} \xB7 ${row.symbol} \xB7 ${row.status}${row.network ? ` \xB7 ${row.network}` : ""}`;
function cryptoMovementSources(state, type, symbol) {
  return state.positions.filter((p) => p.symbol === symbol && (p.quantity > 0 || type === "staking_reward") && (["unstake", "staking_reward"].includes(type) ? isStakedPosition(p) : type === "collateral_unlock" ? isCollateralPosition(p) : ["stake", "collateral_lock", "sell"].includes(type) ? isSpendablePosition(p) : true));
}
function cryptoMovementDestinationStatuses(type, source) {
  if (type === "stake") return ["\u9396\u5B9A(\u8CEA\u62BC)"];
  if (type === "collateral_lock") return ["\u9396\u5B9A(\u62B5\u62BC)"];
  if (["unstake", "collateral_unlock", "buy"].includes(type)) return ["\u53EF\u7528"];
  if (type === "staking_reward") return ["\u8CEA\u62BC\u6240\u8CFA", "\u9396\u5B9A(\u8CEA\u62BC)", "\u53EF\u7528"];
  if (type === "transfer" && source) {
    const s = cryptoAssetStatus(source.status);
    return s === "\u8CEA\u62BC\u6240\u8CFA" ? [s, "\u53EF\u7528"] : [s];
  }
  return cryptoAssetStatuses;
}
function cryptoMovementDefaultDestination(state, type, symbol, source) {
  const status = cryptoMovementDestinationStatuses(type, source)[0];
  const candidates = state.positions.filter((p) => p.symbol === symbol && (!sourceRequired(type) || p.id !== source?.id) && cryptoAssetStatus(p.status) === status);
  const samePlatform = candidates.find((p) => p.custodian === source?.custodian && p.network === source?.network);
  const target = type === "transfer" ? candidates.find((p) => p.custodian !== source?.custodian) ?? candidates[0] : samePlatform ?? (!source ? candidates[0] : void 0);
  return {
    destinationPositionId: target?.id ?? "",
    custodian: target?.custodian ?? (type === "transfer" ? "" : source?.custodian ?? cryptoPlatformsForDestination(state)),
    status,
    network: target?.network ?? source?.network ?? ""
  };
}
function cryptoPlatformsForDestination(state) {
  return state.platforms?.[0] ?? state.positions[0]?.custodian ?? "";
}
function cryptoMovementDefaultNote(input, state) {
  const source = state.positions.find((p) => p.id === input.sourcePositionId);
  const destination = state.positions.find((p) => p.id === input.destinationPositionId);
  const target = destination ? positionLabel(destination) : input.destination ? `${input.destination.custodian} \xB7 ${input.symbol} \xB7 ${input.destination.status}` : input.counterparty;
  return `${cryptoMovementLabels[input.type]} ${input.quantity} ${input.symbol}${source ? ` \xB7 ${positionLabel(source)}` : input.counterparty ? ` \xB7 ${input.counterparty}` : ""}${target ? ` \u2192 ${target}` : ""}`.slice(0, 300);
}
const amount = (value, label, positive = true) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value > 1e15 || (positive ? value <= 0 : value < 0)) throw new Error(`${label}\u5FC5\u9808\u662F\u6709\u6548${positive ? "\u6B63" : "\u975E\u8CA0"}\u6578\u5B57\u3002`);
  return value;
};
const cleanText = (value, label, required = true, max = 160) => {
  if (typeof value !== "string" || value.length > max || required && !value.trim()) throw new Error(`${label}\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002`);
  return value.trim();
};
function planCryptoMovement(state, raw, newPositionId, today) {
  if (!raw || typeof raw.type !== "string" || !Object.prototype.hasOwnProperty.call(cryptoMovementLabels, raw.type)) throw new Error("\u8ACB\u9078\u64C7\u6709\u6548\u7684\u4EA4\u6613\u6216\u8F49\u79FB\u985E\u578B\u3002");
  const input = {
    type: raw.type,
    date: cleanText(raw.date, "\u65E5\u671F"),
    symbol: cleanText(raw.symbol, "\u5E63\u7A2E").toUpperCase(),
    quantity: amount(raw.quantity, "\u6578\u91CF"),
    note: cleanText(raw.note, "\u5F80\u4F86\u8AAA\u660E", true, 300)
  };
  const date = /* @__PURE__ */ new Date(`${input.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date || input.date > today) throw new Error("\u8ACB\u586B\u5BEB\u6709\u6548\u65E5\u671F\uFF0C\u4E0D\u80FD\u9810\u5148\u8A08\u5165\u672A\u767C\u751F\u7684\u5F80\u4F86\u3002");
  if (!state.coins.some((c) => c.symbol === input.symbol)) throw new Error("\u8ACB\u5148\u5728\u7BA1\u7406\u4E2D\u5FC3\u65B0\u589E\u6B64\u5E63\u7A2E\u3002");
  const next = structuredClone(normalizeCryptoState(state));
  const legs = [];
  const source = sourceRequired(input.type) ? next.positions.find((p) => p.id === raw.sourcePositionId && p.symbol === input.symbol) : void 0;
  if (sourceRequired(input.type) && !source) throw new Error("\u8ACB\u9078\u64C7\u6B64\u5E63\u7A2E\u7684\u4F86\u6E90\u6301\u5009\u3002");
  if (source) input.sourcePositionId = source.id;
  if (["unstake", "staking_reward"].includes(input.type) && source && !isStakedPosition(source)) throw new Error("\u4F86\u6E90\u5FC5\u9808\u662F\u8CEA\u62BC\u6301\u5009\u3002");
  if (["stake", "collateral_lock", "sell"].includes(input.type) && source && !isSpendablePosition(source)) throw new Error("\u8ACB\u5148\u8A18\u9304\u89E3\u9664\u8CEA\u62BC\u6216\u89E3\u9664\u62B5\u62BC\uFF0C\u518D\u4F7F\u7528\u53EF\u52D5\u7528\u6301\u5009\u3002");
  if (input.type === "collateral_unlock" && source && !isCollateralPosition(source)) throw new Error("\u4F86\u6E90\u5FC5\u9808\u662F\u9396\u5B9A(\u62B5\u62BC)\u6301\u5009\u3002");
  let destination;
  if (destinationRequired(input.type)) {
    if (raw.destinationPositionId) {
      destination = next.positions.find((p) => p.id === raw.destinationPositionId && p.symbol === input.symbol);
      if (!destination) throw new Error("\u627E\u4E0D\u5230\u76EE\u7684\u5730\u6301\u5009\u3002");
      input.destinationPositionId = destination.id;
    } else {
      if (!raw.destination) throw new Error("\u8ACB\u9078\u64C7\u76EE\u7684\u5730\u6216\u586B\u5BEB\u65B0\u6301\u5009\u8CC7\u6599\u3002");
      const details = { custodian: normalizeCryptoPlatform(cleanText(raw.destination.custodian, "\u76EE\u7684\u5730\u5E73\u53F0")), status: cryptoAssetStatus(raw.destination.status), network: cleanText(raw.destination.network, "\u7DB2\u7D61", false) };
      if (![...cryptoAssetStatuses, "\u8CEA\u62BC", "\u62B5\u62BC"].includes(raw.destination.status)) throw new Error("\u8ACB\u9078\u64C7\u6709\u6548\u7684\u56DB\u7A2E\u8CC7\u7522\u72C0\u614B\u3002");
      destination = next.positions.find((p) => p.symbol === input.symbol && p.custodian === details.custodian && p.status === details.status && p.network === details.network && !p.collateralSymbol);
      if (!destination) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(newPositionId) || next.positions.some((p) => p.id === newPositionId)) throw new Error("\u65B0\u6301\u5009 ID \u7121\u6548\u3002");
        destination = { id: newPositionId, symbol: input.symbol, ...details, quantity: 0, collateralSymbol: "" };
        next.positions.push(destination);
      }
      input.destination = details;
    }
    if (input.type === "stake" && !isStakedPosition(destination)) throw new Error("\u6295\u5165\u8CEA\u62BC\u7684\u76EE\u7684\u5730\u5FC5\u9808\u662F\u8CEA\u62BC\u6301\u5009\u3002");
    if (["unstake", "collateral_unlock", "buy"].includes(input.type) && cryptoAssetStatus(destination.status) !== "\u53EF\u7528") throw new Error("\u76EE\u7684\u5730\u5FC5\u9808\u662F\u53EF\u7528\u6301\u5009\u3002");
    if (input.type === "collateral_lock" && !isCollateralPosition(destination)) throw new Error("\u6295\u5165\u62B5\u62BC\u7684\u76EE\u7684\u5730\u5FC5\u9808\u662F\u9396\u5B9A(\u62B5\u62BC)\u6301\u5009\u3002");
    if (input.type === "staking_reward" && isCollateralPosition(destination)) throw new Error("\u8CEA\u62BC\u6536\u76CA\u4E0D\u80FD\u76F4\u63A5\u8A08\u5165\u62B5\u62BC\u672C\u91D1\u3002");
    if (input.type === "transfer" && source && cryptoAssetStatus(source.status) !== cryptoAssetStatus(destination.status) && !(cryptoAssetStatus(source.status) === "\u8CEA\u62BC\u6240\u8CFA" && cryptoAssetStatus(destination.status) === "\u53EF\u7528")) throw new Error("\u9396\u5B9A\u72C0\u614B\u6539\u8B8A\u8ACB\u9078\u64C7\u6295\u5165\u6216\u89E3\u9664\u8CEA\u62BC\uFF0F\u62B5\u62BC\u3002");
    if (source?.id === destination.id && input.type !== "staking_reward") throw new Error("\u4F86\u6E90\u8207\u76EE\u7684\u5730\u4E0D\u80FD\u662F\u540C\u4E00\u7B46\u6301\u5009\u3002");
  }
  let sourceLabel = source ? positionLabel(source) : "";
  let destinationLabel = destination ? positionLabel(destination) : "";
  let sourceCustodian = source?.custodian ?? "";
  let destinationCustodian = destination?.custodian ?? "";
  function change(row, delta) {
    const after = addCryptoQuantity(row.quantity, delta);
    if (after < 0) throw new Error(`${row.custodian} ${row.symbol} \u6578\u91CF\u4E0D\u8DB3\u3002`);
    if (!Number.isFinite(after) || after > 1e15) throw new Error("\u8B8A\u52D5\u5F8C\u6578\u91CF\u8D85\u51FA\u4E0A\u9650\u3002");
    if (after === row.quantity && delta !== 0) throw new Error("\u6B64\u7B46\u6578\u91CF\u592A\u5C0F\uFF0C\u8D85\u51FA\u76EE\u524D\u6301\u5009\u53EF\u8A18\u9304\u7684\u6578\u5B57\u7CBE\u5EA6\u3002");
    legs.push({ positionId: row.id, symbol: row.symbol, custodian: row.custodian, status: row.status, network: row.network, delta, before: row.quantity, after });
    row.quantity = after;
  }
  if (source && input.type !== "staking_reward") change(source, -input.quantity);
  if (destination) change(destination, input.quantity);
  let totalAmount = null;
  if (["buy", "sell"].includes(input.type)) {
    input.unitPrice = amount(raw.unitPrice, "\u6210\u4EA4\u55AE\u50F9");
    input.fees = amount(raw.fees ?? 0, "\u624B\u7E8C\u8CBB", false);
    input.quoteCurrency = cleanText(raw.quoteCurrency ?? "USD", "\u6210\u4EA4\u8CA8\u5E63").toUpperCase();
    const gross = multiplyCryptoQuantity(input.quantity, input.unitPrice);
    totalAmount = addCryptoQuantity(gross, input.type === "buy" ? input.fees : -input.fees);
    amount(totalAmount, "\u6210\u4EA4\u7E3D\u984D", false);
    if (raw.settlementPositionId) {
      const settlement = next.positions.find((p) => p.id === raw.settlementPositionId && p.symbol === input.quoteCurrency);
      if (!settlement || settlement.symbol === input.symbol || !isSpendablePosition(settlement)) throw new Error("\u8ACB\u9078\u64C7\u53E6\u4E00\u5E63\u7A2E\u7684\u53EF\u52D5\u7528\u7D50\u7B97\u6301\u5009\u3002");
      input.settlementPositionId = settlement.id;
      if (input.type === "buy") {
        sourceLabel = positionLabel(settlement);
        sourceCustodian = settlement.custodian;
      } else {
        destinationLabel = positionLabel(settlement);
        destinationCustodian = settlement.custodian;
      }
      if (totalAmount) change(settlement, input.type === "buy" ? -totalAmount : totalAmount);
    } else if (input.quoteCurrency !== "USD") throw new Error("\u4EE5\u5176\u4ED6\u5E63\u7A2E\u6210\u4EA4\uFF0C\u5FC5\u9808\u9078\u64C7\u7D50\u7B97\u6301\u5009\u3002");
  }
  if (["transfer_in", "transfer_out"].includes(input.type)) input.counterparty = cleanText(raw.counterparty, "\u5916\u90E8\u4F86\u6E90\uFF0F\u76EE\u7684\u5730");
  next.platforms = [.../* @__PURE__ */ new Set([...next.platforms ?? [], ...next.positions.map((p) => p.custodian), ...next.liabilities.map((p) => p.custodian)])];
  return { state: next, input, legs, totalAmount, sourceLabel, destinationLabel, sourceCustodian, destinationCustodian };
}
export {
  addCryptoQuantity2 as addCryptoQuantity,
  cryptoMovementDefaultDestination,
  cryptoMovementDefaultNote,
  cryptoMovementDestinationStatuses,
  cryptoMovementLabels,
  cryptoMovementSources,
  destinationRequired,
  isStakedPosition,
  planCryptoMovement,
  positionLabel,
  sourceRequired
};
