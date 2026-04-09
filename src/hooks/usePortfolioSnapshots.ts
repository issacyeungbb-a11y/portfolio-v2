import { useCallback, useEffect, useState } from 'react';

import type { PortfolioPerformancePoint } from '../types/portfolio';
import {
  getPortfolioSnapshotsErrorMessage,
  getTodaySnapshotStatus,
  subscribeToPortfolioSnapshots,
  type TodaySnapshotStatus,
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

interface TodaySnapshotState {
  todaySnapshot: TodaySnapshotStatus;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

export function useTodaySnapshotStatus() {
  const [state, setState] = useState<TodaySnapshotState>({
    todaySnapshot: { exists: false },
    status: 'loading',
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({
      todaySnapshot: current.todaySnapshot,
      status: 'loading',
      error: null,
    }));

    try {
      const todaySnapshot = await getTodaySnapshotStatus();
      setState({
        todaySnapshot,
        status: 'ready',
        error: null,
      });
    } catch (error) {
      setState({
        todaySnapshot: { exists: false },
        status: 'error',
        error: getPortfolioSnapshotsErrorMessage(error),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}
