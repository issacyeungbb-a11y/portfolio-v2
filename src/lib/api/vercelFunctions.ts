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

  const data = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return data;
}
