import { readJsonBody, sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';
import {
  extractTransactionsFromScreenshot,
  getExtractTransactionsErrorResponse,
} from '../server/extractTransactions.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/extract-transactions';

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
    const payload = await readJsonBody(request);
    const result = await extractTransactionsFromScreenshot(payload);
    sendJson(response, 200, result);
  } catch (error) {
    if (isPortfolioAccessError(error)) {
      const authError = getPortfolioAccessErrorResponse(error, route);
      sendJson(response, authError.status, authError.body);
      return;
    }

    const formatted = getExtractTransactionsErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
