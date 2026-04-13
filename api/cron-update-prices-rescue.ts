import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  getCronPriceUpdateErrorResponse,
  runRescuePriceUpdate,
  verifyCronRequest,
} from '../server/cronUpdatePrices.js';

/**
 * P0-3: 補救排程 endpoint。
 * 排程時間：06:30 HKT（UTC 22:30 前一天）。
 * 邏輯由 runRescuePriceUpdate() 決定是否真正執行或跳過。
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/cron-update-prices-rescue';

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
    const result = await runRescuePriceUpdate();
    sendJson(response, 200, result);
  } catch (error) {
    const formatted = getCronPriceUpdateErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
