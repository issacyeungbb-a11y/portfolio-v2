import { useEffect, useState } from 'react';

import {
  clearAccessCodeVerification,
  getPortfolioAccessCodeErrorMessage,
  getStoredAccessCodeVerification,
  hasConfiguredPortfolioAccessCode,
  persistAccessCodeVerification,
  verifyPortfolioAccessCode,
} from '../lib/access/accessCode';

type PortfolioAccessStatus = 'locked' | 'unlocked' | 'error';

export function usePortfolioAccess() {
  const [status, setStatus] = useState<PortfolioAccessStatus>(() => {
    if (!hasConfiguredPortfolioAccessCode) {
      return 'error';
    }

    return getStoredAccessCodeVerification() ? 'unlocked' : 'locked';
  });
  const [error, setError] = useState<string | null>(() =>
    hasConfiguredPortfolioAccessCode ? null : getPortfolioAccessCodeErrorMessage(),
  );

  useEffect(() => {
    if (!hasConfiguredPortfolioAccessCode) {
      setStatus('error');
      setError(getPortfolioAccessCodeErrorMessage());
      return;
    }

    if (getStoredAccessCodeVerification()) {
      setStatus('unlocked');
      setError(null);
    }
  }, []);

  function unlock(input: string) {
    if (!hasConfiguredPortfolioAccessCode) {
      setStatus('error');
      setError(getPortfolioAccessCodeErrorMessage());
      return false;
    }

    if (!verifyPortfolioAccessCode(input)) {
      setStatus('locked');
      setError(getPortfolioAccessCodeErrorMessage());
      return false;
    }

    persistAccessCodeVerification();
    setStatus('unlocked');
    setError(null);
    return true;
  }

  function lock() {
    clearAccessCodeVerification();
    setStatus(hasConfiguredPortfolioAccessCode ? 'locked' : 'error');
    setError(hasConfiguredPortfolioAccessCode ? null : getPortfolioAccessCodeErrorMessage());
  }

  return {
    status,
    error,
    isUnlocked: status === 'unlocked',
    unlock,
    lock,
    hasConfiguredPortfolioAccessCode,
  };
}
