import { useCallback, useEffect, useRef, useState } from 'react';

import type { Holding, PortfolioAssetInput } from '../types/portfolio';
import {
  createPortfolioAsset,
  deletePortfolioAsset,
  getFirebaseAssetsErrorMessage,
  getAllPortfolioAssetsFromServer,
  getPortfolioAssetsFromServer,
  subscribeToAllPortfolioAssets,
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

  const hasServerSnapshot = useRef(false);

  const refreshFromServer = useCallback(async () => {
    try {
      const holdings = await getPortfolioAssetsFromServer();
      hasServerSnapshot.current = true;
      setState({
        status: 'ready',
        holdings,
        error: null,
      });
    } catch (error) {
      const message = getFirebaseAssetsErrorMessage(error);
      setState((current) => ({
        ...current,
        status: current.holdings.length > 0 ? 'ready' : 'error',
        error: message,
      }));
      throw new Error(message);
    }
  }, []);

  useEffect(() => {
    setState((current) => ({
      status: 'loading',
      holdings: current.holdings,
      error: null,
    }));

    const unsubscribe = subscribeToPortfolioAssets(
      (holdings, metadata) => {
        if (metadata?.fromCache && hasServerSnapshot.current) {
          return;
        }

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

    void refreshFromServer().catch(() => undefined);

    return unsubscribe;
  }, [refreshFromServer]);

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

  async function removeAsset(assetId: string) {
    try {
      await deletePortfolioAsset(assetId);
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
    removeAsset,
    refreshFromServer,
  };
}

export function useAllPortfolioAssets() {
  const [state, setState] = useState<PortfolioAssetsState>({
    status: 'loading',
    holdings: [],
    error: null,
  });

  const hasServerSnapshot = useRef(false);

  const refreshFromServer = useCallback(async () => {
    try {
      const holdings = await getAllPortfolioAssetsFromServer();
      hasServerSnapshot.current = true;
      setState({
        status: 'ready',
        holdings,
        error: null,
      });
    } catch (error) {
      const message = getFirebaseAssetsErrorMessage(error);
      setState((current) => ({
        ...current,
        status: current.holdings.length > 0 ? 'ready' : 'error',
        error: message,
      }));
      throw new Error(message);
    }
  }, []);

  useEffect(() => {
    setState((current) => ({
      status: 'loading',
      holdings: current.holdings,
      error: null,
    }));

    const unsubscribe = subscribeToAllPortfolioAssets(
      (holdings, metadata) => {
        if (metadata?.fromCache && hasServerSnapshot.current) {
          return;
        }

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

    void refreshFromServer().catch(() => undefined);

    return unsubscribe;
  }, [refreshFromServer]);

  return {
    ...state,
    isEmpty: state.status === 'ready' && state.holdings.length === 0,
    refreshFromServer,
  };
}
