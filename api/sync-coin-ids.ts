import { readJsonBody, sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  getCoinGeckoCoinIdSyncErrorResponse,
  runCoinGeckoCoinIdSync,
} from '../server/syncCoinIds';
import { verifyCronRequest } from '../server/cronUpdatePrices';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/sync-coin-ids';

  if (request.method !== 'GET' && request.method !== 'POST') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    verifyCronRequest(request.headers.authorization);
    const payload = request.method === 'POST' ? await readJsonBody(request) : undefined;
    const result = await runCoinGeckoCoinIdSync(payload);
    sendJson(response, 200, result);
  } catch (error) {
    const formatted = getCoinGeckoCoinIdSyncErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
