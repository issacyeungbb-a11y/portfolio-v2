import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import { verifyCronRequest } from '../server/cronDailyUpdate.js';
import {
  getScheduledAnalysisErrorResponse,
  runMonthlyAssetAnalysis,
} from '../server/scheduledAnalysis.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/cron-monthly-analysis';

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
    const result = await runMonthlyAssetAnalysis();
    sendJson(response, 200, {
      ...result,
      route,
      message: '已完成每月資產分析。'
    });
  } catch (error) {
    const formatted = getScheduledAnalysisErrorResponse(error, route);
    sendJson(response, formatted.status, formatted.body);
  }
}
