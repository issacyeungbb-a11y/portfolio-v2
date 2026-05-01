import { sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';
import {
  verifyCronRequest,
  runDailyUpdate,
  getDailyUpdateErrorResponse,
} from '../server/cronDailyUpdate.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/cron-daily-update';

  if (request.method !== 'GET') {
    sendJson(response, 405, { ok: false, route, message: 'Method not allowed' });
    return;
  }

  try {
    verifyCronRequest(request.headers.authorization);
    const result = await runDailyUpdate('scheduled');
    sendJson(response, 200, result);
  } catch (error) {
    const formatted = getDailyUpdateErrorResponse(error, route);
    sendJson(response, formatted.status, formatted.body);
  }
}
