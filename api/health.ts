import { sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import { buildHealthResponse } from '../src/lib/api/mockFunctionResponses.js';

function readMode(request: ApiRequest) {
  const requestUrl = request.url ?? '/api/health';

  try {
    return new URL(requestUrl, 'http://localhost').searchParams.get('mode')?.trim() ?? '';
  } catch {
    return '';
  }
}

type DiagnoseStepResult = {
  ok: boolean;
  durationMs: number;
  detail: string;
  data?: unknown;
};

type DiagnoseResponse = {
  ok: boolean;
  route: '/api/health';
  triggeredAt: string;
  durationMs: number;
  summary: {
    passedSteps: number;
    failedSteps: number;
  };
  steps: {
    environment: DiagnoseStepResult;
    firebaseAdmin: DiagnoseStepResult;
    firestoreRead: DiagnoseStepResult;
    assets: DiagnoseStepResult;
    yahooFinance: DiagnoseStepResult;
    coinGecko: DiagnoseStepResult;
    pendingReviews: DiagnoseStepResult;
  };
};

function getDurationMs(startedAt: number) {
  return Date.now() - startedAt;
}

async function runStep(
  runner: () => Promise<{ detail: string; data?: unknown }>,
): Promise<DiagnoseStepResult> {
  const startedAt = Date.now();

  try {
    const result = await runner();
    return {
      ok: true,
      durationMs: getDurationMs(startedAt),
      detail: result.detail,
      data: result.data,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: getDurationMs(startedAt),
      detail: error instanceof Error ? error.message : '診斷步驟失敗。',
      data: error instanceof Error ? { error: error.message } : { error: String(error) },
    };
  }
}

function readEnvStatus() {
  const firebaseAdminJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim() ?? '';
  const firebaseAdminProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ?? '';
  const firebaseAdminClientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() ?? '';
  const firebaseAdminPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim() ?? '';
  const cronSecret = process.env.CRON_SECRET?.trim() ?? '';
  const coingeckoApiKey = process.env.COINGECKO_API_KEY?.trim() ?? '';
  // P0-2: 明確記錄 CoinGecko plan 配置
  const coingeckoPlan = (process.env.COINGECKO_PLAN?.trim().toLowerCase() || 'demo') as 'demo' | 'pro';
  const portfolioAccessCode =
    process.env.PORTFOLIO_ACCESS_CODE?.trim() ||
    process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() ||
    '';

  const firebaseAdminConfigured =
    Boolean(firebaseAdminJson) ||
    (Boolean(firebaseAdminProjectId) &&
      Boolean(firebaseAdminClientEmail) &&
      Boolean(firebaseAdminPrivateKey));

  // CoinGecko 配置校驗：pro plan 必須有 API key
  const coingeckoMisconfigured = coingeckoPlan === 'pro' && !coingeckoApiKey;

  const missing: string[] = [];

  if (!firebaseAdminConfigured) {
    missing.push(
      'FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON / FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY',
    );
  }

  if (!cronSecret) {
    missing.push('CRON_SECRET');
  }

  if (!coingeckoApiKey) {
    missing.push('COINGECKO_API_KEY');
  }

  if (coingeckoMisconfigured) {
    missing.push('COINGECKO_API_KEY（COINGECKO_PLAN=pro 必須設定）');
  }

  if (!portfolioAccessCode) {
    missing.push('PORTFOLIO_ACCESS_CODE / VITE_PORTFOLIO_ACCESS_CODE');
  }

  return {
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? '所有必需環境變數已設定。'
        : `缺少環境變數：${missing.join('、')}`,
    data: {
      firebaseAdminConfigured,
      cronSecretConfigured: Boolean(cronSecret),
      coingeckoApiKeyConfigured: Boolean(coingeckoApiKey),
      coingeckoPlan,
      coingeckoMisconfigured,
      portfolioAccessCodeConfigured: Boolean(portfolioAccessCode),
      missing,
    },
  };
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

async function runDiagnostics(): Promise<DiagnoseResponse> {
  const startedAt = Date.now();
  const [firebaseAdminModule, portfolioSnapshotModule, yahooFinanceModule] = await Promise.all([
    import('../server/firebaseAdmin.js'),
    import('../server/portfolioSnapshotAdmin.js'),
    import('yahoo-finance2'),
  ]);

  const { getFirebaseAdminApp, getFirebaseAdminDb } = firebaseAdminModule;
  const { readAdminPortfolioAssets } = portfolioSnapshotModule;
  const YahooFinance = yahooFinanceModule.default;
  const yahooFinanceClient = new YahooFinance();

  const environment: DiagnoseStepResult = {
    ok: false,
    durationMs: 0,
    detail: '',
  };

  const envStartedAt = Date.now();
  const envStatus = readEnvStatus();
  environment.ok = envStatus.ok;
  environment.durationMs = getDurationMs(envStartedAt);
  environment.detail = envStatus.detail;
  environment.data = envStatus.data;

  const firebaseAdmin = await runStep(async () => {
    getFirebaseAdminApp();

    return {
      detail: 'Firebase Admin SDK 初始化成功。',
      data: {
        appName: 'firebase-admin',
      },
    };
  });

  const firestoreRead = await runStep(async () => {
    const db = getFirebaseAdminDb();
    const snapshot = await db.collection('portfolio').doc('app').get();

    if (!snapshot.exists) {
      throw new Error('portfolio/app 不存在。');
    }

    return {
      detail: 'portfolio/app 可讀取。',
      data: {
        exists: true,
      },
    };
  });

  const assets = await runStep(async () => {
    const holdings = await readAdminPortfolioAssets();
    const totalAssets = holdings.length;
    const cryptoAssets = holdings.filter((asset) => asset.assetType === 'crypto').length;
    const stockEtfAssets = holdings.filter(
      (asset) => asset.assetType === 'stock' || asset.assetType === 'etf',
    ).length;
    const cashAssets = holdings.filter((asset) => asset.assetType === 'cash').length;

    return {
      detail: `資產讀取成功，共 ${totalAssets} 項。`,
      data: {
        totalAssets,
        cryptoAssets,
        stockEtfAssets,
        cashAssets,
      },
    };
  });

  const yahooFinance = await runStep(async () => {
    const quotes = await yahooFinanceClient.quote(
      ['AAPL'],
      {
        fields: ['symbol', 'regularMarketPrice', 'currency', 'marketState'],
        return: 'array',
      },
      {
        fetchOptions: { signal: AbortSignal.timeout(10_000) },
      },
    );

    const quote = Array.isArray(quotes) ? quotes[0] : null;
    const price = quote && typeof quote.regularMarketPrice === 'number' ? quote.regularMarketPrice : null;

    if (!quote || price == null) {
      throw new Error('AAPL quote 沒有回傳有效價格。');
    }

    return {
      detail: 'Yahoo Finance 單一報價測試成功。',
      data: {
        symbol: quote.symbol ?? 'AAPL',
        regularMarketPrice: price,
        currency: quote.currency ?? null,
        marketState: quote.marketState ?? null,
      },
    };
  });

  // P0-2: CoinGecko 健康檢查使用正確 plan 配置
  const coinGecko = await runStep(async () => {
    const cgPlan = (process.env.COINGECKO_PLAN?.trim().toLowerCase() || 'demo') as 'demo' | 'pro';
    const cgApiKey = process.env.COINGECKO_API_KEY?.trim();

    if (cgPlan === 'pro' && !cgApiKey) {
      throw new Error('COINGECKO_PLAN=pro 但未設定 COINGECKO_API_KEY，無法連線 Pro API。');
    }

    const baseUrl = cgPlan === 'pro'
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    const headers: Record<string, string> = {};
    if (cgApiKey) {
      headers[cgPlan === 'pro' ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = cgApiKey;
    }

    const payload = await fetchJsonWithTimeout<Record<string, { usd?: number }>>(
      `${baseUrl}/simple/price?ids=bitcoin&vs_currencies=usd`,
      10_000,
      headers,
    );
    const price = payload.bitcoin?.usd ?? null;

    if (price == null) {
      throw new Error('CoinGecko bitcoin simple price 沒有回傳有效價格。');
    }

    return {
      detail: `CoinGecko 單一價格測試成功（plan=${cgPlan}）。`,
      data: {
        coinId: 'bitcoin',
        usd: price,
        plan: cgPlan,
      },
    };
  });

  const pendingReviews = await runStep(async () => {
    const db = getFirebaseAdminDb();
    const snapshot = await db
      .collection('portfolio')
      .doc('app')
      .collection('priceUpdateReviews')
      .where('status', '==', 'pending')
      .get();

    return {
      detail: `目前有 ${snapshot.size} 項待人工檢查。`,
      data: {
        pendingReviewCount: snapshot.size,
      },
    };
  });

  const steps = {
    environment,
    firebaseAdmin,
    firestoreRead,
    assets,
    yahooFinance,
    coinGecko,
    pendingReviews,
  };

  const passedSteps = Object.values(steps).filter((step) => step.ok).length;
  const failedSteps = Object.values(steps).length - passedSteps;

  return {
    ok: failedSteps === 0,
    route: '/api/health',
    triggeredAt: new Date().toISOString(),
    durationMs: getDurationMs(startedAt),
    summary: {
      passedSteps,
      failedSteps,
    },
    steps,
  };
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      route: '/api/health',
      message: 'Method not allowed',
    });
    return;
  }

  const mode = readMode(request);

  if (mode === 'diagnose') {
    try {
      const result = await runDiagnostics();
      sendJson(response, 200, {
        ...result,
        route: '/api/health',
        mode: 'diagnose',
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        route: '/api/health',
        mode: 'diagnose',
        message: error instanceof Error ? error.message : '診斷失敗，請稍後再試。',
      });
    }
    return;
  }

  sendJson(response, 200, buildHealthResponse());
}
