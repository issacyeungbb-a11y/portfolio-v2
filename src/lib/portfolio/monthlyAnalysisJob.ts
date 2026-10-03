import type { AnalysisSession } from '../../types/portfolio';

export function getMonthlyReportPeriod(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const coveredYear = previous.getUTCFullYear();
  const coveredMonth = previous.getUTCMonth() + 1;
  const key = `${coveredYear}-${String(coveredMonth).padStart(2, '0')}`;
  return { key, docId: `monthly-${key}`, title: `${coveredYear}年${coveredMonth}月每月資產分析` };
}

export function findCompletedMonthlyJobSession(sessions: AnalysisSession[], jobId: string) {
  return sessions.find((session) => session.generationJobId === jobId && Boolean(session.result.trim())) ?? null;
}
