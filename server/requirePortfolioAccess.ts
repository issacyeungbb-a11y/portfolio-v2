import type { IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getFirebaseAdminDb } from './firebaseAdmin.js';

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

  const candidateHash = createHash('sha256').update(requestCode).digest();
  const valid = [configuredCode, process.env.PORTFOLIO_NEXT_ACCESS_CODE?.trim()].filter(Boolean).some((code) =>
    timingSafeEqual(candidateHash, createHash('sha256').update(code!).digest()),
  );
  if (!valid) {
    throw new PortfolioAccessError('共享存取碼不正確，請重新輸入後再試。', route, 401);
  }
  const security = (await getFirebaseAdminDb().doc('portfolioSecurity/access').get()).data();
  if (security?.revokedCodeHashes?.includes(candidateHash.toString('hex'))) {
    throw new PortfolioAccessError('登入碼已更新，請使用新登入碼。', route, 401);
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
