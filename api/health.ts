import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import { buildHealthResponse } from '../src/lib/api/mockFunctionResponses.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      route: '/api/health',
      message: 'Method not allowed',
    });
    return;
  }

  sendJson(response, 200, buildHealthResponse());
}
