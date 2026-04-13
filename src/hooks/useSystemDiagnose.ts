import { useState, useCallback } from 'react';
import { fetchSystemDiagnose } from '../lib/api/vercelFunctions';

export interface DiagnoseStepResult {
  ok: boolean;
  durationMs: number;
  detail: string;
  data?: unknown;
}

export interface SystemDiagnoseResult {
  ok: boolean;
  triggeredAt: string;
  durationMs: number;
  summary: { passedSteps: number; failedSteps: number };
  steps: {
    environment: DiagnoseStepResult;
    firebaseAdmin: DiagnoseStepResult;
    firestoreRead: DiagnoseStepResult;
    assets: DiagnoseStepResult;
    yahooFinance: DiagnoseStepResult;
    coinGecko: DiagnoseStepResult;
    pendingReviews: DiagnoseStepResult;
  };
}

export function useSystemDiagnose() {
  const [result, setResult] = useState<SystemDiagnoseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchSystemDiagnose();
      setResult(data as SystemDiagnoseResult);
      setLastFetchedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : '系統診斷失敗。');
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, lastFetchedAt, run };
}
