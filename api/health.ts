import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import { buildHealthResponse } from '../src/lib/api/mockFunctionResponses.js';
import { runDiagnostics } from '../server/diagnose';

function readMode(request: ApiRequest) {
  const requestUrl = request.url ?? '/api/health';

  try {
    return new URL(requestUrl, 'http://localhost').searchParams.get('mode')?.trim() ?? '';
  } catch {
    return '';
  }
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      route: '/api/health',
      message: 'Method not allowed',
    });
    return;
  }

  const mode = readMode(request);

  if (mode === 'diagnose') {
    try {
      const result = await runDiagnostics();
      sendJson(response, 200, {
        ...result,
        route: '/api/health',
        mode: 'diagnose',
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        route: '/api/health',
        mode: 'diagnose',
        message: error instanceof Error ? error.message : '診斷失敗，請稍後再試。',
      });
    }
    return;
  }

  sendJson(response, 200, buildHealthResponse());
}
