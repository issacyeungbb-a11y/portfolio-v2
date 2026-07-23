import { useEffect, useState } from 'react';

import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import type {
  CryptoHistoricalImport,
  CryptoMonthlySnapshot,
} from '../types/cryptoHistory';

interface CryptoHistoryState {
  status: 'loading' | 'ready' | 'error';
  snapshots: CryptoMonthlySnapshot[];
  latestImport: CryptoHistoricalImport | null;
  errors: string[];
}

interface CryptoHistoryResponse {
  ok: boolean;
  snapshots?: CryptoMonthlySnapshot[];
  latestImport?: CryptoHistoricalImport | null;
}

export function useCryptoHistory() {
  const [state, setState] = useState<CryptoHistoryState>({
    status: 'loading',
    snapshots: [],
    latestImport: null,
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
          errors: [],
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: 'error',
          snapshots: [],
          latestImport: null,
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
  }, []);

  return {
    ...state,
    isEmpty: state.status === 'ready' && state.snapshots.length === 0,
  };
}
