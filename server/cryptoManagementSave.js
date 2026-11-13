import { FieldValue } from "firebase-admin/firestore";
import { normalizeCryptoState } from "../src/lib/cryptoClassification.js";
import { planCryptoFundingChanges } from "../src/lib/cryptoFunding.js";
import { checksum, validateState } from "./cryptoManagementCore.js";
import { assertRecordedPositions, CryptoMovementConflict } from "./cryptoMovementStore.js";
import { validateCryptoInput } from "./cryptoManagementErrors.js";
async function commitCryptoManagementSave(tx, ref, payload, sync, now = /* @__PURE__ */ new Date()) {
  const operationId = payload.operationId;
  const metaRef = ref.collection("cryptoManagement").doc("current");
  const auditRef = ref.collection("cryptoManagementAudit").doc(operationId);
  const openingRef = ref.collection("cryptoMovementOpening").doc("current");
  const [meta, audit, stored, opening] = await Promise.all([tx.get(metaRef), tx.get(auditRef), tx.get(ref.collection("assets")), tx.get(openingRef)]);
  const requestChecksum = checksum(payload);
  if (audit.exists) {
    if (audit.data()?.requestChecksum !== requestChecksum) throw new CryptoMovementConflict("\u64CD\u4F5C ID \u5DF2\u7528\u65BC\u53E6\u4E00\u500B\u64CD\u4F5C\u3002");
    return;
  }
  const previous = meta.data();
  if (!previous || payload.expectedVersion !== previous.version) throw new CryptoMovementConflict("\u8CC7\u6599\u5DF2\u88AB\u5176\u4ED6\u64CD\u4F5C\u66F4\u65B0\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u518D\u4FEE\u6539\u3002");
  const reason = payload.reason;
  const planned = validateCryptoInput(() => {
    const submitted = normalizeCryptoState(JSON.parse(JSON.stringify(payload.state)));
    validateState(submitted);
    assertRecordedPositions(previous, submitted, payload.platformRename, payload.stakingRewardLink);
    const next2 = { ...submitted, version: previous.version + 1, migratedAt: previous.migratedAt, sourceChecksum: previous.sourceChecksum };
    const result = planCryptoFundingChanges(previous, next2, reason, now);
    validateState(result.state);
    return result;
  });
  const next = planned.state;
  sync(next, stored, previous);
  tx.set(metaRef, next);
  for (const [index, entry] of planned.entries.entries()) {
    const id = checksum({ operationId, index });
    tx.create(ref.collection("cryptoMovements").doc(id), { ...entry, id });
  }
  if (planned.entries.length && !opening.exists) tx.create(openingRef, { at: now.toISOString(), version: previous.version, positions: previous.positions });
  const imported = (id) => /^(funding_|opening_)/.test(id);
  for (const row of next.funding) {
    const old = previous.funding.find((r) => r.id === row.id);
    if (old && imported(row.id) && !row.positionId) continue;
    if (!old || checksum(old) !== checksum(row)) {
      tx.set(ref.collection("accountCashFlows").doc(`crypto_funding_${row.id}`), {
        accountSource: "Crypto",
        type: row.type,
        amount: row.hkd || row.usd,
        currency: row.hkd ? "HKD" : "USD",
        date: row.date,
        note: row.source,
        managedCrypto: true,
        positionId: row.positionId ?? null,
        quantity: row.quantity ?? null,
        ...!old ? { createdAt: FieldValue.serverTimestamp() } : {},
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
  }
  for (const old of previous.funding.filter((r) => !next.funding.some((n) => n.id === r.id))) {
    if (!imported(old.id) || old.positionId) tx.delete(ref.collection("accountCashFlows").doc(`crypto_funding_${old.id}`));
  }
  tx.create(auditRef, { action: "save", reason, at: now.toISOString(), version: next.version, previous, next, requestChecksum });
}
export {
  commitCryptoManagementSave
};
