import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb, getSharedPortfolioDocRef } from "./firebaseAdmin.js";
import { getGoogleSheetsAccessToken, readSheetValues } from "./cryptoMonthlySync.js";
import { generatePriceUpdates, getCoinGeckoConfig } from "./updatePrices.js";
import { aggregate, checksum, parseCryptoSheet, validateState, valueCrypto } from "./cryptoManagementCore.js";
import { cryptoAssetQuotes, planCryptoAssetSync, commitCryptoAssetReconciliation, CryptoAssetSyncConflict } from "./cryptoAssetSync.js";
import { assertRecordedPositions, commitCryptoMovement, CryptoMovementConflict } from "./cryptoMovementStore.js";
import { normalizeCryptoState } from "../src/lib/cryptoClassification.js";
import { CryptoManagementError, validateCryptoInput } from "./cryptoManagementErrors.js";
import { commitManualCryptoMonth } from "./cryptoMonthClose.js";
import { CryptoManagementError as CryptoManagementError2 } from "./cryptoManagementErrors.js";
const SHEET = "1CrXqZtK2Qy2rivBTN1BZTSbNpAY0Y5P6Rzsg8_OaaI4";
const metaRef = () => getSharedPortfolioDocRef().collection("cryptoManagement").doc("current");
const iso = (v) => typeof v === "string" ? v : v?.toDate?.().toISOString() ?? "";
async function assets() {
  return getSharedPortfolioDocRef().collection("assets").get();
}
function assetRows(docs) {
  return docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}
function quotesFromAssets(docs) {
  return cryptoAssetQuotes(assetRows(docs));
}
async function readCryptoManagement() {
  const ref = getSharedPortfolioDocRef();
  const [meta, assetDocs, audit, archive, drafts, portfolio] = await Promise.all([metaRef().get(), assets(), ref.collection("cryptoManagementAudit").orderBy("at", "desc").limit(30).get(), ref.collection("cryptoSourceArchive").get(), ref.collection("cryptoMonthlyDrafts").orderBy("month", "desc").limit(1).get(), ref.get()]);
  const state = meta.exists ? normalizeCryptoState(meta.data()) : null;
  const fx = portfolio.data()?.fxRates;
  const displayFx = { usdHkd: typeof fx?.USD === "number" && Number.isFinite(fx.USD) && fx.USD > 0 ? fx.USD : null, updatedAt: iso(fx?.updatedAt) };
  return { state, displayFx, assetsSync: state ? planCryptoAssetSync(state, assetRows(assetDocs.docs), { quantityOnly: true }).status : null, valuation: state ? valueCrypto(state, quotesFromAssets(assetDocs.docs)) : null, draft: drafts.docs[0] ? { month: drafts.docs[0].data().month, warnings: drafts.docs[0].data().warnings, updatedAt: drafts.docs[0].data().updatedAt } : null, audit: audit.docs.map((d) => ({ id: d.id, action: d.data().action, reason: d.data().reason, at: d.data().at, version: d.data().version })), sourceArchive: archive.docs.map((d) => ({ id: d.id, title: d.data().title, rows: d.data().values.length })) };
}
async function readMigrationSource() {
  const token = await getGoogleSheetsAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15e3) });
  if (!response.ok) throw new CryptoManagementError("\u672A\u80FD\u8B80\u53D6\u4F86\u6E90\u5DE5\u4F5C\u8868\u6E05\u55AE\u3002", 502);
  const metadata = await response.json();
  const sourceSheets = metadata.sheets.map((s) => s.properties).filter((s) => /^20\d{2}(?:_V2)?$/.test(s.title) || /crypto|月結記錄/i.test(s.title));
  const archive = await Promise.all(sourceSheets.map(async (sheet) => {
    let n = sheet.gridProperties.columnCount;
    let column = "";
    while (n > 0) {
      n--;
      column = String.fromCharCode(65 + n % 26) + column;
      n = Math.floor(n / 26);
    }
    const values = await readSheetValues(token, SHEET, `'${sheet.title.replaceAll("'", "''")}'!A1:${column}${sheet.gridProperties.rowCount}`);
    return { title: sheet.title, values };
  }));
  const source = archive.find((a) => a.title === "2026_V2");
  if (!source) throw new CryptoManagementError("\u4F86\u6E90\u7F3A\u5C11 2026_V2\u3002");
  const parsed = parseCryptoSheet(source.values);
  return { archive, parsed, sourceChecksum: checksum(archive) };
}
async function previewCryptoMigration() {
  const source = await readMigrationSource();
  const stored = await assets();
  const quantities = aggregate(source.parsed.positions);
  return { ...source, differences: Object.entries(quantities).map(([symbol, quantity]) => ({ symbol, quantity, previousQuantity: stored.docs.filter((d) => d.data().accountSource === "Crypto" && !d.data().archivedAt && d.data().symbol === symbol).reduce((sum, d) => sum + (d.data().assetType === "cash" ? d.data().currentPrice : d.data().quantity), 0) })) };
}
function syncAssets(transaction, state, stored, seedQuotes = {}, previousState) {
  const ref = getSharedPortfolioDocRef();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const planned = validateCryptoInput(() => planCryptoAssetSync(state, assetRows(stored.docs), { previous: previousState, quotes: seedQuotes, at: now }));
  if (planned.status.conflicts.length) throw new CryptoManagementError(planned.status.conflicts.join("\uFF1B"), 409);
  for (const write of planned.writes) transaction.set(ref.collection("assets").doc(write.id), { ...write.patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  for (const coin of state.coins) {
    if (coin.priceSource === "coingecko") transaction.set(ref.collection("coinIdOverrides").doc(coin.symbol), { ticker: coin.symbol, coinId: coin.priceSourceId, coinSymbol: coin.symbol, coinName: coin.name, marketCapRank: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  const valuation = valueCrypto(state, { ...quotesFromAssets(stored.docs), ...seedQuotes });
  const unpricedDebt = state.liabilities.filter((d) => d.quantity > 0 && valuation.prices[d.symbol] === null);
  let debtUsd = valuation.debtUsd;
  for (const debt of unpricedDebt) {
    const raw = seedQuotes[debt.symbol] ?? quotesFromAssets(stored.docs)[debt.symbol];
    if (!raw || !(raw.price > 0)) throw new CryptoManagementError(`${debt.symbol} \u501F\u8CB8\u672A\u6709\u50F9\u683C\uFF0C\u8ACB\u5148\u66F4\u65B0\u50F9\u683C\u3002`, 409);
    debtUsd += debt.quantity * raw.price;
  }
  transaction.set(ref.collection("assets").doc("crypto_liabilities"), { name: "Crypto \u501F\u8CB8\u8CA0\u50B5", symbol: "CRYPTO-DEBT", accountSource: "Crypto", assetType: "cash", currency: "USD", quantity: 1, averageCost: 0, currentPrice: -debtUsd, managedCrypto: true, managedCryptoLiability: true, archivedAt: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  transaction.set(ref.collection("accountPrincipals").doc("Crypto"), { accountSource: "Crypto", currency: "HKD", principalAmount: valuation.principalHkd, updatedAt: FieldValue.serverTimestamp(), managedCrypto: true }, { merge: true });
  transaction.set(ref.collection("accountValuationOverrides").doc("Crypto"), { active: false, retiredAt: now, retiredReason: "canonical_quantities" }, { merge: true });
}
async function runCryptoManagement(payload) {
  const action = payload.action ?? "read";
  if (action === "read") return readCryptoManagement();
  if (action === "read-movements") {
    const ref2 = getSharedPortfolioDocRef();
    let query = ref2.collection("cryptoMovements").orderBy("createdAt", "desc").orderBy("__name__", "desc").limit(101);
    if (payload.cursor) {
      const cursor = payload.cursor;
      if (typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt)) || typeof cursor.id !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(cursor.id)) throw new CryptoManagementError("\u7D00\u9304\u5206\u9801\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002");
      query = query.startAfter(cursor.createdAt, cursor.id);
    }
    const [history, opening] = await Promise.all([query.get(), ref2.collection("cryptoMovementOpening").doc("current").get()]);
    const docs = history.docs.slice(0, 100);
    const last = docs.at(-1);
    return { entries: docs.map((d) => ({ ...d.data(), id: d.id })), opening: opening.exists ? opening.data() : null, nextCursor: history.size > 100 && last ? { createdAt: last.data().createdAt, id: last.id } : null };
  }
  if (action === "reconcile-assets") {
    const operationId2 = payload.operationId;
    if (typeof operationId2 !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(operationId2) || typeof payload.expectedAssetsChecksum !== "string") throw new CryptoManagementError("\u540C\u6B65\u8CC7\u6599\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002");
    const ref2 = getSharedPortfolioDocRef();
    try {
      await getFirebaseAdminDb().runTransaction((tx) => commitCryptoAssetReconciliation(tx, { meta: metaRef(), audit: ref2.collection("cryptoManagementAudit").doc(operationId2), assets: ref2.collection("assets") }, payload));
    } catch (e) {
      if (e instanceof CryptoAssetSyncConflict) throw new CryptoManagementError(e.message, 409);
      throw e;
    }
    return readCryptoManagement();
  }
  if (action === "record-movement") {
    const operationId2 = payload.operationId;
    if (typeof operationId2 !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(operationId2)) throw new CryptoManagementError("\u64CD\u4F5C ID \u7121\u6548\u3002");
    const ref2 = getSharedPortfolioDocRef();
    try {
      await getFirebaseAdminDb().runTransaction((tx) => commitCryptoMovement(tx, {
        meta: metaRef(),
        movement: ref2.collection("cryptoMovements").doc(operationId2),
        audit: ref2.collection("cryptoManagementAudit").doc(operationId2),
        opening: ref2.collection("cryptoMovementOpening").doc("current"),
        assets: ref2.collection("assets")
      }, payload, (next, stored, previous) => syncAssets(tx, next, stored, {}, previous)));
    } catch (e) {
      if (e instanceof CryptoMovementConflict) throw new CryptoManagementError(e.message, 409);
      throw e;
    }
    return readCryptoManagement();
  }
  if (action === "update-prices") {
    const meta = await metaRef().get();
    if (!meta.exists || meta.data()?.version !== payload.expectedVersion) throw new CryptoManagementError("\u6301\u5009\u5DF2\u66F4\u65B0\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u3002", 409);
    const state = meta.data();
    const stored = await assets();
    const targets = stored.docs.filter((d) => d.data().accountSource === "Crypto" && d.data().assetType === "crypto" && !d.data().archivedAt && d.data().quantity > 0 && state.coins.some((c) => c.symbol === d.data().symbol && c.priceSource === "coingecko"));
    const results = [];
    for (let i = 0; i < targets.length; i += 10) {
      const group = targets.slice(i, i + 10);
      const response = await generatePriceUpdates({ assets: group.map((d) => ({ assetId: d.id, assetName: d.data().name, ticker: d.data().symbol, assetType: "crypto", accountSource: "Crypto", currentPrice: d.data().currentPrice, currency: "USD" })) });
      results.push(...response.results);
    }
    const valid = results.filter((r) => r.price !== null && r.price > 0 && !r.invalidReason);
    await getFirebaseAdminDb().runTransaction(async (tx) => {
      const latest = await tx.get(metaRef());
      if (latest.data()?.version !== state.version) throw new CryptoManagementError("\u6301\u5009\u6216\u50F9\u683C\u4F86\u6E90\u5DF2\u6539\u8B8A\uFF0C\u8ACB\u91CD\u8A66\u50F9\u683C\u66F4\u65B0\u3002", 409);
      for (const r of valid) {
        const assetRef = getSharedPortfolioDocRef().collection("assets").doc(r.assetId);
        tx.update(assetRef, { currentPrice: r.price, priceAsOf: r.asOf, priceSourceName: r.sourceName, priceSourceUrl: r.sourceUrl, lastPriceUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        tx.create(assetRef.collection("priceHistory").doc(), { assetId: r.assetId, assetName: r.assetName, ticker: r.ticker, assetType: r.assetType, price: r.price, currency: r.currency, asOf: r.asOf, sourceName: r.sourceName, sourceUrl: r.sourceUrl, recordedAt: FieldValue.serverTimestamp() });
      }
    });
    await refreshManagedCrypto();
    return { ...await readCryptoManagement(), priceUpdateSummary: { updated: valid.length, pending: results.length - valid.length } };
  }
  if (action === "source") {
    if (typeof payload.id !== "string") throw new CryptoManagementError("\u4F86\u6E90 ID \u7121\u6548\u3002");
    const doc = await getSharedPortfolioDocRef().collection("cryptoSourceArchive").doc(payload.id).get();
    if (!doc.exists) throw new CryptoManagementError("\u627E\u4E0D\u5230\u4F86\u6E90\u3002", 404);
    const source = doc.data();
    return { source: { ...source, values: source.values.map((row) => row.cells) } };
  }
  if (action === "preview-migration") {
    const preview = await previewCryptoMigration();
    return { sourceChecksum: preview.sourceChecksum, state: preview.parsed, differences: preview.differences, sourceArchive: preview.archive.map((a) => ({ title: a.title, rows: a.values.length })) };
  }
  if (action === "close-month") {
    const result = await closeCryptoMonth(payload.expectedVersion);
    return { result, ...await readCryptoManagement() };
  }
  if (!["migrate", "save"].includes(String(action))) throw new CryptoManagementError("\u672A\u77E5\u7BA1\u7406\u64CD\u4F5C\u3002");
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (reason.length < 2 || reason.length > 300) throw new CryptoManagementError("\u8ACB\u586B\u5BEB\u4FEE\u6539\u539F\u56E0\uFF082 \u81F3 300 \u5B57\uFF09\u3002");
  const operationId = payload.operationId;
  if (typeof operationId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(operationId)) throw new CryptoManagementError("\u64CD\u4F5C ID \u7121\u6548\u3002");
  const completed = await getSharedPortfolioDocRef().collection("cryptoManagementAudit").doc(operationId).get();
  if (completed.exists) {
    if (completed.data()?.requestChecksum !== checksum(payload)) throw new CryptoManagementError("\u64CD\u4F5C ID \u5DF2\u7528\u65BC\u53E6\u4E00\u500B\u64CD\u4F5C\u3002", 409);
    return readCryptoManagement();
  }
  const migration = action === "migrate" ? await previewCryptoMigration() : null;
  if (migration && migration.sourceChecksum !== payload.sourceChecksum) throw new CryptoManagementError("\u4F86\u6E90\u5DF2\u6539\u8B8A\uFF0C\u8ACB\u91CD\u65B0\u6838\u5C0D\u9077\u79FB\u9810\u89BD\u3002", 409);
  const submitted = action === "save" ? validateCryptoInput(() => normalizeCryptoState(JSON.parse(JSON.stringify(payload.state)))) : null;
  if (submitted) validateCryptoInput(() => validateState(submitted));
  const seedQuotes = {};
  if (migration) {
    const { baseUrl, headers } = getCoinGeckoConfig();
    const stablecoins = migration.parsed.coins.filter((c) => c.symbol === "USDT" || c.symbol === "USDC");
    const response = await fetch(`${baseUrl}/simple/price?ids=${stablecoins.map((c) => c.priceSourceId).join(",")}&vs_currencies=usd&include_last_updated_at=true`, { headers, signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new CryptoManagementError("\u7A69\u5B9A\u5E63\u50F9\u683C\u672A\u80FD\u6838\u5C0D\uFF0C\u9077\u79FB\u672A\u6709\u5BEB\u5165\u3002", 502);
    const prices = await response.json();
    for (const coin of stablecoins) {
      const p = prices[coin.priceSourceId];
      if (!p?.usd || !p.last_updated_at) throw new CryptoManagementError(`${coin.symbol} \u50F9\u683C\u7F3A\u5931\uFF0C\u9077\u79FB\u672A\u6709\u5BEB\u5165\u3002`, 502);
      seedQuotes[coin.symbol] = { price: p.usd, at: new Date(p.last_updated_at * 1e3).toISOString() };
    }
  }
  const ref = getSharedPortfolioDocRef();
  const auditRef = ref.collection("cryptoManagementAudit").doc(operationId);
  await getFirebaseAdminDb().runTransaction(async (tx) => {
    const [meta, existingOperation, stored] = await Promise.all([tx.get(metaRef()), tx.get(auditRef), tx.get(ref.collection("assets"))]);
    if (existingOperation.exists) {
      if (existingOperation.data()?.requestChecksum !== checksum(payload)) throw new CryptoManagementError("\u64CD\u4F5C ID \u5DF2\u7528\u65BC\u53E6\u4E00\u500B\u64CD\u4F5C\u3002", 409);
      return;
    }
    const previous = meta.data();
    if (migration && previous) throw new CryptoManagementError("\u5DF2\u5B8C\u6210\u9077\u79FB\uFF0C\u4E0D\u80FD\u518D\u6B21\u8986\u84CB\u3002", 409);
    if (!migration && (!previous || payload.expectedVersion !== previous.version)) throw new CryptoManagementError("\u8CC7\u6599\u5DF2\u88AB\u5176\u4ED6\u64CD\u4F5C\u66F4\u65B0\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u518D\u4FEE\u6539\u3002", 409);
    const next = migration ? { ...migration.parsed, version: 1, migratedAt: (/* @__PURE__ */ new Date()).toISOString(), sourceChecksum: migration.sourceChecksum } : { ...submitted, version: previous.version + 1, migratedAt: previous.migratedAt, sourceChecksum: previous.sourceChecksum };
    validateCryptoInput(() => validateState(next));
    if (previous && action === "save") validateCryptoInput(() => assertRecordedPositions(previous, next, payload.platformRename, payload.stakingRewardLink));
    tx.set(metaRef(), next);
    syncAssets(tx, next, stored, seedQuotes, previous);
    if (previous) {
      const imported = (id) => /^(funding_|opening_)/.test(id);
      for (const row of next.funding.filter((r) => !imported(r.id))) {
        const old = previous.funding.find((r) => r.id === row.id);
        if (!old || checksum(old) !== checksum(row)) tx.set(ref.collection("accountCashFlows").doc(`crypto_funding_${row.id}`), { accountSource: "Crypto", type: row.type, amount: row.hkd || row.usd, currency: row.hkd ? "HKD" : "USD", date: row.date, note: row.source, managedCrypto: true, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      for (const old of previous.funding.filter((r) => !imported(r.id) && !next.funding.some((n) => n.id === r.id))) tx.delete(ref.collection("accountCashFlows").doc(`crypto_funding_${old.id}`));
    }
    if (migration) migration.archive.forEach((a, i) => tx.create(ref.collection("cryptoSourceArchive").doc(`sheet_${i}`), { title: a.title, values: a.values.map((cells) => ({ cells })), spreadsheetId: SHEET, checksum: checksum(a), importedAt: next.migratedAt }));
    tx.create(auditRef, { action: String(action), reason, at: (/* @__PURE__ */ new Date()).toISOString(), version: next.version, previous: previous ?? null, next, requestChecksum: checksum(payload) });
  });
  return readCryptoManagement();
}
async function refreshManagedCrypto() {
  return getFirebaseAdminDb().runTransaction(async (tx) => {
    const [meta, stored] = await Promise.all([tx.get(metaRef()), tx.get(getSharedPortfolioDocRef().collection("assets"))]);
    if (meta.exists) syncAssets(tx, meta.data(), stored);
    return meta.exists;
  });
}
async function closeCryptoMonth(expectedVersion) {
  const ref = getSharedPortfolioDocRef();
  return getFirebaseAdminDb().runTransaction((tx) => commitManualCryptoMonth(tx, ref, expectedVersion));
}
export {
  CryptoManagementError2 as CryptoManagementError,
  closeCryptoMonth,
  previewCryptoMigration,
  readCryptoManagement,
  refreshManagedCrypto,
  runCryptoManagement
};
