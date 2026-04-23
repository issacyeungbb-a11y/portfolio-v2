import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import { verifyCronRequest } from '../server/cronAuth.js';
import {
  getScheduledAnalysisErrorResponse,
  runManualMonthlyAssetAnalysis,
  runMonthlyAssetAnalysis,
} from '../server/scheduledAnalysis.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/cron-monthly-analysis';

  if (request.method !== 'GET' && request.method !== 'POST') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    const result =
      request.method === 'GET'
        ? (() => {
            verifyCronRequest(request.headers.authorization);
            return runMonthlyAssetAnalysis();
          })()
        : (() => {
            return requirePortfolioAccess(request, route).then(() => runManualMonthlyAssetAnalysis());
          })();
    sendJson(response, 200, {
      ...(await result),
      route,
      message: request.method === 'GET' ? '已完成每月資產分析。' : undefined,
    });
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
