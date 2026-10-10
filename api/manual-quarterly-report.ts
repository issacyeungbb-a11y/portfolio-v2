import { waitUntil } from '@vercel/functions';
import { readJsonBody, sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';
// Runtime note:
// This API route executes `../server/scheduledAnalysis.js` on Vercel today.
// Keep `server/scheduledAnalysis.ts` and `server/scheduledAnalysis.js` fully in sync
// until the runtime build path is consolidated into a single maintained source.
import {
  getScheduledAnalysisErrorResponse,
} from '../server/scheduledAnalysis.js';
import { getQuarterlyAnalysisJob, isQuarterlyJobId, runQuarterlyAnalysisJob, startQuarterlyAnalysisJob } from '../server/quarterlyAnalysisJobs.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/manual-quarterly-report';

  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST' && request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    await requirePortfolioAccess(request, route);
    if (request.method === 'GET') {
      const jobId = new URL(request.url ?? route, 'https://portfolio.local').searchParams.get('jobId') ?? undefined;
      if (jobId && !isQuarterlyJobId(jobId)) {
        sendJson(response, 400, { ok: false, route, message: '季報工作編號無效。' });
        return;
      }
      const job = await getQuarterlyAnalysisJob(jobId);
      sendJson(response, jobId && !job ? 404 : 200, { ok: !jobId || Boolean(job), route, job,
        ...(!job && jobId ? { message: '找不到季報工作。' } : {}) });
      return;
    }
    const body = await readJsonBody(request) as { jobId?: unknown } | null;
    if (body?.jobId !== undefined && !isQuarterlyJobId(body.jobId)) {
      sendJson(response, 400, { ok: false, route, message: '季報工作編號無效。' });
      return;
    }
    const { job, shouldRun } = await startQuarterlyAnalysisJob(body?.jobId as string | undefined);
    if (shouldRun) waitUntil(runQuarterlyAnalysisJob(job));
    sendJson(response, 202, { ok: true, route, job });
  } catch (error) {
    if (isPortfolioAccessError(error)) {
      const authError = getPortfolioAccessErrorResponse(error, route);
      sendJson(response, authError.status, authError.body);
      return;
    }

    const formatted = getScheduledAnalysisErrorResponse(error, route);
    sendJson(response, formatted.status, formatted.body);
  }
}
