import { sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';
import { readCryptoHistory } from '../server/cryptoHistory.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

const ROUTE = '/api/crypto-history';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, {
      ok: false,
      route: ROUTE,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    await requirePortfolioAccess(request, ROUTE);
    const data = await readCryptoHistory();
    response.setHeader('Cache-Control', 'private, no-store');
    sendJson(response, 200, {
      ok: true,
      ...data,
    });
  } catch (error) {
    if (isPortfolioAccessError(error)) {
      const formatted = getPortfolioAccessErrorResponse(error, ROUTE);
      sendJson(response, formatted.status, formatted.body);
      return;
    }

    sendJson(response, 500, {
      ok: false,
      route: ROUTE,
      message: error instanceof Error ? error.message : '未能讀取 Crypto 歷史資料。',
    });
  }
}
