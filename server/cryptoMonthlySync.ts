import { createSign, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import {
  CRYPTO_MONTH_LOG_HEADERS,
  buildCryptoAssetShadowPreview,
  buildCryptoSyncPlan,
  buildCryptoSyncValidationReport,
  getCryptoHistoricalAuditMonths,
  getCryptoSyncSourceChecksum,
  parseCryptoMonthLogRows,
  type CryptoSyncPlan,
  type CryptoAssetShadowPreview,
  type CryptoSyncSnapshot,
} from './cryptoMonthlySyncCore.js';

const DEFAULT_SPREADSHEET_ID = '1CrXqZtK2Qy2rivBTN1BZTSbNpAY0Y5P6Rzsg8_OaaI4';
const DEFAULT_SPREADSHEET_TITLE = 'crypto';
const DEFAULT_SHEET_NAME = '月結記錄';
const DEFAULT_SOURCE_RANGE = `'${DEFAULT_SHEET_NAME}'!A1:S500`;
const DEFAULT_DETAIL_RANGE = `'2026_V2'!G38:M73`;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const PORTFOLIO_COLLECTION = 'portfolio';
const PORTFOLIO_DOC_ID = 'app';
const SNAPSHOT_COLLECTION = 'cryptoMonthlySnapshots';
const SYNC_RUN_COLLECTION = 'cryptoSyncRuns';
const IMPORT_COLLECTION = 'cryptoHistoricalImports';
const ASSET_SYNC_COLLECTION = 'cryptoAssetSyncs';
const ACCOUNT_OVERRIDE_COLLECTION = 'accountValuationOverrides';
const APPLY_CONFIRMATION = 'APPLY_CRYPTO_MONTHLY_SYNC';
const APPLY_ASSET_CONFIRMATION = 'APPLY_CRYPTO_ACCOUNT_SHADOW';

interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
}

interface CryptoMonthlySyncOptions {
  apply?: boolean;
  confirmation?: string;
  expectedSourceChecksum?: string;
  includeAssetShadow?: boolean;
  applyAssetShadow?: boolean;
  assetConfirmation?: string;
  expectedAssetShadowChecksum?: string;
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

async function readSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sourceRange: string,
) {
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
      `未能唯讀「${sourceRange}」：${detail}。請確認 service account 已獲工作表檢視權限。`,
      response.status === 403 ? 403 : 502,
    );
  }

  return payload.values ?? [];
}

async function readLockedMonthLog(includeAssetShadow = false) {
  const spreadsheetId =
    process.env.CRYPTO_SHEET_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
  const sourceRange =
    process.env.CRYPTO_SHEET_SOURCE_RANGE?.trim() || DEFAULT_SOURCE_RANGE;
  const detailRange =
    process.env.CRYPTO_SHEET_DETAIL_RANGE?.trim() || DEFAULT_DETAIL_RANGE;
  const accessToken = await getGoogleSheetsAccessToken();
  const [values, detailValues] = await Promise.all([
    readSheetValues(accessToken, spreadsheetId, sourceRange),
    includeAssetShadow
      ? readSheetValues(accessToken, spreadsheetId, detailRange)
      : Promise.resolve([]),
  ]);

  return {
    spreadsheetId,
    sourceRange,
    detailRange,
    values,
    detailValues,
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

async function readLatestHistoricalImportMonth() {
  const snapshot = await getPortfolioRef()
    .collection(IMPORT_COLLECTION)
    .orderBy('importedAt', 'desc')
    .limit(1)
    .get();
  const lastMonth = snapshot.docs[0]?.data().lastMonth;
  return typeof lastMonth === 'string' ? lastMonth : null;
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
    validatedFieldCount: CRYPTO_MONTH_LOG_HEADERS.length,
    validatedMonthCount: snapshots.length,
    ...summarizePlan(plan),
    sourceReadOnly: true,
    errorMessage,
    startedAt: FieldValue.serverTimestamp(),
    finishedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildHistoricalImport(
  runId: string,
  sourceChecksum: string,
  snapshots: CryptoSyncSnapshot[],
  plan: CryptoSyncPlan,
  auditedMonths: string[],
) {
  return {
    id: runId,
    importBatchId: runId,
    sourceSpreadsheetId:
      process.env.CRYPTO_SHEET_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID,
    sourceSpreadsheetTitle: DEFAULT_SPREADSHEET_TITLE,
    sourceSheets: [DEFAULT_SHEET_NAME],
    sourceType: 'google_sheet_read_only',
    status: 'completed',
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
    reconciledFromExistingSnapshots:
      plan.creates.length === 0 && auditedMonths.length > 0,
    importedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function verifyAppliedSync(
  runId: string,
  plan: CryptoSyncPlan,
  auditedMonths: string[],
) {
  const portfolioRef = getPortfolioRef();
  const snapshotRefs = plan.creates.map((snapshot) =>
    portfolioRef.collection(SNAPSHOT_COLLECTION).doc(snapshot.id),
  );
  const runRef = portfolioRef.collection(SYNC_RUN_COLLECTION).doc(runId);
  const importRef = portfolioRef.collection(IMPORT_COLLECTION).doc(runId);
  const [storedSnapshots, storedRun, storedImport] = await Promise.all([
    Promise.all(snapshotRefs.map((reference) => reference.get())),
    runRef.get(),
    auditedMonths.length > 0 ? importRef.get() : Promise.resolve(null),
  ]);
  const storedById = new Map(
    storedSnapshots
      .filter((document) => document.exists)
      .map((document) => [
        document.id,
        { id: document.id, ...(document.data() as Record<string, unknown>) },
      ]),
  );
  const readbackPlan = buildCryptoSyncPlan(plan.creates, storedById);

  if (readbackPlan.creates.length > 0 || readbackPlan.conflicts.length > 0) {
    throw new CryptoMonthlySyncError(
      `Firestore 寫入後回讀核對失敗：${[
        ...readbackPlan.creates.map((snapshot) => `${snapshot.month} 缺少快照`),
        ...readbackPlan.conflicts.map((conflict) =>
          `${conflict.month} 欄位差異 ${conflict.differingFields.join('、')}`,
        ),
      ].join('；')}`,
      500,
    );
  }

  const runData = storedRun.data() as Record<string, unknown> | undefined;
  if (!storedRun.exists || runData?.status !== 'completed') {
    throw new CryptoMonthlySyncError('Firestore 寫入後未能回讀已完成的 cryptoSyncRuns。', 500);
  }

  if (auditedMonths.length > 0) {
    const importData = storedImport?.data() as Record<string, unknown> | undefined;
    const storedAuditedMonths = Array.isArray(importData?.auditedMonths)
      ? importData.auditedMonths
      : [];
    if (
      !storedImport?.exists ||
      importData?.status !== 'completed' ||
      JSON.stringify(storedAuditedMonths) !== JSON.stringify(auditedMonths)
    ) {
      throw new CryptoMonthlySyncError(
        'Firestore 寫入後未能回讀一致的 cryptoHistoricalImports 審計記錄。',
        500,
      );
    }
  }

  return {
    verified: true,
    snapshotMonths: plan.creates.map((snapshot) => snapshot.month),
    auditMonths: auditedMonths,
    syncRunId: runId,
    historicalImportId: auditedMonths.length > 0 ? runId : null,
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
  const importRef = portfolioRef.collection(IMPORT_COLLECTION).doc(runId);
  const latestImportQuery = portfolioRef
    .collection(IMPORT_COLLECTION)
    .orderBy('importedAt', 'desc')
    .limit(1);
  let transactionCommitted = false;

  try {
    const applied = await db.runTransaction(async (transaction) => {
      const [storedDocuments, latestImports] = await Promise.all([
        Promise.all(snapshotRefs.map((reference) => transaction.get(reference))),
        transaction.get(latestImportQuery),
      ]);
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

      const latestImportedMonth = latestImports.docs[0]?.data().lastMonth;
      const auditedMonths = getCryptoHistoricalAuditMonths(
        snapshots,
        plan.creates.map((snapshot) => snapshot.month),
        typeof latestImportedMonth === 'string' ? latestImportedMonth : null,
      );

      if (auditedMonths.length > 0) {
        transaction.create(
          importRef,
          buildHistoricalImport(runId, sourceChecksum, snapshots, plan, auditedMonths),
        );
      }

      transaction.set(
        runRef,
        buildSyncRun(runId, 'completed', sourceChecksum, snapshots, plan, null),
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

async function applyCryptoAccountValuationOverride(params: {
  snapshot: CryptoSyncSnapshot;
  shadow: CryptoAssetShadowPreview;
  detailValues: unknown[][];
  trigger: 'explicit_confirmation' | 'confirmed_history_import';
}) {
  const { snapshot, shadow, detailValues, trigger } = params;
  const db = getFirebaseAdminDb();
  const portfolioRef = getPortfolioRef();
  const snapshotRef = portfolioRef.collection(SNAPSHOT_COLLECTION).doc(snapshot.id);
  const overrideRef = portfolioRef.collection(ACCOUNT_OVERRIDE_COLLECTION).doc('Crypto');
  const auditRef = portfolioRef.collection(ASSET_SYNC_COLLECTION).doc(snapshot.id);

  const result = await db.runTransaction(async (transaction) => {
    const [storedSnapshot, existingAudit] = await Promise.all([
      transaction.get(snapshotRef),
      transaction.get(auditRef),
    ]);
    const storedSourceChecksum = storedSnapshot.data()?.sourceChecksum;

    if (!storedSnapshot.exists || storedSourceChecksum !== snapshot.sourceChecksum) {
      throw new CryptoMonthlySyncError(
        `${snapshot.month} 鎖定月結未能在 Firestore 回讀一致，Crypto 帳戶同步已停止。`,
        409,
      );
    }

    if (existingAudit.exists) {
      const audit = existingAudit.data();
      if (
        audit.sourceChecksum === snapshot.sourceChecksum &&
        audit.shadowChecksum === shadow.shadowChecksum &&
        audit.status === 'completed'
      ) {
        return { skipped: true as const };
      }
      throw new CryptoMonthlySyncError(
        `${snapshot.month} 已有不同的 Crypto 帳戶同步審計，沒有覆蓋。`,
        409,
      );
    }

    const overridePayload = {
      accountSource: 'Crypto',
      active: true,
      month: snapshot.month,
      targetTotalUsd: snapshot.performanceTotalUsd,
      targetTotalHkd: snapshot.totalHkd,
      usdHkdRate: snapshot.usdHkdRate,
      sourceSnapshotId: snapshot.id,
      sourceChecksum: snapshot.sourceChecksum,
      shadowChecksum: shadow.shadowChecksum,
      applicationMode: 'proportional_account_overlay',
      separateWithdrawalsUsd: snapshot.cumulativeWithdrawnUsd,
      detailPositionSubtotalUsd: shadow.detailPositionSubtotalUsd,
      detailToTargetDifferenceUsd: shadow.detailToTargetDifferenceUsd,
      excludedAccountSources: ['Futu'],
      updatedAt: FieldValue.serverTimestamp(),
      confirmedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(overrideRef, overridePayload);
    transaction.create(auditRef, {
      id: snapshot.id,
      month: snapshot.month,
      status: 'completed',
      trigger,
      accountSource: 'Crypto',
      sourceSnapshotId: snapshot.id,
      sourceChecksum: snapshot.sourceChecksum,
      shadowChecksum: shadow.shadowChecksum,
      applicationMode: 'proportional_account_overlay',
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
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { skipped: false as const };
  });

  const [overrideDocument, auditDocument, effectiveAssets] = await Promise.all([
    overrideRef.get(),
    auditRef.get(),
    readAdminPortfolioAssets(),
  ]);
  const readbackShadow = buildCryptoAssetShadowPreview(
    snapshot,
    detailValues,
    effectiveAssets,
    shadow.sourceDetailRange,
  );

  if (!overrideDocument.exists || !auditDocument.exists) {
    throw new CryptoMonthlySyncError('Crypto 帳戶同步寫入後回讀文件不完整。', 500);
  }
  if (Math.abs(readbackShadow.differenceHkd) > 1) {
    throw new CryptoMonthlySyncError(
      `Crypto 帳戶同步回讀仍相差 HK$${readbackShadow.differenceHkd.toFixed(2)}。`,
      500,
    );
  }

  return {
    applied: !result.skipped,
    skipped: result.skipped,
    verified: true,
    month: snapshot.month,
    accountSource: 'Crypto',
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
    auditId: snapshot.id,
  };
}

export async function runCryptoMonthlySync(options: CryptoMonthlySyncOptions = {}) {
  const apply = options.apply === true;
  const applyAssetShadow = options.applyAssetShadow === true;
  if (apply && options.confirmation !== APPLY_CONFIRMATION) {
    throw new CryptoMonthlySyncError('缺少正式同步確認字串，沒有寫入任何資料。', 400);
  }
  if (applyAssetShadow && options.assetConfirmation !== APPLY_ASSET_CONFIRMATION) {
    throw new CryptoMonthlySyncError('缺少 Crypto 帳戶正式同步確認字串，沒有寫入任何資料。', 400);
  }
  if (apply && applyAssetShadow) {
    throw new CryptoMonthlySyncError('月結寫入與獨立帳戶同步不可在同一請求重複執行。', 400);
  }

  const includeAssetShadow = apply || applyAssetShadow || options.includeAssetShadow === true;
  const source = await readLockedMonthLog(includeAssetShadow);
  const snapshots = parseCryptoMonthLogRows(source.values, {
    spreadsheetId: source.spreadsheetId,
    spreadsheetTitle: DEFAULT_SPREADSHEET_TITLE,
    sheetName: DEFAULT_SHEET_NAME,
  });
  const sourceChecksum = getCryptoSyncSourceChecksum(snapshots);

  if (
    (apply || applyAssetShadow) &&
    (!options.expectedSourceChecksum || options.expectedSourceChecksum !== sourceChecksum)
  ) {
    throw new CryptoMonthlySyncError(
      'Google Sheet 內容已在 preview 後改變，請重新檢查再確認同步。',
      409,
    );
  }

  const [existing, latestImportedMonth, portfolioAssets] = await Promise.all([
    readExistingSnapshots(),
    readLatestHistoricalImportMonth(),
    includeAssetShadow ? readAdminPortfolioAssets() : Promise.resolve([]),
  ]);
  const previewPlan = buildCryptoSyncPlan(snapshots, existing);
  const previewAuditMonths = getCryptoHistoricalAuditMonths(
    snapshots,
    previewPlan.creates.map((snapshot) => snapshot.month),
    latestImportedMonth,
  );
  const previewValidationReport = buildCryptoSyncValidationReport(snapshots, previewPlan);
  const latestSnapshot = snapshots.at(-1);
  const assetShadow = includeAssetShadow && latestSnapshot
    ? buildCryptoAssetShadowPreview(
        latestSnapshot,
        source.detailValues,
        portfolioAssets,
        source.detailRange,
      )
    : undefined;

  if (
    applyAssetShadow &&
    (!assetShadow ||
      !options.expectedAssetShadowChecksum ||
      options.expectedAssetShadowChecksum !== assetShadow.shadowChecksum)
  ) {
    throw new CryptoMonthlySyncError(
      'Crypto 帳戶或月結內容已在影子 preview 後改變，請重新檢查再確認同步。',
      409,
    );
  }

  if (apply && previewPlan.conflicts.length > 0) {
    throw new CryptoMonthlySyncError(
      `已鎖定月份出現差異：${previewPlan.conflicts.map((item) => item.month).join('、')}。沒有寫入任何資料。`,
      409,
    );
  }

  if (!apply) {
    if (applyAssetShadow && latestSnapshot && assetShadow) {
      const assetReadback = await applyCryptoAccountValuationOverride({
        snapshot: latestSnapshot,
        shadow: assetShadow,
        detailValues: source.detailValues,
        trigger: 'explicit_confirmation',
      });
      return {
        ok: true,
        mode: 'asset_apply',
        sourceReadOnly: true,
        sourceSpreadsheetId: source.spreadsheetId,
        sourceSheet: DEFAULT_SHEET_NAME,
        sourceRange: source.sourceRange,
        sourceChecksum,
        checkedAt: new Date().toISOString(),
        assetShadow,
        assetReadback,
        ...summarizePlan(previewPlan),
      };
    }

    return {
      ok: true,
      mode: 'preview',
      sourceReadOnly: true,
      sourceSpreadsheetId: source.spreadsheetId,
      sourceSheet: DEFAULT_SHEET_NAME,
      sourceRange: source.sourceRange,
      sourceChecksum,
      checkedAt: new Date().toISOString(),
      detectedMonthCount: snapshots.length,
      firstMonth: snapshots[0]?.month ?? null,
      lastMonth: snapshots.at(-1)?.month ?? null,
      warningCount: warningCount(snapshots),
      warningSummary: warningSummary(snapshots),
      auditCreateCount: previewAuditMonths.length,
      auditMonths: previewAuditMonths,
      validationReport: previewValidationReport,
      ...(assetShadow ? { assetShadow } : {}),
      ...summarizePlan(previewPlan),
    };
  }

  const applied = await applyPlan(snapshots, sourceChecksum);
  const assetReadback = latestSnapshot && assetShadow
    ? await applyCryptoAccountValuationOverride({
        snapshot: latestSnapshot,
        shadow: assetShadow,
        detailValues: source.detailValues,
        trigger: 'confirmed_history_import',
      })
    : null;
  return {
    ok: true,
    mode: 'apply',
    runId: applied.runId,
    sourceReadOnly: true,
    sourceSpreadsheetId: source.spreadsheetId,
    sourceSheet: DEFAULT_SHEET_NAME,
    sourceRange: source.sourceRange,
    sourceChecksum,
    checkedAt: new Date().toISOString(),
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
