import { getFirebaseIdToken } from '../firebase/auth';

export type PortfolioFunctionKey =
  | 'health'
  | 'extract-assets'
  | 'update-prices'
  | 'analyze';

export const portfolioFunctionConfig: Record<
  PortfolioFunctionKey,
  { path: string; method: 'GET' | 'POST' }
> = {
  health: { path: '/api/health', method: 'GET' },
  'extract-assets': { path: '/api/extract-assets', method: 'POST' },
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
  const headers: Record<string, string> = {};

  if (config.method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }

  if (key !== 'health') {
    const idToken = await getFirebaseIdToken();
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(config.path, {
    method: config.method,
    headers,
    body: config.method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
  });

  const rawText = await response.text();
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

    throw new Error(message);
  }

  return data;
}
