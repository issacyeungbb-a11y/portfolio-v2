import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  getCronPriceUpdateErrorResponse,
  runScheduledPriceUpdate,
  verifyCronRequest,
} from '../server/cronUpdatePrices';

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
    const result = await runScheduledPriceUpdate();
    sendJson(response, 200, result);
  } catch (error) {
    const formatted = getCronPriceUpdateErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
