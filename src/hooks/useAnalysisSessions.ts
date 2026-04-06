import { useEffect, useState } from 'react';

import type { AnalysisSession } from '../types/portfolio';
import {
  createAnalysisSession,
  getAnalysisSessionsErrorMessage,
  subscribeToAnalysisSessions,
} from '../lib/firebase/analysisSessions';

type AnalysisSessionsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AnalysisSessionsState {
  status: AnalysisSessionsStatus;
  entries: AnalysisSession[];
  error: string | null;
}

export function useAnalysisSessions() {
  const [state, setState] = useState<AnalysisSessionsState>({
    status: 'loading',
    entries: [],
    error: null,
  });

  useEffect(() => {
    setState((current) => ({
      status: 'loading',
      entries: current.entries,
      error: null,
    }));

    const unsubscribe = subscribeToAnalysisSessions(
      (entries) => {
        setState({
          status: 'ready',
          entries,
          error: null,
        });
      },
      (error) => {
        setState({
          status: 'error',
          entries: [],
          error: getAnalysisSessionsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, []);

  async function addAnalysisSession(
    entry: Omit<AnalysisSession, 'id' | 'updatedAt' | 'createdAt'>,
  ) {
    try {
      await createAnalysisSession(entry);
    } catch (error) {
      const message = getAnalysisSessionsErrorMessage(error);
      setState((current) => ({
        ...current,
        error: message,
      }));
      throw new Error(message);
    }
  }

  return {
    ...state,
    addAnalysisSession,
  };
}
