import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  getCronPriceUpdateErrorResponse,
  runScheduledPriceUpdate,
  runRescuePriceUpdate,
  verifyCronRequest,
} from '../server/cronUpdatePrices.js';

/**
 * 主排程：?rescue=1 時執行補救流程，否則執行標準排程。
 * 兩個 vercel.json cron 指向同一個 endpoint，避免超出 Hobby plan 12 function 上限。
 */
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
    const isRescue = new URL(request.url ?? '', 'http://localhost').searchParams.get('rescue') === '1';
    const result = isRescue ? await runRescuePriceUpdate() : await runScheduledPriceUpdate();
    sendJson(response, 200, result);
  } catch (error) {
    const formatted = getCronPriceUpdateErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
