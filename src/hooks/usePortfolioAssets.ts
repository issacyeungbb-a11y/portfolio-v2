import { useEffect, useState } from 'react';

import type { Holding, PortfolioAssetInput } from '../types/portfolio';
import {
  createPortfolioAsset,
  getFirebaseAssetsErrorMessage,
  subscribeToPortfolioAssets,
} from '../lib/firebase/assets';

type PortfolioAssetsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PortfolioAssetsState {
  status: PortfolioAssetsStatus;
  holdings: Holding[];
  error: string | null;
}

export function usePortfolioAssets(uid: string | null) {
  const [state, setState] = useState<PortfolioAssetsState>({
    status: uid ? 'loading' : 'idle',
    holdings: [],
    error: null,
  });

  useEffect(() => {
    if (!uid) {
      setState({
        status: 'idle',
        holdings: [],
        error: null,
      });
      return;
    }

    setState((current) => ({
      status: 'loading',
      holdings: current.holdings,
      error: null,
    }));

    const unsubscribe = subscribeToPortfolioAssets(
      uid,
      (holdings) => {
        setState({
          status: 'ready',
          holdings,
          error: null,
        });
      },
      (error) => {
        setState({
          status: 'error',
          holdings: [],
          error: getFirebaseAssetsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, [uid]);

  async function addAsset(payload: PortfolioAssetInput) {
    if (!uid) {
      throw new Error('匿名身份尚未完成，請稍後再試。');
    }

    try {
      await createPortfolioAsset(uid, payload);
    } catch (error) {
      const message = getFirebaseAssetsErrorMessage(error);
      setState((current) => ({
        ...current,
        error: message,
      }));
      throw new Error(message);
    }
  }

  return {
    ...state,
    isEmpty: state.status === 'ready' && state.holdings.length === 0,
    addAsset,
  };
}
