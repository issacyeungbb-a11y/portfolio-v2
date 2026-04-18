import { useEffect, useState } from 'react';

import {
  getAnalysisThreadsErrorMessage,
  subscribeToAnalysisThreadTurns,
  subscribeToAnalysisThreads,
  type AnalysisThread,
  type AnalysisThreadTurn,
} from '../lib/firebase/analysisThreads';

type AnalysisThreadsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AnalysisThreadsState {
  status: AnalysisThreadsStatus;
  entries: AnalysisThread[];
  error: string | null;
}

export function useAnalysisThreads() {
  const [state, setState] = useState<AnalysisThreadsState>({
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

    const unsubscribe = subscribeToAnalysisThreads(
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
          error: getAnalysisThreadsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, []);

  return state;
}

interface AnalysisThreadTurnsState {
  status: AnalysisThreadsStatus;
  entries: AnalysisThreadTurn[];
  error: string | null;
}

export function useAnalysisThreadTurns(threadId: string | null) {
  const [state, setState] = useState<AnalysisThreadTurnsState>({
    status: threadId ? 'loading' : 'idle',
    entries: [],
    error: null,
  });

  useEffect(() => {
    if (!threadId) {
      setState({
        status: 'idle',
        entries: [],
        error: null,
      });
      return;
    }

    setState((current) => ({
      status: 'loading',
      entries: current.entries,
      error: null,
    }));

    const unsubscribe = subscribeToAnalysisThreadTurns(
      threadId,
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
          error: getAnalysisThreadsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, [threadId]);

  return state;
}
