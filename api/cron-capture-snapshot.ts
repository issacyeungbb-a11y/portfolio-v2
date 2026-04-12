import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  getCronSnapshotErrorResponse,
  runScheduledDailySnapshot,
  verifySnapshotCronRequest,
} from '../server/cronCaptureSnapshot';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/cron-capture-snapshot';

  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    verifySnapshotCronRequest(request.headers.authorization);
    const result = await runScheduledDailySnapshot();
    sendJson(response, 200, result);
  } catch (error) {
    const formatted = getCronSnapshotErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
