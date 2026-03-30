import type { IncomingMessage } from 'node:http';

class PortfolioAccessError extends Error {
  status: number;
  route: string;

  constructor(message: string, route: string, status = 401) {
    super(message);
    this.name = 'PortfolioAccessError';
    this.status = status;
    this.route = route;
  }
}

function getConfiguredPortfolioAccessCode() {
  return (
    process.env.PORTFOLIO_ACCESS_CODE?.trim() ||
    process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() ||
    ''
  );
}

function getNodeAccessCodeHeader(request: IncomingMessage) {
  const header = request.headers['x-portfolio-access-code'];

  if (Array.isArray(header)) {
    return header[0] ?? '';
  }

  return typeof header === 'string' ? header : '';
}

export function isPortfolioAccessError(error: unknown): error is PortfolioAccessError {
  return error instanceof PortfolioAccessError;
}

export async function requirePortfolioAccess(request: IncomingMessage, route: string) {
  const configuredCode = getConfiguredPortfolioAccessCode();

  if (!configuredCode) {
    throw new PortfolioAccessError(
      '尚未設定共享存取碼，請先設定 PORTFOLIO_ACCESS_CODE 或 VITE_PORTFOLIO_ACCESS_CODE。',
      route,
      500,
    );
  }

  const requestCode = getNodeAccessCodeHeader(request).trim();

  if (!requestCode) {
    throw new PortfolioAccessError('缺少共享存取碼，請重新輸入後再試。', route, 401);
  }

  if (requestCode !== configuredCode) {
    throw new PortfolioAccessError('共享存取碼不正確，請重新輸入後再試。', route, 401);
  }
}

export function getPortfolioAccessErrorResponse(error: unknown, route: string) {
  if (error instanceof PortfolioAccessError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route,
      message: '共享存取碼驗證失敗，請稍後再試。',
    },
  };
}
