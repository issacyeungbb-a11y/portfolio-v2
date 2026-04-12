import { onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { hasFirebaseConfig, missingFirebaseEnvKeys } from '../lib/firebase/client';
import { getSharedPortfolioDocRef } from '../lib/firebase/sharedPortfolio';
import type { FxRates } from '../types/fxRates';

const DEFAULT_FX_RATES: FxRates = {
  USD: 7.8,
  JPY: 0.052,
  HKD: 1,
};

type PortfolioFxRatesStatus = 'loading' | 'ready' | 'error';

interface PortfolioFxRatesState {
  rates: FxRates;
  status: PortfolioFxRatesStatus;
}

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function normalizeRate(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeFxRates(value: unknown): FxRates {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_FX_RATES };
  }

  const entry = value as Record<string, unknown>;

  return {
    USD: normalizeRate(entry.USD, DEFAULT_FX_RATES.USD),
    JPY: normalizeRate(entry.JPY, DEFAULT_FX_RATES.JPY),
    HKD: 1,
  };
}

export function usePortfolioFxRates() {
  const [state, setState] = useState<PortfolioFxRatesState>({
    rates: { ...DEFAULT_FX_RATES },
    status: 'loading',
  });

  useEffect(() => {
    if (!hasFirebaseConfig) {
      setState({
        rates: { ...DEFAULT_FX_RATES },
        status: 'error',
      });
      return;
    }

    setState({
      rates: { ...DEFAULT_FX_RATES },
      status: 'loading',
    });

    const unsubscribe = onSnapshot(
      getSharedPortfolioDocRef(),
      (snapshot) => {
        const documentData = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null;
        setState({
          rates: normalizeFxRates(documentData?.fxRates),
          status: 'ready',
        });
      },
      () => {
        setState({
          rates: { ...DEFAULT_FX_RATES },
          status: 'error',
        });
      },
    );

    return unsubscribe;
  }, []);

  return state;
}

export type { FxRates };
export { DEFAULT_FX_RATES };
