import { timingSafeEqual } from 'node:crypto';
import { sendJson, type ApiRequest, type ApiResponse } from './apiShared.js';

const PUBLIC_PORTFOLIO_ROUTE = '/api/portfolio-public';

// 公開介面用獨立嘅唯讀憑證，唔可以用登入系統嘅主存取碼。
// 憑證外泄只會令人讀到持倉，唔可以登入，亦唔可以修改資料。
export const PUBLIC_READ_TOKEN_MIN_LENGTH = 32;

function getLoginAccessCodes() {
  return [
    process.env.PORTFOLIO_ACCESS_CODE?.trim() ?? '',
    process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() ?? '',
  ].filter((code) => code.length > 0);
}

/**
 * 回傳已設定嘅唯讀憑證；未設定、太短或者同登入碼相同就回傳空字串，
 * 即係公開介面一律拒絕（設定出錯時寧可讀唔到，都唔好誤開放）。
 */
export function getConfiguredPublicReadToken() {
  const token = process.env.PORTFOLIO_PUBLIC_READ_TOKEN?.trim() ?? '';

  if (token.length < PUBLIC_READ_TOKEN_MIN_LENGTH) {
    return '';
  }

  if (getLoginAccessCodes().includes(token)) {
    return '';
  }

  return token;
}

export function getPublicReadTokenFromRequest(request: ApiRequest) {
  try {
    return new URL(request.url ?? PUBLIC_PORTFOLIO_ROUTE, 'http://localhost').searchParams.get('token')?.trim() ?? '';
  } catch {
    return '';
  }
}

function hasLegacyCodeParam(request: ApiRequest) {
  try {
    return new URL(request.url ?? PUBLIC_PORTFOLIO_ROUTE, 'http://localhost').searchParams.has('code');
  } catch {
    return false;
  }
}

// 固定時間比較，避免由回應快慢推測憑證內容。
export function isValidPublicReadToken(provided: string, configured: string) {
  if (!provided || !configured) {
    return false;
  }

  const providedBuffer = Buffer.from(provided, 'utf8');
  const configuredBuffer = Buffer.from(configured, 'utf8');

  return providedBuffer.length === configuredBuffer.length &&
    timingSafeEqual(providedBuffer, configuredBuffer);
}

export const PUBLIC_ALLOWED_METHODS = 'GET, HEAD, OPTIONS';

export function setPublicApiHeaders(response: ApiResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', PUBLIC_ALLOWED_METHODS);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'no-store');
}

// 每個公開請求寫一行紀錄，方便追查外部工具（例如 ChatGPT）讀取失敗。
// 只記錄方法、狀態、耗時及 User-Agent；憑證、存取碼及完整網址一律唔寫入紀錄。
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
 * 處理公開介面嘅共同部分：CORS 預檢、方法檢查、唯讀憑證檢查及 HEAD。
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

  const configuredToken = getConfiguredPublicReadToken();
  const requestToken = getPublicReadTokenFromRequest(request);

  if (!isValidPublicReadToken(requestToken, configuredToken)) {
    sendJson(response, 401, {
      ok: false,
      message: 'Unauthorized',
    });
    logPublicApiRequest(request, route, 401, startedAt, {
      tokenProvided: requestToken.length > 0,
      tokenConfigured: configuredToken.length > 0,
      legacyCodeParam: hasLegacyCodeParam(request),
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
