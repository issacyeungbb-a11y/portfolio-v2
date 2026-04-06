import {
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import type { AnalysisSession } from '../../types/portfolio';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedAnalysisSessionsCollectionRef } from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function formatTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

function normalizeAnalysisSession(
  id: string,
  value: Record<string, unknown>,
): AnalysisSession {
  return {
    id,
    title: typeof value.title === 'string' ? value.title : '分析紀錄',
    question: typeof value.question === 'string' ? value.question : '',
    result: typeof value.result === 'string' ? value.result : '',
    model: typeof value.model === 'string' ? value.model : '',
    provider: value.provider === 'anthropic' ? 'anthropic' : 'google',
    snapshotHash: typeof value.snapshotHash === 'string' ? value.snapshotHash : '',
    updatedAt: formatTimestamp(value.updatedAt),
    createdAt: formatTimestamp(value.createdAt),
  };
}

export function getAnalysisSessionsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/analysisSessions`。';
    }

    return error.message;
  }

  return '讀取或寫入分析紀錄失敗，請稍後再試。';
}

export function subscribeToAnalysisSessions(
  onData: (entries: AnalysisSession[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const sessionsQuery = query(
    getSharedAnalysisSessionsCollectionRef(),
    orderBy('updatedAt', 'desc'),
  );

  return onSnapshot(
    sessionsQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) =>
          normalizeAnalysisSession(
            docSnapshot.id,
            docSnapshot.data() as Record<string, unknown>,
          ),
        ),
      );
    },
    onError,
  );
}

export async function createAnalysisSession(
  entry: Omit<AnalysisSession, 'id' | 'updatedAt' | 'createdAt'>,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  await addDoc(getSharedAnalysisSessionsCollectionRef(), {
    title: entry.title.trim() || '分析紀錄',
    question: entry.question.trim(),
    result: entry.result.trim(),
    model: entry.model,
    provider: entry.provider ?? 'google',
    snapshotHash: entry.snapshotHash ?? '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
