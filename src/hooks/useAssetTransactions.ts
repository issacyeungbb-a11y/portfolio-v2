import { useEffect, useState } from 'react';

import type { AssetTransactionEntry } from '../types/portfolio';
import {
  createAssetTransaction,
  getAssetTransactionsErrorMessage,
  subscribeToAssetTransactions,
} from '../lib/firebase/assetTransactions';

type AssetTransactionsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AssetTransactionsState {
  status: AssetTransactionsStatus;
  entries: AssetTransactionEntry[];
  error: string | null;
}

export function useAssetTransactions() {
  const [state, setState] = useState<AssetTransactionsState>({
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

    const unsubscribe = subscribeToAssetTransactions(
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
          error: getAssetTransactionsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, []);

  async function addTransaction(entry: Omit<AssetTransactionEntry, 'id' | 'createdAt' | 'updatedAt'>) {
    try {
      await createAssetTransaction(entry);
    } catch (error) {
      const message = getAssetTransactionsErrorMessage(error);
      setState((current) => ({
        ...current,
        error: message,
      }));
      throw new Error(message);
    }
  }

  return {
    ...state,
    addTransaction,
  };
}
