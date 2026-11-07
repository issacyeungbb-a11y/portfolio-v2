import { sendJson, type ApiRequest, type ApiResponse } from './apiShared.js';

const PUBLIC_PORTFOLIO_ROUTE = '/api/portfolio-public';

export function getConfiguredPublicPortfolioCode() {
  return (
    process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() ||
    process.env.PORTFOLIO_ACCESS_CODE?.trim() ||
    ''
  );
}

export function getPublicPortfolioQueryCode(request: ApiRequest) {
  try {
    return new URL(request.url ?? PUBLIC_PORTFOLIO_ROUTE, 'http://localhost').searchParams.get('code')?.trim() ?? '';
  } catch {
    return '';
  }
}

export const PUBLIC_ALLOWED_METHODS = 'GET, HEAD, OPTIONS';

export function setPublicApiHeaders(response: ApiResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', PUBLIC_ALLOWED_METHODS);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'no-store');
}

// 每個公開請求寫一行紀錄，方便追查外部工具（例如 ChatGPT）讀取失敗。
// 只記錄方法、狀態、耗時及 User-Agent；存取碼及完整網址一律唔寫入紀錄。
export function logPublicApiRequest(
  request: ApiRequest,
  route: string,
  status: number,
  startedAt: number,
  extra: Record<string, unknown> = {},
) {
  const userAgent = request.headers?.['user-agent'];
  console.info('[public-api]', JSON.stringify({
    route,
    method: request.method ?? '',
    status,
    durationMs: Date.now() - startedAt,
    userAgent: (Array.isArray(userAgent) ? userAgent.join(' ') : userAgent ?? '').slice(0, 200),
    ...extra,
  }));
}

/**
 * 處理公開介面嘅共同部分：CORS 預檢、方法檢查、存取碼檢查及 HEAD。
 * 已經完成回應就回傳 true；需要讀取資料就回傳 false。
 */
export function answerPublicRequestPreamble(
  request: ApiRequest,
  response: ApiResponse,
  route: string,
  startedAt: number,
) {
  setPublicApiHeaders(response);

  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    logPublicApiRequest(request, route, 204, startedAt);
    return true;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', PUBLIC_ALLOWED_METHODS);
    sendJson(response, 405, {
      ok: false,
      message: 'Method not allowed',
    });
    logPublicApiRequest(request, route, 405, startedAt);
    return true;
  }

  const configuredCode = getConfiguredPublicPortfolioCode();
  const requestCode = getPublicPortfolioQueryCode(request);

  if (!configuredCode || requestCode !== configuredCode) {
    sendJson(response, 401, {
      ok: false,
      message: 'Unauthorized',
    });
    logPublicApiRequest(request, route, 401, startedAt, {
      codeProvided: requestCode.length > 0,
      codeConfigured: configuredCode.length > 0,
    });
    return true;
  }

  // 部分網頁讀取工具會先用 HEAD 檢查網址；只回標頭，唔讀資料庫。
  if (request.method === 'HEAD') {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end();
    logPublicApiRequest(request, route, 200, startedAt);
    return true;
  }

  return false;
}
