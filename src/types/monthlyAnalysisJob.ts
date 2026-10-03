export interface MonthlyAnalysisJob {
  id: string;
  coveredMonthKey: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt?: number;
  message?: string;
  sessionDocId?: string;
  isTimeoutFallback?: boolean;
}
