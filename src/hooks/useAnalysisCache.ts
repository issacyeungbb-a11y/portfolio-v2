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

export function useAnalysisCache(snapshotHash: string | null) {
  const [state, setState] = useState<AnalysisCacheState>({
    status: snapshotHash ? 'loading' : 'idle',
    analysis: null,
    error: null,
  });

  useEffect(() => {
    if (!snapshotHash) {
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
  }, [snapshotHash]);

  async function persistAnalysis(analysis: CachedPortfolioAnalysis) {
    try {
      await saveAnalysisCache(analysis);
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
