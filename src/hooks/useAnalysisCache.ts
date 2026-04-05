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

export function useAnalysisCache(cacheKey: string | null) {
  const [state, setState] = useState<AnalysisCacheState>({
    status: cacheKey ? 'loading' : 'idle',
    analysis: null,
    error: null,
  });

  useEffect(() => {
    if (!cacheKey) {
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
      cacheKey,
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
  }, [cacheKey]);

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
