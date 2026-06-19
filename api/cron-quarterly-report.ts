import { sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/cron-quarterly-report';

  if (request.method !== 'GET' && request.method !== 'POST') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  sendJson(response, 410, {
    ok: false,
    route,
    message: '季度報告已改為只可手動生成；請使用 /api/manual-quarterly-report。',
  });
}
