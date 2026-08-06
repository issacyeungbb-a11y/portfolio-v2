import { createSign, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "./firebaseAdmin.js";
import { readAdminPortfolioAssets } from "./portfolioSnapshotAdmin.js";
import {
  CRYPTO_MONTH_LOG_HEADERS,
  buildCryptoAssetShadowPreview,
  buildCryptoSyncPlan,
  buildCryptoSyncValidationReport,
  getCryptoHistoricalAuditMonths,
  getCryptoSyncSourceChecksum,
  parseCryptoMonthLogRows
} from "./cryptoMonthlySyncCore.js";
const DEFAULT_SPREADSHEET_ID = "1CrXqZtK2Qy2rivBTN1BZTSbNpAY0Y5P6Rzsg8_OaaI4";
const DEFAULT_SPREADSHEET_TITLE = "crypto";
const DEFAULT_SHEET_NAME = "\u6708\u7D50\u8A18\u9304";
const DEFAULT_SOURCE_RANGE = `'${DEFAULT_SHEET_NAME}'!A1:S500`;
const DEFAULT_DETAIL_RANGE = `'2026_V2'!G38:M73`;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const PORTFOLIO_COLLECTION = "portfolio";
const PORTFOLIO_DOC_ID = "app";
const SNAPSHOT_COLLECTION = "cryptoMonthlySnapshots";
const SYNC_RUN_COLLECTION = "cryptoSyncRuns";
const IMPORT_COLLECTION = "cryptoHistoricalImports";
const ASSET_SYNC_COLLECTION = "cryptoAssetSyncs";
const ACCOUNT_OVERRIDE_COLLECTION = "accountValuationOverrides";
const APPLY_CONFIRMATION = "APPLY_CRYPTO_MONTHLY_SYNC";
const APPLY_ASSET_CONFIRMATION = "APPLY_CRYPTO_ACCOUNT_SHADOW";
class CryptoMonthlySyncError extends Error {
  status;
  constructor(message, status = 500) {
    super(message);
    this.name = "CryptoMonthlySyncError";
    this.status = status;
  }
}
function normalizePrivateKey(value) {
  return value.replace(/\\n/g, "\n").trim();
}
function parseServiceAccountJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CryptoMonthlySyncError("Google Sheet service account JSON \u683C\u5F0F\u4E0D\u6B63\u78BA\u3002", 500);
  }
  const value = parsed;
  const clientEmail = typeof value.client_email === "string" ? value.client_email.trim() : typeof value.clientEmail === "string" ? value.clientEmail.trim() : "";
  const privateKey = typeof value.private_key === "string" ? normalizePrivateKey(value.private_key) : typeof value.privateKey === "string" ? normalizePrivateKey(value.privateKey) : "";
  if (!clientEmail || !privateKey) {
    throw new CryptoMonthlySyncError(
      "Google Sheet service account JSON \u7F3A\u5C11 client_email \u6216 private_key\u3002",
      500
    );
  }
  return { clientEmail, privateKey };
}
function readGoogleServiceAccount() {
  const json = process.env.CRYPTO_SHEET_SERVICE_ACCOUNT_JSON?.trim() || process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (json) {
    return parseServiceAccountJson(json);
  }
  const clientEmail = process.env.CRYPTO_SHEET_CLIENT_EMAIL?.trim() || process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() || "";
  const privateKey = normalizePrivateKey(
    process.env.CRYPTO_SHEET_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY || ""
  );
  if (!clientEmail || !privateKey) {
    throw new CryptoMonthlySyncError(
      "\u672A\u8A2D\u5B9A\u552F\u8B80 Google Sheet \u6191\u8B49\u3002\u8ACB\u8A2D\u5B9A CRYPTO_SHEET_SERVICE_ACCOUNT_JSON\uFF0C\u6216\u8B93 Firebase Admin service account \u4EE5\u6AA2\u8996\u8005\u8EAB\u4EFD\u5B58\u53D6\u5DE5\u4F5C\u8868\u3002",
      500
    );
  }
  return { clientEmail, privateKey };
}
function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
async function getGoogleSheetsAccessToken() {
  const serviceAccount = readGoogleServiceAccount();
  const now = Math.floor(Date.now() / 1e3);
  const unsignedToken = `${encodeJwtPart({ alg: "RS256", typ: "JWT" })}.${encodeJwtPart({
    iss: serviceAccount.clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${signer.sign(serviceAccount.privateKey, "base64url")}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }),
    signal: AbortSignal.timeout(15e3)
  });
  if (!response.ok) {
    throw new CryptoMonthlySyncError(
      `\u672A\u80FD\u53D6\u5F97 Google Sheet \u552F\u8B80\u5B58\u53D6\u6B0A\uFF08HTTP ${response.status}\uFF09\u3002`,
      502
    );
  }
  const payload = await response.json();
  if (!payload.access_token) {
    throw new CryptoMonthlySyncError("Google OAuth \u56DE\u61C9\u7F3A\u5C11 access_token\u3002", 502);
  }
  return payload.access_token;
}
async function readSheetValues(accessToken, spreadsheetId, sourceRange) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sourceRange)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(2e4)
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.error?.message ?? `HTTP ${response.status}`;
    throw new CryptoMonthlySyncError(
      `\u672A\u80FD\u552F\u8B80\u300C${sourceRange}\u300D\uFF1A${detail}\u3002\u8ACB\u78BA\u8A8D service account \u5DF2\u7372\u5DE5\u4F5C\u8868\u6AA2\u8996\u6B0A\u9650\u3002`,
      response.status === 403 ? 403 : 502
    );
  }
  return payload.values ?? [];
}
async function readLockedMonthLog(includeAssetShadow = false) {
  const spreadsheetId = process.env.CRYPTO_SHEET_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
  const sourceRange = process.env.CRYPTO_SHEET_SOURCE_RANGE?.trim() || DEFAULT_SOURCE_RANGE;
  const detailRange = process.env.CRYPTO_SHEET_DETAIL_RANGE?.trim() || DEFAULT_DETAIL_RANGE;
  const accessToken = await getGoogleSheetsAccessToken();
  const [values, detailValues] = await Promise.all([
    readSheetValues(accessToken, spreadsheetId, sourceRange),
    includeAssetShadow ? readSheetValues(accessToken, spreadsheetId, detailRange) : Promise.resolve([])
  ]);
  return {
    spreadsheetId,
    sourceRange,
    detailRange,
    values,
    detailValues
  };
}
function getPortfolioRef() {
  return getFirebaseAdminDb().collection(PORTFOLIO_COLLECTION).doc(PORTFOLIO_DOC_ID);
}
async function readExistingSnapshots() {
  const snapshot = await getPortfolioRef().collection(SNAPSHOT_COLLECTION).get();
  return new Map(
    snapshot.docs.map((document) => [
      document.id,
      { id: document.id, ...document.data() }
    ])
  );
}
async function readLatestHistoricalImportMonth() {
  const snapshot = await getPortfolioRef().collection(IMPORT_COLLECTION).orderBy("importedAt", "desc").limit(1).get();
  const lastMonth = snapshot.docs[0]?.data().lastMonth;
  return typeof lastMonth === "string" ? lastMonth : null;
}
function warningCount(snapshots) {
  return snapshots.reduce((total, snapshot) => total + snapshot.warnings.length, 0);
}
function warningSummary(snapshots) {
  return snapshots.flatMap((snapshot) => snapshot.warnings).reduce(
    (summary, warning) => {
      summary[warning.code] = (summary[warning.code] ?? 0) + 1;
      return summary;
    },
    {}
  );
}
function summarizePlan(plan) {
  return {
    createCount: plan.creates.length,
    skipCount: plan.skips.length,
    conflictCount: plan.conflicts.length,
    creates: plan.creates.map((snapshot) => snapshot.month),
    skips: plan.skips.map((snapshot) => snapshot.month),
    conflicts: plan.conflicts
  };
}
function buildSyncRun(runId, status, sourceChecksum, snapshots, plan, errorMessage) {
  return {
    id: runId,
    runId,
    mode: "apply",
    status,
    sourceType: "google_sheet_read_only",
    sourceSpreadsheetId: process.env.CRYPTO_SHEET_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID,
    sourceSheet: DEFAULT_SHEET_NAME,
    sourceRange: process.env.CRYPTO_SHEET_SOURCE_RANGE?.trim() || DEFAULT_SOURCE_RANGE,
    sourceChecksum,
    detectedMonthCount: snapshots.length,
    firstMonth: snapshots[0]?.month ?? null,
    lastMonth: snapshots.at(-1)?.month ?? null,
    warningCount: warningCount(snapshots),
    warningSummary: warningSummary(snapshots),
    validatedFieldCount: CRYPTO_MONTH_LOG_HEADERS.length,
    validatedMonthCount: snapshots.length,
    ...summarizePlan(plan),
    sourceReadOnly: true,
    errorMessage,
    startedAt: FieldValue.serverTimestamp(),
    finishedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}
function buildHistoricalImport(runId, sourceChecksum, snapshots, plan, auditedMonths) {
  return {
    id: runId,
    importBatchId: runId,
    sourceSpreadsheetId: process.env.CRYPTO_SHEET_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID,
    sourceSpreadsheetTitle: DEFAULT_SPREADSHEET_TITLE,
    sourceSheets: [DEFAULT_SHEET_NAME],
    sourceType: "google_sheet_read_only",
    status: "completed",
    successMonthCount: snapshots.length,
    createdMonthCount: auditedMonths.length,
    skippedDuplicateMonthCount: Math.max(0, snapshots.length - auditedMonths.length),
    warningCount: warningCount(snapshots),
    warningSummary: warningSummary(snapshots),
    validatedFieldCount: CRYPTO_MONTH_LOG_HEADERS.length,
    validatedMonthCount: snapshots.length,
    firstMonth: snapshots[0]?.month ?? null,
    lastMonth: snapshots.at(-1)?.month ?? null,
    auditedMonths,
    batchChecksum: sourceChecksum,
    validationPassed: true,
    sourceReadOnly: true,
    reconciledFromExistingSnapshots: plan.creates.length === 0 && auditedMonths.length > 0,
    importedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}
async function verifyAppliedSync(runId, plan, auditedMonths) {
  const portfolioRef = getPortfolioRef();
  const snapshotRefs = plan.creates.map(
    (snapshot) => portfolioRef.collection(SNAPSHOT_COLLECTION).doc(snapshot.id)
  );
  const runRef = portfolioRef.collection(SYNC_RUN_COLLECTION).doc(runId);
  const importRef = portfolioRef.collection(IMPORT_COLLECTION).doc(runId);
  const [storedSnapshots, storedRun, storedImport] = await Promise.all([
    Promise.all(snapshotRefs.map((reference) => reference.get())),
    runRef.get(),
    auditedMonths.length > 0 ? importRef.get() : Promise.resolve(null)
  ]);
  const storedById = new Map(
    storedSnapshots.filter((document) => document.exists).map((document) => [
      document.id,
      { id: document.id, ...document.data() }
    ])
  );
  const readbackPlan = buildCryptoSyncPlan(plan.creates, storedById);
  if (readbackPlan.creates.length > 0 || readbackPlan.conflicts.length > 0) {
    throw new CryptoMonthlySyncError(
      `Firestore \u5BEB\u5165\u5F8C\u56DE\u8B80\u6838\u5C0D\u5931\u6557\uFF1A${[
        ...readbackPlan.creates.map((snapshot) => `${snapshot.month} \u7F3A\u5C11\u5FEB\u7167`),
        ...readbackPlan.conflicts.map(
          (conflict) => `${conflict.month} \u6B04\u4F4D\u5DEE\u7570 ${conflict.differingFields.join("\u3001")}`
        )
      ].join("\uFF1B")}`,
      500
    );
  }
  const runData = storedRun.data();
  if (!storedRun.exists || runData?.status !== "completed") {
    throw new CryptoMonthlySyncError("Firestore \u5BEB\u5165\u5F8C\u672A\u80FD\u56DE\u8B80\u5DF2\u5B8C\u6210\u7684 cryptoSyncRuns\u3002", 500);
  }
  if (auditedMonths.length > 0) {
    const importData = storedImport?.data();
    const storedAuditedMonths = Array.isArray(importData?.auditedMonths) ? importData.auditedMonths : [];
    if (!storedImport?.exists || importData?.status !== "completed" || JSON.stringify(storedAuditedMonths) !== JSON.stringify(auditedMonths)) {
      throw new CryptoMonthlySyncError(
        "Firestore \u5BEB\u5165\u5F8C\u672A\u80FD\u56DE\u8B80\u4E00\u81F4\u7684 cryptoHistoricalImports \u5BE9\u8A08\u8A18\u9304\u3002",
        500
      );
    }
  }
  return {
    verified: true,
    snapshotMonths: plan.creates.map((snapshot) => snapshot.month),
    auditMonths: auditedMonths,
    syncRunId: runId,
    historicalImportId: auditedMonths.length > 0 ? runId : null
  };
}
async function applyPlan(snapshots, sourceChecksum) {
  const db = getFirebaseAdminDb();
  const portfolioRef = getPortfolioRef();
  const snapshotRefs = snapshots.map(
    (snapshot) => portfolioRef.collection(SNAPSHOT_COLLECTION).doc(snapshot.id)
  );
  const runId = `crypto-sync-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runRef = portfolioRef.collection(SYNC_RUN_COLLECTION).doc(runId);
  const importRef = portfolioRef.collection(IMPORT_COLLECTION).doc(runId);
  const latestImportQuery = portfolioRef.collection(IMPORT_COLLECTION).orderBy("importedAt", "desc").limit(1);
  let transactionCommitted = false;
  try {
    const applied = await db.runTransaction(async (transaction) => {
      const [storedDocuments, latestImports] = await Promise.all([
        Promise.all(snapshotRefs.map((reference) => transaction.get(reference))),
        transaction.get(latestImportQuery)
      ]);
      const storedById = new Map(
        storedDocuments.filter((document) => document.exists).map((document) => [
          document.id,
          { id: document.id, ...document.data() }
        ])
      );
      const plan = buildCryptoSyncPlan(snapshots, storedById);
      if (plan.conflicts.length > 0) {
        throw new CryptoMonthlySyncError(
          `\u5DF2\u9396\u5B9A\u6708\u4EFD\u51FA\u73FE\u5DEE\u7570\uFF1A${plan.conflicts.map((item) => item.month).join("\u3001")}\u3002\u540C\u6B65\u5DF2\u505C\u6B62\uFF0C\u6C92\u6709\u8986\u84CB\u8CC7\u6599\u3002`,
          409
        );
      }
      for (const snapshot of plan.creates) {
        const reference = portfolioRef.collection(SNAPSHOT_COLLECTION).doc(snapshot.id);
        transaction.create(reference, {
          ...snapshot,
          importedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      const latestImportedMonth = latestImports.docs[0]?.data().lastMonth;
      const auditedMonths = getCryptoHistoricalAuditMonths(
        snapshots,
        plan.creates.map((snapshot) => snapshot.month),
        typeof latestImportedMonth === "string" ? latestImportedMonth : null
      );
      if (auditedMonths.length > 0) {
        transaction.create(
          importRef,
          buildHistoricalImport(runId, sourceChecksum, snapshots, plan, auditedMonths)
        );
      }
      transaction.set(
        runRef,
        buildSyncRun(runId, "completed", sourceChecksum, snapshots, plan, null)
      );
      return { plan, auditedMonths };
    });
    transactionCommitted = true;
    const readback = await verifyAppliedSync(runId, applied.plan, applied.auditedMonths);
    return { runId, ...applied, readback };
  } catch (error) {
    if (transactionCommitted) {
      throw error;
    }
    const existing = await readExistingSnapshots();
    const failedPlan = buildCryptoSyncPlan(snapshots, existing);
    const syncError = error instanceof Error ? error.message : String(error);
    const status = error instanceof CryptoMonthlySyncError && error.status === 409 ? "conflict" : "failed";
    try {
      await runRef.set(
        buildSyncRun(runId, status, sourceChecksum, snapshots, failedPlan, syncError)
      );
    } catch (runWriteError) {
      console.warn(
        "[crypto-monthly-sync] \u672A\u80FD\u8A18\u9304\u5931\u6557 run\uFF1A",
        runWriteError instanceof Error ? runWriteError.message : String(runWriteError)
      );
    }
    throw error;
  }
}
async function applyCryptoAccountValuationOverride(params) {
  const { snapshot, shadow, detailValues, trigger } = params;
  const db = getFirebaseAdminDb();
  const portfolioRef = getPortfolioRef();
  const snapshotRef = portfolioRef.collection(SNAPSHOT_COLLECTION).doc(snapshot.id);
  const overrideRef = portfolioRef.collection(ACCOUNT_OVERRIDE_COLLECTION).doc("Crypto");
  const auditRef = portfolioRef.collection(ASSET_SYNC_COLLECTION).doc(snapshot.id);
  const result = await db.runTransaction(async (transaction) => {
    const [storedSnapshot, existingAudit] = await Promise.all([
      transaction.get(snapshotRef),
      transaction.get(auditRef)
    ]);
    const storedSourceChecksum = storedSnapshot.data()?.sourceChecksum;
    if (!storedSnapshot.exists || storedSourceChecksum !== snapshot.sourceChecksum) {
      throw new CryptoMonthlySyncError(
        `${snapshot.month} \u9396\u5B9A\u6708\u7D50\u672A\u80FD\u5728 Firestore \u56DE\u8B80\u4E00\u81F4\uFF0CCrypto \u5E33\u6236\u540C\u6B65\u5DF2\u505C\u6B62\u3002`,
        409
      );
    }
    if (existingAudit.exists) {
      const audit = existingAudit.data();
      if (audit.sourceChecksum === snapshot.sourceChecksum && audit.shadowChecksum === shadow.shadowChecksum && audit.status === "completed") {
        return { skipped: true };
      }
      throw new CryptoMonthlySyncError(
        `${snapshot.month} \u5DF2\u6709\u4E0D\u540C\u7684 Crypto \u5E33\u6236\u540C\u6B65\u5BE9\u8A08\uFF0C\u6C92\u6709\u8986\u84CB\u3002`,
        409
      );
    }
    const overridePayload = {
      accountSource: "Crypto",
      active: true,
      month: snapshot.month,
      targetTotalUsd: snapshot.performanceTotalUsd,
      targetTotalHkd: snapshot.totalHkd,
      usdHkdRate: snapshot.usdHkdRate,
      sourceSnapshotId: snapshot.id,
      sourceChecksum: snapshot.sourceChecksum,
      shadowChecksum: shadow.shadowChecksum,
      applicationMode: "proportional_account_overlay",
      separateWithdrawalsUsd: snapshot.cumulativeWithdrawnUsd,
      detailPositionSubtotalUsd: shadow.detailPositionSubtotalUsd,
      detailToTargetDifferenceUsd: shadow.detailToTargetDifferenceUsd,
      excludedAccountSources: ["Futu"],
      updatedAt: FieldValue.serverTimestamp(),
      confirmedAt: FieldValue.serverTimestamp()
    };
    transaction.set(overrideRef, overridePayload);
    transaction.create(auditRef, {
      id: snapshot.id,
      month: snapshot.month,
      status: "completed",
      trigger,
      accountSource: "Crypto",
      sourceSnapshotId: snapshot.id,
      sourceChecksum: snapshot.sourceChecksum,
      shadowChecksum: shadow.shadowChecksum,
      applicationMode: "proportional_account_overlay",
      beforeTotalUsd: shadow.currentAccountTotalUsd,
      beforeTotalHkd: shadow.currentAccountTotalHkd,
      targetTotalUsd: snapshot.performanceTotalUsd,
      targetTotalHkd: snapshot.totalHkd,
      differenceUsd: shadow.differenceUsd,
      differenceHkd: shadow.differenceHkd,
      cryptoAssetCount: shadow.cryptoAssetCount,
      excludedFutuAssetCount: shadow.excludedFutuAssetCount,
      excludedFutuValueUsd: shadow.excludedFutuValueUsd,
      separateWithdrawalsUsd: snapshot.cumulativeWithdrawnUsd,
      detailPositionSubtotalUsd: shadow.detailPositionSubtotalUsd,
      detailToTargetDifferenceUsd: shadow.detailToTargetDifferenceUsd,
      firestoreAssetWrites: 0,
      firestoreOverrideWrites: 1,
      googleSheetWrites: 0,
      transactionWrites: 0,
      snapshotWrites: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return { skipped: false };
  });
  const [overrideDocument, auditDocument, effectiveAssets] = await Promise.all([
    overrideRef.get(),
    auditRef.get(),
    readAdminPortfolioAssets()
  ]);
  const readbackShadow = buildCryptoAssetShadowPreview(
    snapshot,
    detailValues,
    effectiveAssets,
    shadow.sourceDetailRange
  );
  if (!overrideDocument.exists || !auditDocument.exists) {
    throw new CryptoMonthlySyncError("Crypto \u5E33\u6236\u540C\u6B65\u5BEB\u5165\u5F8C\u56DE\u8B80\u6587\u4EF6\u4E0D\u5B8C\u6574\u3002", 500);
  }
  if (Math.abs(readbackShadow.differenceHkd) > 1) {
    throw new CryptoMonthlySyncError(
      `Crypto \u5E33\u6236\u540C\u6B65\u56DE\u8B80\u4ECD\u76F8\u5DEE HK$${readbackShadow.differenceHkd.toFixed(2)}\u3002`,
      500
    );
  }
  return {
    applied: !result.skipped,
    skipped: result.skipped,
    verified: true,
    month: snapshot.month,
    accountSource: "Crypto",
    targetTotalUsd: snapshot.performanceTotalUsd,
    targetTotalHkd: snapshot.totalHkd,
    readbackTotalUsd: readbackShadow.currentAccountTotalUsd,
    readbackTotalHkd: readbackShadow.currentAccountTotalHkd,
    differenceUsd: readbackShadow.differenceUsd,
    differenceHkd: readbackShadow.differenceHkd,
    cryptoAssetCount: readbackShadow.cryptoAssetCount,
    excludedFutuAssetCount: readbackShadow.excludedFutuAssetCount,
    firestoreAssetWrites: 0,
    firestoreOverrideWrites: result.skipped ? 0 : 1,
    auditId: snapshot.id
  };
}
async function runCryptoMonthlySync(options = {}) {
  const apply = options.apply === true;
  const applyAssetShadow = options.applyAssetShadow === true;
  if (apply && options.confirmation !== APPLY_CONFIRMATION) {
    throw new CryptoMonthlySyncError("\u7F3A\u5C11\u6B63\u5F0F\u540C\u6B65\u78BA\u8A8D\u5B57\u4E32\uFF0C\u6C92\u6709\u5BEB\u5165\u4EFB\u4F55\u8CC7\u6599\u3002", 400);
  }
  if (applyAssetShadow && options.assetConfirmation !== APPLY_ASSET_CONFIRMATION) {
    throw new CryptoMonthlySyncError("\u7F3A\u5C11 Crypto \u5E33\u6236\u6B63\u5F0F\u540C\u6B65\u78BA\u8A8D\u5B57\u4E32\uFF0C\u6C92\u6709\u5BEB\u5165\u4EFB\u4F55\u8CC7\u6599\u3002", 400);
  }
  if (apply && applyAssetShadow) {
    throw new CryptoMonthlySyncError("\u6708\u7D50\u5BEB\u5165\u8207\u7368\u7ACB\u5E33\u6236\u540C\u6B65\u4E0D\u53EF\u5728\u540C\u4E00\u8ACB\u6C42\u91CD\u8907\u57F7\u884C\u3002", 400);
  }
  const includeAssetShadow = apply || applyAssetShadow || options.includeAssetShadow === true;
  const source = await readLockedMonthLog(includeAssetShadow);
  const snapshots = parseCryptoMonthLogRows(source.values, {
    spreadsheetId: source.spreadsheetId,
    spreadsheetTitle: DEFAULT_SPREADSHEET_TITLE,
    sheetName: DEFAULT_SHEET_NAME
  });
  const sourceChecksum = getCryptoSyncSourceChecksum(snapshots);
  if ((apply || applyAssetShadow) && (!options.expectedSourceChecksum || options.expectedSourceChecksum !== sourceChecksum)) {
    throw new CryptoMonthlySyncError(
      "Google Sheet \u5167\u5BB9\u5DF2\u5728 preview \u5F8C\u6539\u8B8A\uFF0C\u8ACB\u91CD\u65B0\u6AA2\u67E5\u518D\u78BA\u8A8D\u540C\u6B65\u3002",
      409
    );
  }
  const [existing, latestImportedMonth, portfolioAssets] = await Promise.all([
    readExistingSnapshots(),
    readLatestHistoricalImportMonth(),
    includeAssetShadow ? readAdminPortfolioAssets() : Promise.resolve([])
  ]);
  const previewPlan = buildCryptoSyncPlan(snapshots, existing);
  const previewAuditMonths = getCryptoHistoricalAuditMonths(
    snapshots,
    previewPlan.creates.map((snapshot) => snapshot.month),
    latestImportedMonth
  );
  const previewValidationReport = buildCryptoSyncValidationReport(snapshots, previewPlan);
  const latestSnapshot = snapshots.at(-1);
  const assetShadow = includeAssetShadow && latestSnapshot ? buildCryptoAssetShadowPreview(
    latestSnapshot,
    source.detailValues,
    portfolioAssets,
    source.detailRange
  ) : void 0;
  if (applyAssetShadow && (!assetShadow || !options.expectedAssetShadowChecksum || options.expectedAssetShadowChecksum !== assetShadow.shadowChecksum)) {
    throw new CryptoMonthlySyncError(
      "Crypto \u5E33\u6236\u6216\u6708\u7D50\u5167\u5BB9\u5DF2\u5728\u5F71\u5B50 preview \u5F8C\u6539\u8B8A\uFF0C\u8ACB\u91CD\u65B0\u6AA2\u67E5\u518D\u78BA\u8A8D\u540C\u6B65\u3002",
      409
    );
  }
  if (apply && previewPlan.conflicts.length > 0) {
    throw new CryptoMonthlySyncError(
      `\u5DF2\u9396\u5B9A\u6708\u4EFD\u51FA\u73FE\u5DEE\u7570\uFF1A${previewPlan.conflicts.map((item) => item.month).join("\u3001")}\u3002\u6C92\u6709\u5BEB\u5165\u4EFB\u4F55\u8CC7\u6599\u3002`,
      409
    );
  }
  if (!apply) {
    if (applyAssetShadow && latestSnapshot && assetShadow) {
      const assetReadback2 = await applyCryptoAccountValuationOverride({
        snapshot: latestSnapshot,
        shadow: assetShadow,
        detailValues: source.detailValues,
        trigger: "explicit_confirmation"
      });
      return {
        ok: true,
        mode: "asset_apply",
        sourceReadOnly: true,
        sourceSpreadsheetId: source.spreadsheetId,
        sourceSheet: DEFAULT_SHEET_NAME,
        sourceRange: source.sourceRange,
        sourceChecksum,
        checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
        assetShadow,
        assetReadback: assetReadback2,
        ...summarizePlan(previewPlan)
      };
    }
    return {
      ok: true,
      mode: "preview",
      sourceReadOnly: true,
      sourceSpreadsheetId: source.spreadsheetId,
      sourceSheet: DEFAULT_SHEET_NAME,
      sourceRange: source.sourceRange,
      sourceChecksum,
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      detectedMonthCount: snapshots.length,
      firstMonth: snapshots[0]?.month ?? null,
      lastMonth: snapshots.at(-1)?.month ?? null,
      warningCount: warningCount(snapshots),
      warningSummary: warningSummary(snapshots),
      auditCreateCount: previewAuditMonths.length,
      auditMonths: previewAuditMonths,
      validationReport: previewValidationReport,
      ...assetShadow ? { assetShadow } : {},
      ...summarizePlan(previewPlan)
    };
  }
  const applied = await applyPlan(snapshots, sourceChecksum);
  const assetReadback = latestSnapshot && assetShadow ? await applyCryptoAccountValuationOverride({
    snapshot: latestSnapshot,
    shadow: assetShadow,
    detailValues: source.detailValues,
    trigger: "confirmed_history_import"
  }) : null;
  return {
    ok: true,
    mode: "apply",
    runId: applied.runId,
    sourceReadOnly: true,
    sourceSpreadsheetId: source.spreadsheetId,
    sourceSheet: DEFAULT_SHEET_NAME,
    sourceRange: source.sourceRange,
    sourceChecksum,
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    detectedMonthCount: snapshots.length,
    firstMonth: snapshots[0]?.month ?? null,
    lastMonth: snapshots.at(-1)?.month ?? null,
    warningCount: warningCount(snapshots),
    warningSummary: warningSummary(snapshots),
    auditCreateCount: applied.auditedMonths.length,
    auditMonths: applied.auditedMonths,
    validationReport: buildCryptoSyncValidationReport(snapshots, applied.plan),
    readback: applied.readback,
    assetReadback,
    ...summarizePlan(applied.plan)
  };
}
function getCryptoMonthlySyncErrorResponse(error) {
  if (error instanceof CryptoMonthlySyncError) {
    return {
      status: error.status,
      body: { ok: false, mode: "crypto-sync", message: error.message }
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      body: { ok: false, mode: "crypto-sync", message: error.message }
    };
  }
  return {
    status: 500,
    body: { ok: false, mode: "crypto-sync", message: "Crypto \u6708\u7D50\u540C\u6B65\u5931\u6557\u3002" }
  };
}
export {
  CryptoMonthlySyncError,
  getCryptoMonthlySyncErrorResponse,
  runCryptoMonthlySync
};
