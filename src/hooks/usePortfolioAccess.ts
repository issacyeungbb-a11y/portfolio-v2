import { useEffect, useState } from 'react';

import {
  PortfolioAccessDeniedError,
  getCurrentPortfolioAccessCode,
  hasConfiguredPortfolioAccessCode,
  hasPortfolioAccessSession,
  lockPortfolio,
  unlockPortfolio,
} from '../lib/access/accessCode';

type PortfolioAccessStatus = 'checking' | 'locked' | 'unlocking' | 'unlocked' | 'error';

function getErrorMessage(error: unknown) {
  if (error instanceof PortfolioAccessDeniedError) return error.message;
  return error instanceof Error ? error.message : '未能驗證存取碼，請稍後再試。';
}

export function usePortfolioAccess() {
  const [status, setStatus] = useState<PortfolioAccessStatus>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function restore() {
      try {
        if (await hasPortfolioAccessSession()) {
          if (isActive) setStatus('unlocked');
          return;
        }

        // 有記住存取碼但登入憑證已失效：自動重新驗證一次。
        const storedCode = getCurrentPortfolioAccessCode();
        if (storedCode) {
          await unlockPortfolio(storedCode);
          if (isActive) setStatus('unlocked');
          return;
        }

        if (isActive) setStatus('locked');
      } catch (restoreError) {
        if (restoreError instanceof PortfolioAccessDeniedError) {
          await lockPortfolio().catch(() => undefined);
        }
        if (isActive) {
          setStatus('locked');
          setError(getErrorMessage(restoreError));
        }
      }
    }

    void restore();

    return () => {
      isActive = false;
    };
  }, []);

  async function unlock(input: string) {
    setStatus('unlocking');
    setError(null);

    try {
      await unlockPortfolio(input);
      setStatus('unlocked');
      return true;
    } catch (unlockError) {
      setStatus('locked');
      setError(getErrorMessage(unlockError));
      return false;
    }
  }

  async function lock() {
    await lockPortfolio().catch(() => undefined);
    setStatus('locked');
    setError(null);
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
