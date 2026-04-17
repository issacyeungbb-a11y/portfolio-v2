import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';

/**
 * @deprecated 此路由已由 /api/cron-daily-update 及 /api/cron-daily-rescue 取代。
 * 保留此檔案以防舊版部署呼叫，返回 410 Gone。
 */
export default function handler(request: ApiRequest, response: ApiResponse) {
  sendJson(response, 410, {
    ok: false,
    route: '/api/cron-update-prices',
    message: '此路由已停用。請使用 /api/cron-daily-update 或 /api/cron-daily-rescue。',
  });
}
