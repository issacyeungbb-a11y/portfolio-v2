import { sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';
import {
  getCronSnapshotErrorResponse,
  runManualDailySnapshot,
} from '../server/cronCaptureSnapshot.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/manual-capture-snapshot';
  const force = (() => {
    try {
      return new URL(request.url ?? route, 'http://localhost').searchParams.get('force') === 'true';
    } catch {
      return false;
    }
  })();

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
    const result = await runManualDailySnapshot({ force });
    sendJson(response, 200, result);
  } catch (error) {
    if (isPortfolioAccessError(error)) {
      const authError = getPortfolioAccessErrorResponse(error, route);
      sendJson(response, authError.status, authError.body);
      return;
    }

    const formatted = getCronSnapshotErrorResponse(error, route);
    sendJson(response, formatted.status, formatted.body);
  }
}
