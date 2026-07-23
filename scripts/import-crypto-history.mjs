#!/usr/bin/env node

import { createSign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnv } from 'vite';

import { cryptoHistorySource } from './data/crypto-history-source-2026-07.mjs';
import {
  buildCryptoMonthlySnapshots,
  canonicalJson,
  compareExistingSnapshots,
  createChecksum,
  validateCryptoMonthlySnapshots,
} from './lib/cryptoHistoryImport.mjs';

Object.assign(process.env, loadEnv('development', process.cwd(), ''));

const APPLY_CHANGES = process.argv.includes('--apply');
const PROJECT_ID =
  process.env.FIREBASE_ADMIN_PROJECT_ID ??
  process.env.VITE_FIREBASE_PROJECT_ID;
const CLIENT_EMAIL = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
const DATABASE_ROOT = `projects/${PROJECT_ID}/databases/(default)`;
const DOCUMENT_ROOT = `https://firestore.googleapis.com/v1/${DATABASE_ROOT}/documents`;
const COMMIT_URL = `https://firestore.googleapis.com/v1/${DATABASE_ROOT}/documents:commit`;
const PORTFOLIO_PATH = `${DATABASE_ROOT}/documents/portfolio/app`;
const SNAPSHOT_COLLECTION = 'cryptoMonthlySnapshots';
const IMPORT_COLLECTION = 'cryptoHistoricalImports';
const PROTECTED_PATHS = [
  'portfolio/app',
  'portfolio/app/assets',
  'portfolio/app/accountCashFlows',
  'portfolio/app/accountPrincipals',
  'portfolio/app/portfolioSnapshots',
];

function requireEnvironment() {
  const missing = [
    ['FIREBASE_ADMIN_PROJECT_ID', PROJECT_ID],
    ['FIREBASE_ADMIN_CLIENT_EMAIL', CLIENT_EMAIL],
    ['FIREBASE_ADMIN_PRIVATE_KEY', PRIVATE_KEY],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.map(([name]) => name).join(', ')}`,
    );
  }
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const unsignedToken = `${encodeJwtPart({ alg: 'RS256', typ: 'JWT' })}.${encodeJwtPart({
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${signer.sign(PRIVATE_KEY, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Unable to obtain Firebase access token (${response.status}).`);
  }

  return (await response.json()).access_token;
}

async function fetchJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Firestore request failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((entry) => encodeFirestoreValue(entry)),
      },
    };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: encodeFirestoreFields(value),
      },
    };
  }

  throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

function encodeFirestoreFields(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)]),
  );
}

function decodeFirestoreValue(value) {
  if (!value || 'nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values ?? []).map((entry) => decodeFirestoreValue(entry));
  }
  if ('mapValue' in value) {
    return decodeFirestoreFields(value.mapValue.fields ?? {});
  }
  return null;
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

function decodeDocuments(response) {
  return (response.documents ?? []).map((document) => ({
    id: document.name.split('/').pop(),
    name: document.name,
    createTime: document.createTime,
    updateTime: document.updateTime,
    ...decodeFirestoreFields(document.fields),
  }));
}

async function fetchCollection(path, accessToken) {
  return decodeDocuments(
    await fetchJson(`${DOCUMENT_ROOT}/${path}?pageSize=1000`, accessToken),
  );
}

async function fingerprintProtectedState(accessToken) {
  const entries = [];

  for (const path of PROTECTED_PATHS) {
    if (path === 'portfolio/app') {
      const document = await fetchJson(`${DOCUMENT_ROOT}/${path}`, accessToken);
      entries.push({
        path,
        updateTime: document.updateTime,
        fields: decodeFirestoreFields(document.fields),
      });
      continue;
    }

    const documents = await fetchCollection(path, accessToken);
    entries.push({
      path,
      documents: documents
        .map(({ id, createTime, updateTime, name, ...fields }) => ({
          id,
          createTime,
          updateTime,
          fields,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
  }

  return createChecksum(entries);
}

function makeCreateWrite(collection, id, value, importedAt) {
  return {
    update: {
      name: `${PORTFOLIO_PATH}/${collection}/${id}`,
      fields: {
        ...encodeFirestoreFields(value),
        importedAt: { timestampValue: importedAt },
        updatedAt: { timestampValue: importedAt },
      },
    },
    currentDocument: { exists: false },
  };
}

function makeImportRunWrite(summary, importedAt) {
  return {
    update: {
      name: `${PORTFOLIO_PATH}/${IMPORT_COLLECTION}/${cryptoHistorySource.importBatchId}`,
      fields: {
        ...encodeFirestoreFields(summary),
        importedAt: { timestampValue: importedAt },
        updatedAt: { timestampValue: importedAt },
      },
    },
  };
}

function summarizeWarnings(warnings) {
  return warnings.reduce((summary, warning) => {
    summary[warning.code] = (summary[warning.code] ?? 0) + 1;
    return summary;
  }, {});
}

function buildMarkdownReport(report) {
  const warningSummary = Object.entries(report.validation.warningSummary)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => `- ${code}: ${count}`)
    .join('\n');
  const conflicts = report.firestorePlan.conflicts
    .map(
      (conflict) =>
        `- ${conflict.month}: ${conflict.differences.map((difference) => difference.field).join(', ')}`,
    )
    .join('\n');

  return `# Crypto 歷史匯入驗證報告

- 批次：${report.importBatchId}
- 模式：${report.mode}
- 來源：Google Sheet \`${report.sourceSpreadsheetTitle}\`（唯讀）
- 月份：${report.validation.firstMonth} 至 ${report.validation.lastMonth}
- 月份數：${report.validation.snapshotCount}
- 數值驗證：${report.validation.valid ? '通過' : '失敗'}
- 新增：${report.firestorePlan.createCount}
- 相同 checksum 略過：${report.firestorePlan.skipCount}
- 鎖定差異：${report.firestorePlan.conflictCount}
- 讀回驗證：${report.readbackVerification?.verified ? '通過' : report.mode === 'preview' ? '未執行（preview）' : '失敗'}
- portfolioSnapshots／Dashboard 來源資料不變：${report.protectedStateUnchanged == null ? '未執行（preview）' : report.protectedStateUnchanged ? '是' : '否'}

## 每年月份數

${Object.entries(report.validation.monthsByYear)
  .map(([year, count]) => `- ${year}: ${count}`)
  .join('\n')}

## 缺漏月份

${report.validation.missingMonthsWithinRange.length > 0 ? report.validation.missingMonthsWithinRange.map((month) => `- ${month}`).join('\n') : '- 無'}

## 未能自動確認月份

${report.validation.unconfirmedMonths.length > 0 ? report.validation.unconfirmedMonths.map((month) => `- ${month}：原始年度工作表沒有可確認月結；未自行估算或補造資料。`).join('\n') : '- 無'}

## 警告摘要

${warningSummary || '- 無'}

## 鎖定差異

${conflicts || '- 無'}

## 驗證容許範圍

- HKD 總值／回報：HK$1
- 百分比：0.01 個百分點
`;
}

function saveReport(report) {
  const reportDir = resolve(process.cwd(), 'reports');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    resolve(reportDir, 'crypto-history-validation-2026-07.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    resolve(reportDir, 'crypto-history-validation-2026-07.md'),
    buildMarkdownReport(report),
    'utf8',
  );
}

async function verifyReadback(accessToken, snapshots) {
  const stored = await fetchCollection(
    `portfolio/app/${SNAPSHOT_COLLECTION}`,
    accessToken,
  );
  const storedById = new Map(stored.map((snapshot) => [snapshot.id, snapshot]));
  const mismatches = snapshots
    .filter((snapshot) => storedById.get(snapshot.id)?.sourceChecksum !== snapshot.sourceChecksum)
    .map((snapshot) => snapshot.id);

  return {
    verified: mismatches.length === 0,
    expectedCount: snapshots.length,
    matchedCount: snapshots.length - mismatches.length,
    mismatches,
  };
}

async function main() {
  requireEnvironment();
  const snapshots = buildCryptoMonthlySnapshots(cryptoHistorySource);
  const validation = validateCryptoMonthlySnapshots(snapshots, {
    expectedStartMonth: cryptoHistorySource.expectedStartMonth,
  });
  const accessToken = await getAccessToken();
  const existing = await fetchCollection(
    `portfolio/app/${SNAPSHOT_COLLECTION}`,
    accessToken,
  );
  const existingById = new Map(existing.map((snapshot) => [snapshot.id, snapshot]));
  const comparison = compareExistingSnapshots(snapshots, existingById);
  const warningSummary = summarizeWarnings(validation.warnings);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY_CHANGES ? 'apply' : 'preview',
    importBatchId: cryptoHistorySource.importBatchId,
    sourceSpreadsheetId: cryptoHistorySource.sourceSpreadsheetId,
    sourceSpreadsheetTitle: cryptoHistorySource.sourceSpreadsheetTitle,
    sourceReadOnly: true,
    sourceExtractionMethod: cryptoHistorySource.extractionMethod,
    validation: {
      ...validation,
      warningSummary,
    },
    firestorePlan: {
      collectionPath: `portfolio/app/${SNAPSHOT_COLLECTION}`,
      createCount: comparison.creates.length,
      skipCount: comparison.skips.length,
      conflictCount: comparison.conflicts.length,
      conflicts: comparison.conflicts,
    },
    readbackVerification: null,
    protectedStateUnchanged: null,
  };

  if (!validation.valid) {
    saveReport(report);
    throw new Error(
      `Validation failed with ${validation.errors.length} numeric error(s).`,
    );
  }

  if (comparison.conflicts.length > 0) {
    saveReport(report);
    throw new Error(
      `Locked snapshot conflict detected for ${comparison.conflicts.map((item) => item.month).join(', ')}.`,
    );
  }

  if (!APPLY_CHANGES) {
    saveReport(report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const protectedStateBefore = await fingerprintProtectedState(accessToken);
  const importedAt = new Date().toISOString();
  const batchChecksum = createChecksum(
    snapshots.map((snapshot) => snapshot.sourceChecksum),
  );
  const importRunSummary = {
    id: cryptoHistorySource.importBatchId,
    importBatchId: cryptoHistorySource.importBatchId,
    sourceSpreadsheetId: cryptoHistorySource.sourceSpreadsheetId,
    sourceSpreadsheetTitle: cryptoHistorySource.sourceSpreadsheetTitle,
    sourceSheets: [...new Set(snapshots.map((snapshot) => snapshot.sourceSheet))],
    sourceType: 'google_sheet_read_only',
    status: 'completed',
    successMonthCount: snapshots.length,
    createdMonthCount: comparison.creates.length,
    skippedDuplicateMonthCount: comparison.skips.length,
    warningCount: validation.warningCount,
    warningSummary,
    firstMonth: validation.firstMonth,
    lastMonth: validation.lastMonth,
    unconfirmedMonths: validation.unconfirmedMonths,
    batchChecksum,
    validationPassed: true,
    sourceReadOnly: true,
  };
  const writes = comparison.creates.map((snapshot) =>
    makeCreateWrite(SNAPSHOT_COLLECTION, snapshot.id, snapshot, importedAt),
  );
  writes.push(makeImportRunWrite(importRunSummary, importedAt));

  await fetchJson(COMMIT_URL, accessToken, {
    method: 'POST',
    body: JSON.stringify({ writes }),
  });

  report.readbackVerification = await verifyReadback(accessToken, snapshots);
  const protectedStateAfter = await fingerprintProtectedState(accessToken);
  report.protectedStateUnchanged = protectedStateBefore === protectedStateAfter;

  if (!report.readbackVerification.verified) {
    saveReport(report);
    throw new Error(
      `Readback verification failed for ${report.readbackVerification.mismatches.join(', ')}.`,
    );
  }

  if (!report.protectedStateUnchanged) {
    saveReport(report);
    throw new Error('Protected portfolio data changed during crypto history import.');
  }

  saveReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
