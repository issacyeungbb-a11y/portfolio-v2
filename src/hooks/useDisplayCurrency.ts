import { useEffect, useState } from 'react';

import type { DisplayCurrency } from '../types/portfolio';

const DISPLAY_CURRENCY_STORAGE_KEY = 'portfolio.displayCurrency';
const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = 'HKD';
const VALID_DISPLAY_CURRENCIES: DisplayCurrency[] = ['HKD', 'USD', 'JPY'];

function getStoredDisplayCurrency(): DisplayCurrency {
  if (typeof window === 'undefined') {
    return DEFAULT_DISPLAY_CURRENCY;
  }

  const stored = window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
  if (stored && VALID_DISPLAY_CURRENCIES.includes(stored as DisplayCurrency)) {
    return stored as DisplayCurrency;
  }

  return DEFAULT_DISPLAY_CURRENCY;
}

export function useDisplayCurrency() {
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(getStoredDisplayCurrency);

  useEffect(() => {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, displayCurrency);
  }, [displayCurrency]);

  return [displayCurrency, setDisplayCurrency] as const;
}

export { DEFAULT_DISPLAY_CURRENCY, VALID_DISPLAY_CURRENCIES };
