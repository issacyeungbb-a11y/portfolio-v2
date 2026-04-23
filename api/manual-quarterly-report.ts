import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  getScheduledAnalysisErrorResponse,
  runManualQuarterlyAssetReport,
} from '../server/scheduledAnalysis.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/manual-quarterly-report';

  if (request.method !== 'POST') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    await requirePortfolioAccess(request, route);
    const result = await runManualQuarterlyAssetReport();
    sendJson(response, 200, result);
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
