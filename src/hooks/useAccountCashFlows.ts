import { useEffect, useState } from 'react';

import type { AccountCashFlowEntry } from '../types/portfolio';
import {
  createAccountCashFlow,
  getAccountCashFlowsErrorMessage,
  subscribeToAccountCashFlows,
} from '../lib/firebase/accountCashFlows';

type AccountCashFlowsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AccountCashFlowsState {
  status: AccountCashFlowsStatus;
  entries: AccountCashFlowEntry[];
  error: string | null;
}

export function useAccountCashFlows() {
  const [state, setState] = useState<AccountCashFlowsState>({
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

    const unsubscribe = subscribeToAccountCashFlows(
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
          error: getAccountCashFlowsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, []);

  async function addCashFlow(
    entry: Omit<AccountCashFlowEntry, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    try {
      await createAccountCashFlow(entry);
    } catch (error) {
      const message = getAccountCashFlowsErrorMessage(error);
      setState((current) => ({
        ...current,
        error: message,
      }));
      throw new Error(message);
    }
  }

  return {
    ...state,
    addCashFlow,
  };
}
