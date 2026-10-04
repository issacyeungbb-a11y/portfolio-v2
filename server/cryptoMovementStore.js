import { planCryptoMovement } from "../src/lib/cryptoMovements.js";
import { saveCryptoPlatform } from "../src/lib/cryptoPlatforms.js";
import { checksum, validateState } from "./cryptoManagementCore.js";
import { normalizeCryptoState } from "../src/lib/cryptoClassification.js";
function assertRecordedPositions(previous, next, rename) {
  let expected = normalizeCryptoState(previous);
  if (rename !== void 0) {
    const r = rename;
    if (!r || typeof r.previousName !== "string" || typeof r.name !== "string") throw new Error("\u5E73\u53F0\u6539\u540D\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002");
    expected = saveCryptoPlatform(expected, r.name, r.previousName);
  }
  const canonical = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ id: p.id, symbol: p.symbol, custodian: p.custodian, quantity: p.quantity, status: p.status, network: p.network, collateralSymbol: p.collateralSymbol }));
  if (checksum(canonical(expected.positions)) !== checksum(canonical(normalizeCryptoState(next).positions))) throw new Error("\u6301\u5009\u6578\u91CF\u3001\u5E73\u53F0\u53CA\u9396\u5B9A\u72C0\u614B\u8ACB\u900F\u904E Crypto \u8B8A\u52D5\u8A18\u9304\u4EA4\u6613\u6216\u8F49\u79FB\u3002");
}
class CryptoMovementConflict extends Error {
}
async function commitCryptoMovement(tx, refs, payload, sync, now = /* @__PURE__ */ new Date()) {
  const [meta, completed, stored, opening] = await Promise.all([tx.get(refs.meta), tx.get(refs.audit), tx.get(refs.assets), tx.get(refs.opening)]);
  const requestChecksum = checksum(payload);
  if (completed.exists) {
    if (completed.data()?.requestChecksum !== requestChecksum) throw new CryptoMovementConflict("\u64CD\u4F5C ID \u5DF2\u7528\u65BC\u53E6\u4E00\u7B46\u5F80\u4F86\u3002");
    return;
  }
  const previous = meta.data();
  if (!previous || previous.version !== payload.expectedVersion) throw new CryptoMovementConflict("\u6301\u5009\u5DF2\u88AB\u66F4\u65B0\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u518D\u8A18\u9304\u5F80\u4F86\u3002");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const planned = planCryptoMovement(previous, payload.movement, `position_${checksum(payload.operationId).slice(0, 32)}`, today);
  const next = { ...planned.state, version: previous.version + 1 };
  validateState(next);
  const at = now.toISOString();
  const entry = { ...planned.input, id: refs.movement.id, createdAt: at, version: next.version, legs: planned.legs, totalAmount: planned.totalAmount, sourceLabel: planned.sourceLabel, destinationLabel: planned.destinationLabel, sourceCustodian: planned.sourceCustodian, destinationCustodian: planned.destinationCustodian };
  sync(next, stored, previous);
  tx.set(refs.meta, next);
  tx.create(refs.movement, entry);
  if (!opening.exists) tx.create(refs.opening, { at, version: previous.version, positions: previous.positions });
  tx.create(refs.audit, { action: "record-movement", reason: planned.input.note, at, version: next.version, previous, next, movementId: refs.movement.id, requestChecksum });
}
export {
  CryptoMovementConflict,
  assertRecordedPositions,
  commitCryptoMovement
};
