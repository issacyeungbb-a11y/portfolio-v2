import { createSign, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "./firebaseAdmin.js";
import {
  buildCryptoSyncPlan,
  getCryptoSyncSourceChecksum,
  parseCryptoMonthLogRows
} from "./cryptoMonthlySyncCore.js";
const DEFAULT_SPREADSHEET_ID = "1CrXqZtK2Qy2rivBTN1BZTSbNpAY0Y5P6Rzsg8_OaaI4";
const DEFAULT_SPREADSHEET_TITLE = "crypto";
const DEFAULT_SHEET_NAME = "\u6708\u7D50\u8A18\u9304";
const DEFAULT_SOURCE_RANGE = `'${DEFAULT_SHEET_NAME}'!A1:S500`;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const PORTFOLIO_COLLECTION = "portfolio";
const PORTFOLIO_DOC_ID = "app";
const SNAPSHOT_COLLECTION = "cryptoMonthlySnapshots";
const SYNC_RUN_COLLECTION = "cryptoSyncRuns";
const APPLY_CONFIRMATION = "APPLY_CRYPTO_MONTHLY_SYNC";
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
async function readLockedMonthLog() {
  const spreadsheetId = process.env.CRYPTO_SHEET_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
  const sourceRange = process.env.CRYPTO_SHEET_SOURCE_RANGE?.trim() || DEFAULT_SOURCE_RANGE;
  const accessToken = await getGoogleSheetsAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sourceRange)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(2e4)
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.error?.message ?? `HTTP ${response.status}`;
    throw new CryptoMonthlySyncError(
      `\u672A\u80FD\u552F\u8B80\u300C\u6708\u7D50\u8A18\u9304\u300D\uFF1A${detail}\u3002\u8ACB\u78BA\u8A8D service account \u5DF2\u7372\u5DE5\u4F5C\u8868\u6AA2\u8996\u6B0A\u9650\u3002`,
      response.status === 403 ? 403 : 502
    );
  }
  return {
    spreadsheetId,
    sourceRange,
    values: payload.values ?? []
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
    ...summarizePlan(plan),
    sourceReadOnly: true,
    errorMessage,
    startedAt: FieldValue.serverTimestamp(),
    finishedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
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
  try {
    const finalPlan = await db.runTransaction(async (transaction) => {
      const storedDocuments = await Promise.all(
        snapshotRefs.map((reference) => transaction.get(reference))
      );
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
      transaction.set(
        runRef,
        buildSyncRun(runId, "completed", sourceChecksum, snapshots, plan, null)
      );
      return plan;
    });
    return { runId, plan: finalPlan };
  } catch (error) {
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
async function runCryptoMonthlySync(options = {}) {
  const apply = options.apply === true;
  if (apply && options.confirmation !== APPLY_CONFIRMATION) {
    throw new CryptoMonthlySyncError("\u7F3A\u5C11\u6B63\u5F0F\u540C\u6B65\u78BA\u8A8D\u5B57\u4E32\uFF0C\u6C92\u6709\u5BEB\u5165\u4EFB\u4F55\u8CC7\u6599\u3002", 400);
  }
  const source = await readLockedMonthLog();
  const snapshots = parseCryptoMonthLogRows(source.values, {
    spreadsheetId: source.spreadsheetId,
    spreadsheetTitle: DEFAULT_SPREADSHEET_TITLE,
    sheetName: DEFAULT_SHEET_NAME
  });
  const sourceChecksum = getCryptoSyncSourceChecksum(snapshots);
  if (apply && (!options.expectedSourceChecksum || options.expectedSourceChecksum !== sourceChecksum)) {
    throw new CryptoMonthlySyncError(
      "Google Sheet \u5167\u5BB9\u5DF2\u5728 preview \u5F8C\u6539\u8B8A\uFF0C\u8ACB\u91CD\u65B0\u6AA2\u67E5\u518D\u78BA\u8A8D\u540C\u6B65\u3002",
      409
    );
  }
  const existing = await readExistingSnapshots();
  const previewPlan = buildCryptoSyncPlan(snapshots, existing);
  if (apply && previewPlan.conflicts.length > 0) {
    throw new CryptoMonthlySyncError(
      `\u5DF2\u9396\u5B9A\u6708\u4EFD\u51FA\u73FE\u5DEE\u7570\uFF1A${previewPlan.conflicts.map((item) => item.month).join("\u3001")}\u3002\u6C92\u6709\u5BEB\u5165\u4EFB\u4F55\u8CC7\u6599\u3002`,
      409
    );
  }
  if (!apply) {
    return {
      ok: true,
      mode: "preview",
      sourceReadOnly: true,
      sourceSpreadsheetId: source.spreadsheetId,
      sourceSheet: DEFAULT_SHEET_NAME,
      sourceRange: source.sourceRange,
      sourceChecksum,
      detectedMonthCount: snapshots.length,
      firstMonth: snapshots[0]?.month ?? null,
      lastMonth: snapshots.at(-1)?.month ?? null,
      warningCount: warningCount(snapshots),
      warningSummary: warningSummary(snapshots),
      ...summarizePlan(previewPlan)
    };
  }
  const applied = await applyPlan(snapshots, sourceChecksum);
  return {
    ok: true,
    mode: "apply",
    runId: applied.runId,
    sourceReadOnly: true,
    sourceSpreadsheetId: source.spreadsheetId,
    sourceSheet: DEFAULT_SHEET_NAME,
    sourceRange: source.sourceRange,
    sourceChecksum,
    detectedMonthCount: snapshots.length,
    firstMonth: snapshots[0]?.month ?? null,
    lastMonth: snapshots.at(-1)?.month ?? null,
    warningCount: warningCount(snapshots),
    warningSummary: warningSummary(snapshots),
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
