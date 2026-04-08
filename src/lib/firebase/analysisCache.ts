import {
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import type { CachedPortfolioAnalysis } from '../../types/portfolioAnalysis';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedAnalysisCacheDocRef } from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function normalizeCachedAnalysis(
  cacheKey: string,
  value: Record<string, unknown>,
): CachedPortfolioAnalysis {
  return {
    cacheKey,
    snapshotHash: typeof value.snapshotHash === 'string' ? value.snapshotHash : '',
    category:
      value.category === 'general_question' || value.category === 'asset_report'
        ? value.category
        : 'asset_analysis',
    provider:
      value.provider === 'anthropic'
        ? 'anthropic'
        : 'google',
    model: typeof value.model === 'string' ? value.model : '',
    analysisInstruction:
      typeof value.analysisInstruction === 'string' ? value.analysisInstruction : '',
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    assetCount: typeof value.assetCount === 'number' ? value.assetCount : 0,
    answer: typeof value.answer === 'string' ? value.answer : '',
  };
}

export function getAnalysisCacheErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/analysisCache`。';
    }

    return error.message;
  }

  return '讀取或寫入分析快取失敗，請稍後再試。';
}

export function subscribeToAnalysisCache(
  cacheKey: string,
  onData: (analysis: CachedPortfolioAnalysis | null) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const cacheRef = getSharedAnalysisCacheDocRef(cacheKey);

  return onSnapshot(
    cacheRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }

      onData(normalizeCachedAnalysis(snapshot.id, snapshot.data() as Record<string, unknown>));
    },
    onError,
  );
}

export async function saveAnalysisCache(
  analysis: CachedPortfolioAnalysis,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const cacheRef = getSharedAnalysisCacheDocRef(analysis.cacheKey);

  await setDoc(
    cacheRef,
    {
      ...analysis,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
