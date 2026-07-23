import { createSign, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from './firebaseAdmin.js';
import {
  buildCryptoSyncPlan,
  getCryptoSyncSourceChecksum,
  parseCryptoMonthLogRows,
  type CryptoSyncPlan,
  type CryptoSyncSnapshot,
} from './cryptoMonthlySyncCore.js';

const DEFAULT_SPREADSHEET_ID = '1CrXqZtK2Qy2rivBTN1BZTSbNpAY0Y5P6Rzsg8_OaaI4';
const DEFAULT_SPREADSHEET_TITLE = 'crypto';
const DEFAULT_SHEET_NAME = '月結記錄';
const DEFAULT_SOURCE_RANGE = `'${DEFAULT_SHEET_NAME}'!A1:S500`;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const PORTFOLIO_COLLECTION = 'portfolio';
const PORTFOLIO_DOC_ID = 'app';
const SNAPSHOT_COLLECTION = 'cryptoMonthlySnapshots';
const SYNC_RUN_COLLECTION = 'cryptoSyncRuns';
const APPLY_CONFIRMATION = 'APPLY_CRYPTO_MONTHLY_SYNC';

interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
}

interface CryptoMonthlySyncOptions {
  apply?: boolean;
  confirmation?: string;
  expectedSourceChecksum?: string;
}

interface SheetsValuesResponse {
  range?: string;
  values?: unknown[][];
  error?: { message?: string };
}

export class CryptoMonthlySyncError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'CryptoMonthlySyncError';
    this.status = status;
  }
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n').trim();
}

function parseServiceAccountJson(raw: string): GoogleServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CryptoMonthlySyncError('Google Sheet service account JSON 格式不正確。', 500);
  }

  const value = parsed as Record<string, unknown>;
  const clientEmail =
    typeof value.client_email === 'string'
      ? value.client_email.trim()
      : typeof value.clientEmail === 'string'
        ? value.clientEmail.trim()
        : '';
  const privateKey =
    typeof value.private_key === 'string'
      ? normalizePrivateKey(value.private_key)
      : typeof value.privateKey === 'string'
        ? normalizePrivateKey(value.privateKey)
        : '';

  if (!clientEmail || !privateKey) {
    throw new CryptoMonthlySyncError(
      'Google Sheet service account JSON 缺少 client_email 或 private_key。',
      500,
    );
  }

  return { clientEmail, privateKey };
}

function readGoogleServiceAccount(): GoogleServiceAccount {
  const json =
    process.env.CRYPTO_SHEET_SERVICE_ACCOUNT_JSON?.trim() ||
    process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim() ||
    '';

  if (json) {
    return parseServiceAccountJson(json);
  }

  const clientEmail =
    process.env.CRYPTO_SHEET_CLIENT_EMAIL?.trim() ||
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() ||
    '';
  const privateKey = normalizePrivateKey(
    process.env.CRYPTO_SHEET_PRIVATE_KEY ||
      process.env.FIREBASE_ADMIN_PRIVATE_KEY ||
      '',
  );

  if (!clientEmail || !privateKey) {
    throw new CryptoMonthlySyncError(
      '未設定唯讀 Google Sheet 憑證。請設定 CRYPTO_SHEET_SERVICE_ACCOUNT_JSON，或讓 Firebase Admin service account 以檢視者身份存取工作表。',
      500,
    );
  }

  return { clientEmail, privateKey };
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function getGoogleSheetsAccessToken() {
  const serviceAccount = readGoogleServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsignedToken = `${encodeJwtPart({ alg: 'RS256', typ: 'JWT' })}.${encodeJwtPart({
    iss: serviceAccount.clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${signer.sign(serviceAccount.privateKey, 'base64url')}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new CryptoMonthlySyncError(
      `未能取得 Google Sheet 唯讀存取權（HTTP ${response.status}）。`,
      502,
    );
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new CryptoMonthlySyncError('Google OAuth 回應缺少 access_token。', 502);
  }

  return payload.access_token;
}

async function readLockedMonthLog() {
  const spreadsheetId =
    process.env.CRYPTO_SHEET_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
  const sourceRange =
    process.env.CRYPTO_SHEET_SOURCE_RANGE?.trim() || DEFAULT_SOURCE_RANGE;
  const accessToken = await getGoogleSheetsAccessToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(sourceRange)}` +
    '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as SheetsValuesResponse;

  if (!response.ok) {
    const detail = payload.error?.message ?? `HTTP ${response.status}`;
    throw new CryptoMonthlySyncError(
      `未能唯讀「月結記錄」：${detail}。請確認 service account 已獲工作表檢視權限。`,
      response.status === 403 ? 403 : 502,
    );
  }

  return {
    spreadsheetId,
    sourceRange,
    values: payload.values ?? [],
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
      { id: document.id, ...(document.data() as Record<string, unknown>) },
    ]),
  );
}

function warningCount(snapshots: CryptoSyncSnapshot[]) {
  return snapshots.reduce((total, snapshot) => total + snapshot.warnings.length, 0);
}

function warningSummary(snapshots: CryptoSyncSnapshot[]) {
  return snapshots.flatMap((snapshot) => snapshot.warnings).reduce<Record<string, number>>(
    (summary, warning) => {
      summary[warning.code] = (summary[warning.code] ?? 0) + 1;
      return summary;
    },
    {},
  );
}

function summarizePlan(plan: CryptoSyncPlan) {
  return {
    createCount: plan.creates.length,
    skipCount: plan.skips.length,
    conflictCount: plan.conflicts.length,
    creates: plan.creates.map((snapshot) => snapshot.month),
    skips: plan.skips.map((snapshot) => snapshot.month),
    conflicts: plan.conflicts,
  };
}

function buildSyncRun(
  runId: string,
  status: 'completed' | 'conflict' | 'failed',
  sourceChecksum: string,
  snapshots: CryptoSyncSnapshot[],
  plan: CryptoSyncPlan,
  errorMessage: string | null,
) {
  return {
    id: runId,
    runId,
    mode: 'apply',
    status,
    sourceType: 'google_sheet_read_only',
    sourceSpreadsheetId:
      process.env.CRYPTO_SHEET_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID,
    sourceSheet: DEFAULT_SHEET_NAME,
    sourceRange:
      process.env.CRYPTO_SHEET_SOURCE_RANGE?.trim() || DEFAULT_SOURCE_RANGE,
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
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function applyPlan(
  snapshots: CryptoSyncSnapshot[],
  sourceChecksum: string,
) {
  const db = getFirebaseAdminDb();
  const portfolioRef = getPortfolioRef();
  const snapshotRefs = snapshots.map((snapshot) =>
    portfolioRef.collection(SNAPSHOT_COLLECTION).doc(snapshot.id),
  );
  const runId = `crypto-sync-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runRef = portfolioRef.collection(SYNC_RUN_COLLECTION).doc(runId);

  try {
    const finalPlan = await db.runTransaction(async (transaction) => {
      const storedDocuments = await Promise.all(
        snapshotRefs.map((reference) => transaction.get(reference)),
      );
      const storedById = new Map(
        storedDocuments
          .filter((document) => document.exists)
          .map((document) => [
            document.id,
            { id: document.id, ...(document.data() as Record<string, unknown>) },
          ]),
      );
      const plan = buildCryptoSyncPlan(snapshots, storedById);

      if (plan.conflicts.length > 0) {
        throw new CryptoMonthlySyncError(
          `已鎖定月份出現差異：${plan.conflicts.map((item) => item.month).join('、')}。同步已停止，沒有覆蓋資料。`,
          409,
        );
      }

      for (const snapshot of plan.creates) {
        const reference = portfolioRef.collection(SNAPSHOT_COLLECTION).doc(snapshot.id);
        transaction.create(reference, {
          ...snapshot,
          importedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      transaction.set(
        runRef,
        buildSyncRun(runId, 'completed', sourceChecksum, snapshots, plan, null),
      );
      return plan;
    });

    return { runId, plan: finalPlan };
  } catch (error) {
    const existing = await readExistingSnapshots();
    const failedPlan = buildCryptoSyncPlan(snapshots, existing);
    const syncError = error instanceof Error ? error.message : String(error);
    const status = error instanceof CryptoMonthlySyncError && error.status === 409
      ? 'conflict'
      : 'failed';
    try {
      await runRef.set(
        buildSyncRun(runId, status, sourceChecksum, snapshots, failedPlan, syncError),
      );
    } catch (runWriteError) {
      console.warn(
        '[crypto-monthly-sync] 未能記錄失敗 run：',
        runWriteError instanceof Error ? runWriteError.message : String(runWriteError),
      );
    }
    throw error;
  }
}

export async function runCryptoMonthlySync(options: CryptoMonthlySyncOptions = {}) {
  const apply = options.apply === true;
  if (apply && options.confirmation !== APPLY_CONFIRMATION) {
    throw new CryptoMonthlySyncError('缺少正式同步確認字串，沒有寫入任何資料。', 400);
  }

  const source = await readLockedMonthLog();
  const snapshots = parseCryptoMonthLogRows(source.values, {
    spreadsheetId: source.spreadsheetId,
    spreadsheetTitle: DEFAULT_SPREADSHEET_TITLE,
    sheetName: DEFAULT_SHEET_NAME,
  });
  const sourceChecksum = getCryptoSyncSourceChecksum(snapshots);

  if (
    apply &&
    (!options.expectedSourceChecksum || options.expectedSourceChecksum !== sourceChecksum)
  ) {
    throw new CryptoMonthlySyncError(
      'Google Sheet 內容已在 preview 後改變，請重新檢查再確認同步。',
      409,
    );
  }

  const existing = await readExistingSnapshots();
  const previewPlan = buildCryptoSyncPlan(snapshots, existing);

  if (apply && previewPlan.conflicts.length > 0) {
    throw new CryptoMonthlySyncError(
      `已鎖定月份出現差異：${previewPlan.conflicts.map((item) => item.month).join('、')}。沒有寫入任何資料。`,
      409,
    );
  }

  if (!apply) {
    return {
      ok: true,
      mode: 'preview',
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
      ...summarizePlan(previewPlan),
    };
  }

  const applied = await applyPlan(snapshots, sourceChecksum);
  return {
    ok: true,
    mode: 'apply',
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
    ...summarizePlan(applied.plan),
  };
}

export function getCryptoMonthlySyncErrorResponse(error: unknown) {
  if (error instanceof CryptoMonthlySyncError) {
    return {
      status: error.status,
      body: { ok: false, mode: 'crypto-sync', message: error.message },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: { ok: false, mode: 'crypto-sync', message: error.message },
    };
  }

  return {
    status: 500,
    body: { ok: false, mode: 'crypto-sync', message: 'Crypto 月結同步失敗。' },
  };
}
