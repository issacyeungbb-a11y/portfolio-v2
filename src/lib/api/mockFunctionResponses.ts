export function buildHealthResponse() {
  return {
    ok: true,
    route: '/api/health',
    mode: 'mock',
    service: 'portfolio-v2-functions',
    version: 'stage-4-skeleton',
    timestamp: '2026-03-23T18:45:00+08:00',
  };
}

export function buildExtractAssetsResponse() {
  return {
    ok: true,
    route: '/api/extract-assets',
    mode: 'mock',
    provider: 'disabled',
    jobId: 'mock-extract-001',
    status: 'parsed',
    candidates: [
      {
        name: 'Tencent Holdings',
        symbol: '0700.HK',
        assetType: 'stock',
        quantity: 42,
        averageCost: 302.4,
        currency: 'HKD',
        confidence: 0.96,
      },
      {
        name: 'Apple',
        symbol: 'AAPL',
        assetType: 'stock',
        quantity: 14,
        averageCost: 184.9,
        currency: 'USD',
        confidence: 0.94,
      },
      {
        name: 'Bitcoin',
        symbol: 'BTC',
        assetType: 'crypto',
        quantity: 0.03,
        averageCost: 56120,
        currency: 'USD',
        confidence: 0.91,
      },
    ],
  };
}

export function buildUpdatePricesResponse() {
  return {
    ok: true,
    route: '/api/update-prices',
    mode: 'mock',
    provider: 'disabled',
    updatedAt: '2026-03-23T18:46:00+08:00',
    prices: [
      { symbol: '0700.HK', currency: 'HKD', price: 329.4, source: 'mock-cheap-model' },
      { symbol: 'AAPL', currency: 'USD', price: 199.1, source: 'mock-cheap-model' },
      { symbol: 'BTC', currency: 'USD', price: 64250, source: 'mock-cheap-model' },
    ],
  };
}

export function buildAnalyzeResponse() {
  return {
    ok: true,
    route: '/api/analyze',
    mode: 'mock',
    provider: 'disabled',
    analysisId: 'mock-analysis-001',
    modelTier: 'strong-model-placeholder',
    summary:
      '目前組合以股票為主，ETF 與現金仍可作為平衡波動的主要工具。這份結果暫時是固定假資料，用來確認前後端串接流程。',
    highlights: [
      '股票部位仍是最大權重來源。',
      '若想降低波動，先補 ETF 或現金會比加倉高 beta 資產更穩健。',
      '正式版接入 Gemini 後，可把這裡換成真實分析結果。',
    ],
  };
}
