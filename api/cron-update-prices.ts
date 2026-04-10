import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  getCronPriceUpdateErrorResponse,
  runScheduledPriceUpdate,
  verifyCronRequest,
} from '../server/cronUpdatePrices.js';

function getBatchParam(request: ApiRequest) {
  const host = request.headers.host ?? 'localhost';
  const parsed = new URL(request.url ?? '/api/cron-update-prices', `http://${host}`);
  const batch = parsed.searchParams.get('batch')?.trim();

  return batch || undefined;
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/cron-update-prices';

  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    verifyCronRequest(request.headers.authorization);
    const result = await runScheduledPriceUpdate(getBatchParam(request));
    sendJson(response, 200, result);
  } catch (error) {
    const formatted = getCronPriceUpdateErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
