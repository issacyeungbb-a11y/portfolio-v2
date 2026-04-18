import { readJsonBody, sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  generatePriceUpdates,
  getUpdatePricesErrorResponse,
} from '../server/updatePrices.js';
import {
  getCoinGeckoCoinIdSyncErrorResponse,
  runCoinGeckoCoinIdSync,
} from '../server/syncCoinIds.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/update-prices';

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
    const payloadObject = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null;

    if (
      payloadObject &&
      Array.isArray(payloadObject.syncTickers) &&
      !Array.isArray(payloadObject.assets)
    ) {
      const result = await runCoinGeckoCoinIdSync({ tickers: payloadObject.syncTickers });
      sendJson(response, 200, result);
      return;
    }

    const result = await generatePriceUpdates(payload);
    sendJson(response, 200, result);
  } catch (error) {
    if (isPortfolioAccessError(error)) {
      const authError = getPortfolioAccessErrorResponse(error, route);
      sendJson(response, authError.status, authError.body);
      return;
    }

    if (error instanceof Error && error.message.includes('CoinGecko 代號同步')) {
      const formatted = getCoinGeckoCoinIdSyncErrorResponse(error);
      sendJson(response, formatted.status, formatted.body);
      return;
    }

    const formatted = getUpdatePricesErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
