import {
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

import type { ReportAllocationSummary, ReportFactsPayload } from '../../types/portfolio';
import { normalizeReportAllocationSummary } from '../portfolio/reportAllocationSummary';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedQuarterlyReportsCollectionRef } from './sharedPortfolio';

export interface QuarterlyReport {
  id: string;
  quarter: string;
  generatedAt: string;
  report: string;
  searchSummary: string;
  model: string;
  provider: string;
  currentSnapshotHash?: string;
  previousSnapshotDate?: string;
  allocationSummary?: ReportAllocationSummary;
  reportFactsPayload?: ReportFactsPayload;
  pdfUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function formatTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

function normalizeQuarterlyReport(
  id: string,
  value: Record<string, unknown>,
): QuarterlyReport {
  return {
    id,
    quarter: typeof value.quarter === 'string' ? value.quarter : '未命名季度',
    generatedAt: formatTimestamp(value.generatedAt),
    report: typeof value.report === 'string' ? value.report : '',
    searchSummary: typeof value.searchSummary === 'string' ? value.searchSummary : '',
    model: typeof value.model === 'string' ? value.model : '',
    provider: typeof value.provider === 'string' ? value.provider : '',
    currentSnapshotHash:
      typeof value.currentSnapshotHash === 'string' && value.currentSnapshotHash.trim()
        ? value.currentSnapshotHash
        : undefined,
    previousSnapshotDate:
      typeof value.previousSnapshotDate === 'string' && value.previousSnapshotDate.trim()
        ? value.previousSnapshotDate
        : undefined,
    allocationSummary: normalizeReportAllocationSummary(value.allocationSummary),
    reportFactsPayload:
      typeof value.reportFactsPayload === 'object' && value.reportFactsPayload !== null
        ? (value.reportFactsPayload as ReportFactsPayload)
        : undefined,
    pdfUrl: typeof value.pdfUrl === 'string' && value.pdfUrl.trim() ? value.pdfUrl : undefined,
    createdAt: formatTimestamp(value.createdAt),
    updatedAt: formatTimestamp(value.updatedAt),
  };
}

export function getQuarterlyReportsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/quarterlyReports`。';
    }

    return error.message;
  }

  return '讀取或更新季度報告失敗，請稍後再試。';
}

export function subscribeToQuarterlyReports(
  onData: (entries: QuarterlyReport[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const reportsQuery = query(
    getSharedQuarterlyReportsCollectionRef(),
    orderBy('createdAt', 'desc'),
  );

  return onSnapshot(
    reportsQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) =>
          normalizeQuarterlyReport(
            docSnapshot.id,
            docSnapshot.data() as Record<string, unknown>,
          ),
        ),
      );
    },
    onError,
  );
}

export async function updateQuarterlyReportPdfUrl(reportId: string, pdfUrl: string) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const reportRef = doc(getSharedQuarterlyReportsCollectionRef(), reportId);

  await updateDoc(reportRef, {
    pdfUrl: pdfUrl.trim(),
    updatedAt: serverTimestamp(),
  });
}
