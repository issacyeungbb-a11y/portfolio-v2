import { readJsonBody, sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';
import {
  extractAssetsFromScreenshot,
  getExtractAssetsErrorResponse,
} from '../server/extractAssets.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/extract-assets';

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
    const result = await extractAssetsFromScreenshot(payload);
    sendJson(response, 200, result);
  } catch (error) {
    if (isPortfolioAccessError(error)) {
      const authError = getPortfolioAccessErrorResponse(error, route);
      sendJson(response, authError.status, authError.body);
      return;
    }

    const formatted = getExtractAssetsErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
