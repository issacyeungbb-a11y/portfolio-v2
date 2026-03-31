import { useEffect, useState } from 'react';

import type { Holding, PortfolioAssetInput } from '../types/portfolio';
import {
  createPortfolioAsset,
  getFirebaseAssetsErrorMessage,
  subscribeToPortfolioAssets,
  updatePortfolioAsset,
} from '../lib/firebase/assets';

type PortfolioAssetsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PortfolioAssetsState {
  status: PortfolioAssetsStatus;
  holdings: Holding[];
  error: string | null;
}

export function usePortfolioAssets() {
  const [state, setState] = useState<PortfolioAssetsState>({
    status: 'loading',
    holdings: [],
    error: null,
  });

  useEffect(() => {
    setState((current) => ({
      status: 'loading',
      holdings: current.holdings,
      error: null,
    }));

    const unsubscribe = subscribeToPortfolioAssets(
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
  }, []);

  async function addAsset(payload: PortfolioAssetInput) {
    try {
      await createPortfolioAsset(payload);
    } catch (error) {
      const message = getFirebaseAssetsErrorMessage(error);
      setState((current) => ({
        ...current,
        error: message,
      }));
      throw new Error(message);
    }
  }

  async function editAsset(assetId: string, payload: PortfolioAssetInput) {
    try {
      await updatePortfolioAsset(assetId, payload);
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
    editAsset,
  };
}
