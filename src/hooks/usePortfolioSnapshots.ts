import { useEffect, useState } from 'react';

import type { PortfolioPerformancePoint } from '../types/portfolio';
import {
  getPortfolioSnapshotsErrorMessage,
  subscribeToPortfolioSnapshots,
} from '../lib/firebase/portfolioSnapshots';

type PortfolioSnapshotsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PortfolioSnapshotsState {
  status: PortfolioSnapshotsStatus;
  history: PortfolioPerformancePoint[];
  error: string | null;
}

export function usePortfolioSnapshots() {
  const [state, setState] = useState<PortfolioSnapshotsState>({
    status: 'loading',
    history: [],
    error: null,
  });

  useEffect(() => {
    setState((current) => ({
      status: 'loading',
      history: current.history,
      error: null,
    }));

    const unsubscribe = subscribeToPortfolioSnapshots(
      (history) => {
        setState({
          status: 'ready',
          history,
          error: null,
        });
      },
      (error) => {
        setState({
          status: 'error',
          history: [],
          error: getPortfolioSnapshotsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, []);

  return {
    ...state,
    hasHistory: state.history.length > 1,
  };
}
