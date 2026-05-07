import { readJsonBody, sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';
import {
  analyzePortfolio,
  getAnalyzePortfolioErrorResponse,
} from '../server/analyzePortfolio.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/analyze';
  const requestId = String(request.headers['x-client-request-id'] ?? `server-${Date.now().toString(36)}`);
  const startedAt = Date.now();

  if (request.method !== 'POST') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    console.info(`[api/analyze] start requestId=${requestId}`);
    await requirePortfolioAccess(request, route);
    const payload = await readJsonBody(request);
    const result = await analyzePortfolio(payload);
    console.info(
      `[api/analyze] success requestId=${requestId} durationMs=${Date.now() - startedAt} intent=${result.intent ?? 'n/a'}`,
    );
    sendJson(response, 200, result);
  } catch (error) {
    console.error(
      `[api/analyze] failed requestId=${requestId} durationMs=${Date.now() - startedAt}`,
      error,
    );
    if (isPortfolioAccessError(error)) {
      const authError = getPortfolioAccessErrorResponse(error, route);
      sendJson(response, authError.status, authError.body);
      return;
    }

    const formatted = getAnalyzePortfolioErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
