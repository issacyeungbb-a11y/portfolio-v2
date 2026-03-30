import { useEffect, useState } from 'react';

import type { AssetPriceHistoryEntry } from '../types/priceUpdates';
import {
  getPriceHistoryErrorMessage,
  subscribeToAssetPriceHistory,
} from '../lib/firebase/priceHistory';

type AssetPriceHistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AssetPriceHistoryState {
  status: AssetPriceHistoryStatus;
  entries: AssetPriceHistoryEntry[];
  error: string | null;
}

export function useAssetPriceHistory(assetId: string | null, count = 30) {
  const [state, setState] = useState<AssetPriceHistoryState>({
    status: assetId ? 'loading' : 'idle',
    entries: [],
    error: null,
  });

  useEffect(() => {
    if (!assetId) {
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

    const unsubscribe = subscribeToAssetPriceHistory(
      assetId,
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
          error: getPriceHistoryErrorMessage(error),
        });
      },
      count,
    );

    return unsubscribe;
  }, [assetId, count]);

  return {
    ...state,
    hasEntries: state.entries.length > 0,
  };
}
