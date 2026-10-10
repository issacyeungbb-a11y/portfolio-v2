export interface QuarterlyAnalysisJob {
  id: string;
  quarter: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt?: number;
  message?: string;
  reportDocId?: string;
  isTimeoutFallback?: boolean;
}
