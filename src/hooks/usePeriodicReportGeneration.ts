import { useCallback, useEffect, useState } from 'react';
import { callPortfolioFunction, isRetryablePortfolioFunctionError, PortfolioFunctionHttpError } from '../lib/api/vercelFunctions';
import type { MonthlyAnalysisJob } from '../types/monthlyAnalysisJob';
import type { QuarterlyAnalysisJob } from '../types/quarterlyAnalysisJob';

type Job = MonthlyAnalysisJob | QuarterlyAnalysisJob;
type SavedReport = { id: string; generationJobId?: string; result?: string; report?: string; isTimeoutFallback?: boolean };

export function usePeriodicReportGeneration(options: {
  kind: 'monthly' | 'quarterly';
  records: SavedReport[];
  onComplete: (docId: string) => void;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const { kind, records, onComplete, onMessage, onError } = options;
  const label = kind === 'monthly' ? '月報' : '季報';
  const statusKey = kind === 'monthly' ? 'monthly-analysis-status' : 'quarterly-analysis-status';
  const generateKey = kind === 'monthly' ? 'manual-monthly-analysis' : 'manual-quarterly-report';
  const storageKey = `portfolio-report-job-${kind}`;
  const [jobId, setJobId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const finish = useCallback((docId: string, fallback = false, message?: string) => {
    try { localStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
    setJobId(null);
    setAccepting(false);
    onError(null);
    onMessage(message ?? (fallback ? `已儲存簡化${label}，可重新生成完整報告。` : `${label}已完成並儲存。`));
    onComplete(docId);
  }, [storageKey, label, onError, onMessage, onComplete]);

  useEffect(() => {
    if (!jobId) return;
    const saved = records.find((record) => record.generationJobId === jobId && (record.report ?? record.result ?? '').trim());
    if (saved) finish(saved.id, saved.isTimeoutFallback);
  }, [records, jobId, finish]);

  useEffect(() => {
    let active = true;
    let pending: string | null = null;
    try { pending = localStorage.getItem(storageKey); } catch { /* Query latest server job instead. */ }
    if (pending) setJobId(pending);
    void callPortfolioFunction(statusKey, pending ? { jobId: pending } : undefined).then((payload) => {
      if (!active) return;
      const job = (payload as { job: Job | null }).job;
      if (job?.status === 'running' || (pending && job)) setJobId(job.id);
    }).catch(() => { /* Pending jobs are recovered by polling below. */ });
    return () => { active = false; };
  }, [storageKey, statusKey]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let missingRetries = 0;
    const deadline = Date.now() + 420_000;
    const fail = (message: string, clearPending = true) => {
      if (clearPending) {
        try { localStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
      }
      onMessage(null);
      onError(message);
      setJobId(null);
      setAccepting(false);
    };
    const poll = async () => {
      if (Date.now() >= deadline) {
        fail(`暫時未能確認${label}結果，請重新整理查看已儲存報告，或重試生成。`, false);
        return;
      }
      try {
        const payload = await callPortfolioFunction(statusKey, { jobId }) as { job: Job };
        if (!active) return;
        const job = payload.job;
        const docId = 'reportDocId' in job ? job.reportDocId : 'sessionDocId' in job ? job.sessionDocId : undefined;
        if (job.status === 'succeeded' && docId) {
          finish(docId, job.isTimeoutFallback, job.message);
          return;
        }
        if (job.status === 'failed') {
          fail(job.message ?? `${label}生成失敗，請重試。`);
          return;
        }
        onMessage(`${label}正在背景生成，重新整理後仍會繼續追蹤。`);
      } catch (error) {
        if (!active) return;
        if (error instanceof PortfolioFunctionHttpError && error.status === 404) {
          // A lost POST may never have reached the server. Retry the same ID,
          // which deduplicates accepted requests and concurrent clicks.
          if (missingRetries >= 2) {
            fail(`${label}工作未能開始，請重試生成。`);
            return;
          }
          missingRetries += 1;
          try {
            const accepted = await callPortfolioFunction(generateKey, { jobId, overwrite: true }) as { job: Job };
            if (!active) return;
            if (accepted.job.id !== jobId) {
              try { localStorage.setItem(storageKey, accepted.job.id); } catch { /* Server retains the job. */ }
              setJobId(accepted.job.id);
              return;
            }
          } catch (retryError) {
            if (!active) return;
            if (!isRetryablePortfolioFunctionError(retryError)) { fail(retryError instanceof Error ? retryError.message : `${label}工作未能開始。`); return; }
          }
        } else if (!isRetryablePortfolioFunctionError(error)) {
          fail(error instanceof Error ? error.message : `查詢${label}狀態失敗。`);
          return;
        }
        onMessage(`連線暫時中斷，正在重新確認${label}結果。`);
      }
      if (active) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, finish, label, statusKey, generateKey, storageKey, onError, onMessage]);

  const start = useCallback(async () => {
    const requestedId = crypto.randomUUID();
    setAccepting(true);
    onError(null);
    onMessage(`${label}正在背景生成，通常需要 1–3 分鐘。`);
    try { localStorage.setItem(storageKey, requestedId); } catch { /* Server also retains the job. */ }
    try {
      const payload = await callPortfolioFunction(generateKey, { jobId: requestedId, overwrite: true }) as { job: Job };
      try { localStorage.setItem(storageKey, payload.job.id); } catch { /* Server also retains the job. */ }
      setJobId(payload.job.id);
    } catch (error) {
      if (isRetryablePortfolioFunctionError(error)) {
        setJobId(requestedId);
        onMessage(`正在確認${label}工作有否開始。`);
      } else {
        try { localStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
        onMessage(null);
        onError(error instanceof Error ? error.message : `${label}生成失敗。`);
      }
    } finally {
      setAccepting(false);
    }
  }, [label, storageKey, generateKey, onError, onMessage]);

  return { start, running: accepting || jobId !== null };
}
