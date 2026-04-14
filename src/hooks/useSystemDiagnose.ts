import { useState, useCallback } from 'react';

export interface DiagnoseStepResult {
  ok: boolean;
  durationMs: number;
  detail: string;
  data?: unknown;
}

export interface SystemRunEntry {
  trigger: 'scheduled' | 'rescue' | 'manual';
  startedAt: string;
  ok: boolean;
  coveragePct: number;
  appliedCount: number;
  pendingCount: number;
  fxUsingFallback: boolean;
  durationMs: number;
  errorMessage: string | null;
}

export interface SystemRunsSummary {
  runs: SystemRunEntry[];
  lastRun: {
    trigger: string;
    startedAt: string;
    ok: boolean;
    coveragePct: number;
    pendingCount: number;
    fxUsingFallback: boolean;
  } | null;
  lastScheduledAt: string | null;
  lastRescueAt: string | null;
  lastFailedAt: string | null;
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
    systemRuns: DiagnoseStepResult;
  };
}

async function fetchSystemDiagnoseData(): Promise<SystemDiagnoseResult | null> {
  const response = await fetch('/api/health?mode=diagnose', { method: 'GET' });
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as SystemDiagnoseResult;
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
      const data = await fetchSystemDiagnoseData();
      setResult(data);
      setLastFetchedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : '系統診斷失敗。');
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, lastFetchedAt, run };
}
