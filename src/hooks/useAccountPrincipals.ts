import { useEffect, useState } from 'react';

import type { AccountPrincipalEntry } from '../types/portfolio';
import {
  getAccountPrincipalsErrorMessage,
  saveAccountPrincipal,
  subscribeToAccountPrincipals,
} from '../lib/firebase/accountPrincipals';

type AccountPrincipalsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AccountPrincipalsState {
  status: AccountPrincipalsStatus;
  entries: AccountPrincipalEntry[];
  error: string | null;
}

export function useAccountPrincipals() {
  const [state, setState] = useState<AccountPrincipalsState>({
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

    const unsubscribe = subscribeToAccountPrincipals(
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
          error: getAccountPrincipalsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, []);

  async function updateAccountPrincipal(entry: AccountPrincipalEntry) {
    try {
      await saveAccountPrincipal(entry);
    } catch (error) {
      const message = getAccountPrincipalsErrorMessage(error);
      setState((current) => ({
        ...current,
        error: message,
      }));
      throw new Error(message);
    }
  }

  return {
    ...state,
    updateAccountPrincipal,
  };
}
