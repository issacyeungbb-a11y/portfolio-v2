import type {
  AllocationBucketKey,
  AllocationSlice,
  AnalysisSession,
  Holding,
  ImportJob,
  Insight,
  PerformanceRange,
  PortfolioPerformancePoint,
  PortfolioPerformanceSummary,
  PortfolioSnapshot,
} from '../types/portfolio';
export {
  convertCurrency,
  normalizeCurrencyCode,
  formatCurrency,
  formatCurrencyRounded,
  formatPercent,
} from '../lib/currency';
export {
  getHoldingValueInCurrency,
  getHoldingCostInCurrency,
  getPortfolioTotalValue,
  getPortfolioTotalCost,
  buildAllocationSlices,
  getAssetTypeLabel,
  getAccountSourceLabel,
  getCashFlowSignedAmount,
} from '../lib/holdings';
import {
  convertCurrency,
  formatCurrency,
  formatCurrencyRounded,
  formatPercent,
} from '../lib/currency';
import {
  buildAllocationSlices,
  getAccountSourceLabel,
  getAssetTypeLabel,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
  getPortfolioTotalCost,
  getPortfolioTotalValue,
  getCashFlowSignedAmount,
} from '../lib/holdings';

const FX_TO_HKD: Record<string, number> = {
  HKD: 1,
  USD: 7.8,
  JPY: 0.052,
};

const CURRENCY_ALIASES: Record<string, string> = {
  HK$: 'HKD',
  HKD: 'HKD',
  USD: 'USD',
  US$: 'USD',
  JPY: 'JPY',
  JPY100: 'JPY',
  YEN: 'JPY',
  YENS: 'JPY',
  '¥': 'JPY',
  '￥': 'JPY',
  '円': 'JPY',
  '日圓': 'JPY',
  '日元': 'JPY',
  '日幣': 'JPY',
};

const holdings: Holding[] = [
  {
    id: '700-hk',
    name: 'Tencent Holdings',
    symbol: '0700.HK',
    assetType: 'stock',
    accountSource: 'Futu',
    currency: 'HKD',
    quantity: 42,
    averageCost: 302.4,
    currentPrice: 328.2,
    marketValue: 13784.4,
    unrealizedPnl: 1083.6,
    unrealizedPct: 8.53,
    allocation: 23.43,
  },
  {
    id: '2800-hk',
    name: 'Tracker Fund of Hong Kong',
    symbol: '2800.HK',
    assetType: 'etf',
    accountSource: 'Futu',
    currency: 'HKD',
    quantity: 180,
    averageCost: 18.92,
    currentPrice: 20.66,
    marketValue: 3718.8,
    unrealizedPnl: 313.2,
    unrealizedPct: 9.19,
    allocation: 6.32,
  },
  {
    id: 'aapl-us',
    name: 'Apple',
    symbol: 'AAPL',
    assetType: 'stock',
    accountSource: 'IB',
    currency: 'USD',
    quantity: 14,
    averageCost: 184.9,
    currentPrice: 198.4,
    marketValue: 2777.6,
    unrealizedPnl: 189,
    unrealizedPct: 7.3,
    allocation: 36.82,
  },
  {
    id: 'btc',
    name: 'Bitcoin',
    symbol: 'BTC',
    assetType: 'crypto',
    accountSource: 'Crypto',
    currency: 'USD',
    quantity: 0.03,
    averageCost: 56120,
    currentPrice: 63880,
    marketValue: 1916.4,
    unrealizedPnl: 232.8,
    unrealizedPct: 13.83,
    allocation: 25.41,
  },
  {
    id: 'cash-hkd',
    name: 'Cash Reserve',
    symbol: 'CASH',
    assetType: 'cash',
    accountSource: 'Other',
    currency: 'HKD',
    quantity: 1,
    averageCost: 4720,
    currentPrice: 4720,
    marketValue: 4720,
    unrealizedPnl: 0,
    unrealizedPct: 0,
    allocation: 8.02,
  },
];

const performanceHistory: PortfolioPerformancePoint[] = [
  { date: '2025-03-23', totalValue: 46880, netExternalFlow: 0 },
  { date: '2025-05-12', totalValue: 48240, netExternalFlow: 1200 },
  { date: '2025-08-19', totalValue: 50010, netExternalFlow: 0 },
  { date: '2025-09-23', totalValue: 51220, netExternalFlow: 0 },
  { date: '2025-11-05', totalValue: 52600, netExternalFlow: -800 },
  { date: '2025-12-22', totalValue: 54180, netExternalFlow: 1500 },
  { date: '2026-01-30', totalValue: 55320, netExternalFlow: 0 },
  { date: '2026-02-21', totalValue: 54760, netExternalFlow: 0 },
  { date: '2026-03-10', totalValue: 56620, netExternalFlow: 800 },
  { date: '2026-03-16', totalValue: 57190, netExternalFlow: 0 },
  { date: '2026-03-23', totalValue: 58836.4, netExternalFlow: 0 },
];

const insights: Insight[] = [
  {
    id: 'insight-1',
    title: '美元資產權重偏高',
    summary: '目前美元計價部位仍然偏高，若你的日常支出以港幣為主，之後可以考慮補一些港幣現金或本地 ETF。',
    tone: 'caution',
  },
  {
    id: 'insight-2',
    title: '核心與衛星配置已成形',
    summary: '大型科技股 + 指數 ETF + 現金緩衝的結構很清楚，之後加標的時要小心不要把策略越弄越分散。',
    tone: 'positive',
  },
  {
    id: 'insight-3',
    title: '價格更新流程會影響總覽可信度',
    summary: '如果未來加入每日更新，組合變動與資產分佈會更準確，也更適合做 AI 分析。',
    tone: 'neutral',
  },
];

const importJobs: ImportJob[] = [
  {
    id: 'import-1',
    fileName: 'futu-statement-2026-03-21.png',
    broker: 'Futu',
    status: 'completed',
    detectedCount: 4,
    updatedAt: '今天 09:10',
  },
  {
    id: 'import-2',
    fileName: 'ibkr-portfolio-2026-03-20.jpeg',
    broker: 'IBKR',
    status: 'review',
    detectedCount: 3,
    updatedAt: '昨天 22:40',
  },
  {
    id: 'import-3',
    fileName: 'crypto-wallet-2026-03-18.png',
    broker: 'Crypto Wallet',
    status: 'processing',
    detectedCount: 0,
    updatedAt: '3 天前',
  },
];

const analysisSessions: AnalysisSession[] = [
  {
    id: 'analysis-1',
    category: 'asset_analysis',
    title: '風險集中度檢查',
    question: '如果科技股回調 12%，整個投資組合大概會受多少影響？',
    result: '目前單一風格仍以科技為主，若要降低波動，最有效的是提高 ETF 與現金比重，而不是再加更多同類型成長股。',
    model: 'gemini-2.5-pro',
    provider: 'google',
    updatedAt: '今天 08:45',
  },
  {
    id: 'analysis-2',
    category: 'asset_report',
    title: '加倉優先順序',
    question: '下次有 10,000 HKD 可投資時，應先補 ETF 還是現有科技股？',
    result: '從配置角度看，先補 ETF 會更平衡，也能保留你對個股的既有信念部位。',
    model: 'gemini-2.5-pro',
    provider: 'google',
    updatedAt: '昨天 21:15',
  },
];

const performanceRangeLabels: Record<PerformanceRange, string> = {
  '7d': '7日',
  '30d': '30日',
  '6m': '半年',
  '1y': '1年',
};

function parseISODate(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(date: Date, range: PerformanceRange) {
  const shifted = new Date(date);

  if (range === '7d') {
    shifted.setUTCDate(shifted.getUTCDate() - 7);
    return shifted;
  }

  if (range === '30d') {
    shifted.setUTCDate(shifted.getUTCDate() - 30);
    return shifted;
  }

  if (range === '6m') {
    shifted.setUTCMonth(shifted.getUTCMonth() - 6);
    return shifted;
  }

  shifted.setUTCFullYear(shifted.getUTCFullYear() - 1);
  return shifted;
}

export function formatDateLabel(dateString: string) {
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parseISODate(dateString));
}

const derivedTotalValueHKD = getPortfolioTotalValue(holdings, 'HKD');
const derivedTotalCostHKD = getPortfolioTotalCost(holdings, 'HKD');

export const mockPortfolio: PortfolioSnapshot = {
  owner: 'Anonymous Investor',
  baseCurrency: 'HKD',
  totalValue: derivedTotalValueHKD,
  totalCost: derivedTotalCostHKD,
  lastUpdatedAt: '2026-03-23 10:05',
  holdings,
  performanceHistory,
  allocations: buildAllocationSlices(holdings),
  insights,
  importJobs,
  analysisSessions,
  prompts: [
    '幫我找出目前最集中的風險來源',
    '如果我每月投入 5,000 HKD，如何分配比較穩健？',
    '哪些資產適合設成每日價格更新？',
  ],
};

export function getImportStatusLabel(status: ImportJob['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'review') return '待確認';
  return '處理中';
}

export function getInsightToneLabel(tone: Insight['tone']) {
  if (tone === 'positive') return '亮點';
  if (tone === 'caution') return '注意';
  return '觀察';
}

export function getHoldingValueLabel(holding: Holding) {
  const alternateCurrency = holding.currency === 'HKD' ? 'USD' : 'HKD';
  const alternateValue = getHoldingValueInCurrency(holding, alternateCurrency);

  return `${formatCurrency(holding.marketValue, holding.currency)} / 約 ${formatCurrency(
    alternateValue,
    alternateCurrency,
  )}`;
}

export function getPerformanceRangeLabel(range: PerformanceRange) {
  return performanceRangeLabels[range];
}

export function calculatePortfolioPerformance(
  history: PortfolioPerformancePoint[],
  range: PerformanceRange,
): PortfolioPerformanceSummary {
  const sortedHistory = [...history].sort((left, right) => left.date.localeCompare(right.date));
  const endPoint = sortedHistory[sortedHistory.length - 1];
  const endDate = parseISODate(endPoint.date);
  const targetDate = shiftDate(endDate, range);

  let startPoint = sortedHistory[0];

  for (const point of sortedHistory) {
    if (parseISODate(point.date) <= targetDate) {
      startPoint = point;
    }
  }

  const startDate = parseISODate(startPoint.date);
  const periodMs = Math.max(endDate.getTime() - startDate.getTime(), 24 * 60 * 60 * 1000);

  const pointsWithinRange = sortedHistory.filter((point) => {
    const currentDate = parseISODate(point.date);
    return currentDate > startDate && currentDate <= endDate;
  });

  const netExternalFlow = pointsWithinRange.reduce(
    (sum, point) => sum + point.netExternalFlow,
    0,
  );

  const weightedCapital = pointsWithinRange.reduce((sum, point) => {
    const remainingMs = endDate.getTime() - parseISODate(point.date).getTime();
    const weight = Math.min(Math.max(remainingMs / periodMs, 0), 1);
    return sum + point.netExternalFlow * weight;
  }, startPoint.totalValue);

  const changeAmount = endPoint.totalValue - startPoint.totalValue - netExternalFlow;
  const returnPct = weightedCapital === 0 ? 0 : (changeAmount / weightedCapital) * 100;

  return {
    range,
    label: performanceRangeLabels[range],
    startDate: formatDateKey(startDate),
    endDate: endPoint.date,
    startValue: startPoint.totalValue,
    endValue: endPoint.totalValue,
    netExternalFlow,
    changeAmount,
    returnPct,
  };
}
