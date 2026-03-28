import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import { firebaseAuth, hasFirebaseConfig } from '../lib/firebase/client';
import {
  ensureAnonymousSession,
  getFirebaseAuthErrorMessage,
  subscribeToFirebaseAuth,
} from '../lib/firebase/auth';

type AuthStatus = 'loading' | 'authenticated' | 'error';

interface AnonymousAuthState {
  status: AuthStatus;
  user: User | null;
  error: string | null;
}

export function useAnonymousAuth() {
  const [state, setState] = useState<AnonymousAuthState>(() => ({
    status: !hasFirebaseConfig
      ? 'error'
      : firebaseAuth?.currentUser
        ? 'authenticated'
        : 'loading',
    user: firebaseAuth?.currentUser ?? null,
    error: hasFirebaseConfig ? null : getFirebaseAuthErrorMessage(),
  }));

  useEffect(() => {
    if (!hasFirebaseConfig) {
      return;
    }

    let isActive = true;
    const unsubscribe = subscribeToFirebaseAuth((user) => {
      if (!isActive || !user) {
        return;
      }

      setState({
        status: 'authenticated',
        user,
        error: null,
      });
    });

    ensureAnonymousSession()
      .then((user) => {
        if (!isActive) {
          return;
        }

        setState({
          status: 'authenticated',
          user,
          error: null,
        });
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setState({
          status: 'error',
          user: null,
          error: getFirebaseAuthErrorMessage(error),
        });
      });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  return {
    ...state,
    hasFirebaseConfig,
    isAnonymous: Boolean(state.user?.isAnonymous),
    uid: state.user?.uid ?? null,
  };
}
