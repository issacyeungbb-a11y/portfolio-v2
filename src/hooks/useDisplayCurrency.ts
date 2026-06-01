import { useEffect, useState } from 'react';

import type { DisplayCurrency } from '../types/portfolio';

const DISPLAY_CURRENCY_STORAGE_KEY = 'portfolio.displayCurrency';
const DISPLAY_CURRENCY_VERSION_KEY = 'portfolio.displayCurrency.version';
const DISPLAY_CURRENCY_VERSION = 'usd-default-v1';
const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = 'USD';
const VALID_DISPLAY_CURRENCIES: DisplayCurrency[] = ['HKD', 'USD', 'JPY'];

function getStoredDisplayCurrency(): DisplayCurrency {
  if (typeof window === 'undefined') {
    return DEFAULT_DISPLAY_CURRENCY;
  }

  const stored = window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
  const version = window.localStorage.getItem(DISPLAY_CURRENCY_VERSION_KEY);

  if (version !== DISPLAY_CURRENCY_VERSION) {
    if (stored && stored !== 'HKD' && VALID_DISPLAY_CURRENCIES.includes(stored as DisplayCurrency)) {
      return stored as DisplayCurrency;
    }

    return DEFAULT_DISPLAY_CURRENCY;
  }

  if (stored && VALID_DISPLAY_CURRENCIES.includes(stored as DisplayCurrency)) {
    return stored as DisplayCurrency;
  }

  return DEFAULT_DISPLAY_CURRENCY;
}

export function useDisplayCurrency() {
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(getStoredDisplayCurrency);

  useEffect(() => {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, displayCurrency);
    window.localStorage.setItem(DISPLAY_CURRENCY_VERSION_KEY, DISPLAY_CURRENCY_VERSION);
  }, [displayCurrency]);

  return [displayCurrency, setDisplayCurrency] as const;
}

export { DEFAULT_DISPLAY_CURRENCY, VALID_DISPLAY_CURRENCIES };
