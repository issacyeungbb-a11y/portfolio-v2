import { useEffect, useState } from 'react';

import type { CachedPortfolioAnalysis } from '../types/portfolioAnalysis';
import {
  getAnalysisCacheErrorMessage,
  saveAnalysisCache,
  subscribeToAnalysisCache,
} from '../lib/firebase/analysisCache';

type AnalysisCacheStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AnalysisCacheState {
  status: AnalysisCacheStatus;
  analysis: CachedPortfolioAnalysis | null;
  error: string | null;
}

export function useAnalysisCache(uid: string | null, snapshotHash: string | null) {
  const [state, setState] = useState<AnalysisCacheState>({
    status: uid && snapshotHash ? 'loading' : 'idle',
    analysis: null,
    error: null,
  });

  useEffect(() => {
    if (!uid || !snapshotHash) {
      setState({
        status: 'idle',
        analysis: null,
        error: null,
      });
      return;
    }

    setState((current) => ({
      status: 'loading',
      analysis: current.analysis,
      error: null,
    }));

    const unsubscribe = subscribeToAnalysisCache(
      uid,
      snapshotHash,
      (analysis) => {
        setState({
          status: 'ready',
          analysis,
          error: null,
        });
      },
      (error) => {
        setState({
          status: 'error',
          analysis: null,
          error: getAnalysisCacheErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, [uid, snapshotHash]);

  async function persistAnalysis(analysis: CachedPortfolioAnalysis) {
    if (!uid) {
      throw new Error('匿名身份尚未完成，請稍後再試。');
    }

    try {
      await saveAnalysisCache(uid, analysis);
    } catch (error) {
      const message = getAnalysisCacheErrorMessage(error);
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
  }

  return {
    ...state,
    hasCachedAnalysis: Boolean(state.analysis),
    persistAnalysis,
  };
}
