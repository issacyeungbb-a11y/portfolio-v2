import type { SystemDiagnoseResult } from '../../hooks/useSystemDiagnose';

const STEP_NAMES = ['environment', 'firebaseAdmin', 'firestoreRead', 'assets', 'yahooFinance', 'coinGecko', 'pendingReviews', 'snapshotQualityTrend', 'systemRuns', 'dailyJob'];
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** A transport/auth error must never be rendered as a diagnostic report. */
export function parseSystemDiagnoseResponse(value: unknown): SystemDiagnoseResult {
  const valid = record(value) && typeof value.ok === 'boolean'
    && typeof value.triggeredAt === 'string' && finite(value.durationMs)
    && record(value.summary) && finite(value.summary.passedSteps) && finite(value.summary.failedSteps)
    && record(value.steps) && STEP_NAMES.every(name => {
      const step = (value.steps as Record<string, unknown>)[name];
      return record(step) && typeof step.ok === 'boolean' && typeof step.detail === 'string' && finite(step.durationMs);
    });
  if (!valid) {
    throw new Error(record(value) && typeof value.message === 'string'
      ? value.message
      : '系統診斷回應格式不完整，請稍後重試。');
  }
  return value as unknown as SystemDiagnoseResult;
}
