import { useCallback, useEffect, useState } from 'react';

import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import type {
  CryptoHistoricalImport,
  CryptoMonthlySnapshot,
  CryptoSyncRun,
} from '../types/cryptoHistory';

interface CryptoHistoryState {
  status: 'loading' | 'ready' | 'error';
  snapshots: CryptoMonthlySnapshot[];
  latestImport: CryptoHistoricalImport | null;
  latestSync: CryptoSyncRun | null;
  errors: string[];
}

interface CryptoHistoryResponse {
  ok: boolean;
  snapshots?: CryptoMonthlySnapshot[];
  latestImport?: CryptoHistoricalImport | null;
  latestSync?: CryptoSyncRun | null;
}

export function useCryptoHistory() {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<CryptoHistoryState>({
    status: 'loading',
    snapshots: [],
    latestImport: null,
    latestSync: null,
    errors: [],
  });

  useEffect(() => {
    let active = true;

    void callPortfolioFunction('crypto-history')
      .then((value) => {
        if (!active) return;
        const response = value as CryptoHistoryResponse;
        setState({
          status: 'ready',
          snapshots: Array.isArray(response.snapshots) ? response.snapshots : [],
          latestImport: response.latestImport ?? null,
          latestSync: response.latestSync ?? null,
          errors: [],
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: 'error',
          snapshots: [],
          latestImport: null,
          latestSync: null,
          errors: [
            error instanceof Error
              ? error.message
              : '未能透過受保護 API 讀取 Crypto 歷史資料。',
          ],
        });
      });

    return () => {
      active = false;
    };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  return {
    ...state,
    refresh,
    isEmpty: state.status === 'ready' && state.snapshots.length === 0,
  };
}
