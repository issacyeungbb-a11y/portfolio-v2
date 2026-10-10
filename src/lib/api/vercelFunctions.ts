import { getCurrentPortfolioAccessCode } from '../access/accessCode';

export type PortfolioFunctionKey =
  | 'health'
  | 'crypto-history'
  | 'crypto-history-sync'
  | 'crypto-management'
  | 'extract-assets'
  | 'extract-transactions'
  | 'manual-monthly-analysis'
  | 'monthly-analysis-status'
  | 'quarterly-analysis-status'
  | 'manual-quarterly-report'
  | 'manual-capture-snapshot'
  | 'parse-assets-command'
  | 'parse-transactions-command'
  | 'update-prices'
  | 'analyze';

export const portfolioFunctionConfig: Record<
  PortfolioFunctionKey,
  { path: string; method: 'GET' | 'POST' }
> = {
  health: { path: '/api/health', method: 'GET' },
  'crypto-history': { path: '/api/health?mode=crypto-history', method: 'GET' },
  'crypto-history-sync': { path: '/api/health?mode=crypto-sync', method: 'POST' },
  'crypto-management': { path: '/api/health?mode=crypto-management', method: 'POST' },
  'extract-assets': { path: '/api/extract-assets', method: 'POST' },
  'extract-transactions': { path: '/api/extract-transactions', method: 'POST' },
  'manual-monthly-analysis': { path: '/api/cron-monthly-analysis', method: 'POST' },
  'monthly-analysis-status': { path: '/api/cron-monthly-analysis', method: 'GET' },
  'quarterly-analysis-status': { path: '/api/manual-quarterly-report', method: 'GET' },
  'manual-quarterly-report': { path: '/api/manual-quarterly-report', method: 'POST' },
  'manual-capture-snapshot': { path: '/api/manual-capture-snapshot', method: 'POST' },
  'parse-assets-command': { path: '/api/parse-assets-command', method: 'POST' },
  'parse-transactions-command': { path: '/api/parse-transactions-command', method: 'POST' },
  'update-prices': { path: '/api/update-prices', method: 'POST' },
  analyze: { path: '/api/analyze', method: 'POST' },
};

function normalizeTextError(status: number, text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return `Request failed with status ${status}`;
  }

  if (
    trimmed.includes('Request Entity Too Large') ||
    trimmed.includes('FUNCTION_PAYLOAD_TOO_LARGE')
  ) {
    return '上傳圖片太大，請先裁剪或壓縮截圖後再試。';
  }

  if (trimmed.includes('A server error has occurred')) {
    return '伺服器暫時出錯，請稍後再試。';
  }

  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
}

export async function callPortfolioFunction(
  key: PortfolioFunctionKey,
  payload?: unknown,
): Promise<unknown> {
  const config = portfolioFunctionConfig[key];
  const statusJobId = (key === 'monthly-analysis-status' || key === 'quarterly-analysis-status') && typeof payload === 'object' && payload !== null
    ? (payload as { jobId?: string }).jobId : undefined;
  const path = statusJobId ? `${config.path}?jobId=${encodeURIComponent(statusJobId)}` : config.path;
  const requestId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const headers: Record<string, string> = {};

  if (config.method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }

  if (key !== 'health') {
    const accessCode = getCurrentPortfolioAccessCode();

    if (!accessCode) {
      throw new Error('尚未設定共享存取碼，請先設定 VITE_PORTFOLIO_ACCESS_CODE。');
    }

    headers['x-portfolio-access-code'] = accessCode;
  }
  headers['x-client-request-id'] = requestId;

  let response: Response;
  let rawText: string;
  try {
    response = await fetch(path, {
      method: config.method,
      signal: (key.includes('analysis-status') || key === 'manual-monthly-analysis' || key === 'manual-quarterly-report')
        ? AbortSignal.timeout(20_000) : undefined,
      headers,
      body: config.method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
    });
    rawText = await response.text();
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'NetworkError';
    const errorMessage = error instanceof Error ? error.message : 'unknown network error';
    throw new PortfolioFunctionNetworkError(
      `無法連線到 ${config.path}（${errorName}: ${errorMessage}）。可能是 Vercel function 超時、瀏覽器網絡被中斷，或部署仍在切換。Request ID: ${requestId}`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';

  let data: unknown = null;

  if (rawText) {
    if (contentType.includes('application/json')) {
      try {
        data = JSON.parse(rawText) as unknown;
      } catch {
        throw new Error('伺服器回傳了無法解析的 JSON，請稍後再試。');
      }
    } else if (rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
      try {
        data = JSON.parse(rawText) as unknown;
      } catch {
        data = rawText;
      }
    } else {
      data = rawText;
    }
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : typeof data === 'string'
          ? normalizeTextError(response.status, data)
          : `Request failed with status ${response.status}`;

    throw new PortfolioFunctionHttpError(`${message}（${config.method} ${config.path}，HTTP ${response.status}，Request ID: ${requestId}）`, response.status);
  }

  return data;
}

export class PortfolioFunctionNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortfolioFunctionNetworkError';
  }
}

export class PortfolioFunctionHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'PortfolioFunctionHttpError';
  }
}

export function isRetryablePortfolioFunctionError(error: unknown) {
  return error instanceof PortfolioFunctionNetworkError ||
    (error instanceof PortfolioFunctionHttpError && (error.status >= 500 || error.status === 429));
}

export async function triggerManualSnapshot() {
  return callPortfolioFunction('manual-capture-snapshot');
}
