import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import { runDiagnostics } from '../server/diagnose';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/diagnose';

  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    const result = await runDiagnostics();
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      route,
      message: error instanceof Error ? error.message : '診斷失敗，請稍後再試。',
    });
  }
}
