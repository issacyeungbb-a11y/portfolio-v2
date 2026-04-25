import {
  formatCurrency,
  getHoldingValueInCurrency,
  getPortfolioTotalValue,
} from '../../data/mockPortfolio';
import type { Holding, Insight } from '../../types/portfolio';

interface DashboardStatusItem {
  id: string;
  title: string;
  summary: string;
}

function getDominantHolding(holdings: Holding[]) {
  return [...holdings].sort(
    (left, right) => getHoldingValueInCurrency(right, 'HKD') - getHoldingValueInCurrency(left, 'HKD'),
  )[0];
}

function buildConcentrationInsight(holdings: Holding[]): Insight | null {
  const dominantHolding = getDominantHolding(holdings);

  if (!dominantHolding) {
    return null;
  }

  if (dominantHolding.allocation >= 35) {
    return {
      id: 'insight-concentration',
      title: `${dominantHolding.symbol} 佔比偏高`,
      summary: `${dominantHolding.symbol} 目前約佔組合 ${Math.round(dominantHolding.allocation)}%。如果你想降低單一標的波動，下一步應優先補其他資產類型，而唔係再加同一方向部位。`,
      tone: 'caution',
    };
  }

  return {
    id: 'insight-concentration',
    title: '單一持倉集中度尚可',
    summary: `目前最大持倉 ${dominantHolding.symbol} 約佔組合 ${Math.round(dominantHolding.allocation)}%，未見過度集中到需要即時處理，可以先把重點放喺價格歷史與定期更新。`,
    tone: 'positive',
  };
}

function buildCurrencyInsight(holdings: Holding[]): Insight | null {
  if (holdings.length === 0) {
    return null;
  }

  const totalValueHKD = getPortfolioTotalValue(holdings, 'HKD');
  if (totalValueHKD === 0) {
    return null;
  }

  const currencyBuckets = holdings.reduce<Record<string, number>>((buckets, holding) => {
    const nextValue = getHoldingValueInCurrency(holding, 'HKD');
    buckets[holding.currency] = (buckets[holding.currency] ?? 0) + nextValue;
    return buckets;
  }, {});

  const [dominantCurrency, dominantValue] =
    Object.entries(currencyBuckets).sort((left, right) => right[1] - left[1])[0] ?? [];

  if (!dominantCurrency || dominantValue === undefined) {
    return null;
  }

  const percentage = (dominantValue / totalValueHKD) * 100;

  if (percentage >= 65) {
    return {
      id: 'insight-currency',
      title: `${dominantCurrency} 幣別曝險較重`,
      summary: `${dominantCurrency} 資產約佔組合 ${Math.round(percentage)}%。如果你的日常支出主要唔係呢個幣別，可以考慮慢慢補回本地現金或對應 ETF，減少匯率對總覽數字嘅影響。`,
      tone: 'caution',
    };
  }

  return {
    id: 'insight-currency',
    title: '幣別分佈算係平均',
    summary: `目前最大幣別為 ${dominantCurrency}，約佔組合 ${Math.round(percentage)}%。整體未見單一幣別過重，之後可優先改善價格更新頻率，令分析結果更可信。`,
    tone: 'neutral',
  };
}

function buildCashInsight(holdings: Holding[]): Insight | null {
  const cashHoldings = holdings.filter((holding) => holding.assetType === 'cash');

  if (cashHoldings.length === 0) {
    return {
      id: 'insight-cash',
      title: '未見現金緩衝',
      summary: '目前組合未見現金類資產。如果你之後想保留加倉彈性或降低波動，可以考慮預留一部分現金或貨幣基金作緩衝。',
      tone: 'caution',
    };
  }

  const totalValueHKD = getPortfolioTotalValue(holdings, 'HKD');
  const cashValueHKD = getPortfolioTotalValue(cashHoldings, 'HKD');
  const cashPercentage = totalValueHKD === 0 ? 0 : (cashValueHKD / totalValueHKD) * 100;

  if (cashPercentage >= 8) {
    return {
      id: 'insight-cash',
      title: '有保留現金緩衝',
      summary: `現金部位約佔 ${Math.round(cashPercentage)}%，短期內有一定調整空間。之後即使補 ETF 或再平衡，操作上都會靈活啲。`,
      tone: 'positive',
    };
  }

  return {
    id: 'insight-cash',
    title: '現金比例偏薄',
    summary: `現金部位約佔 ${Math.round(cashPercentage)}%。如果你打算繼續加入新標的，之後可以考慮先補多少少現金緩衝，避免每次調整都要賣出現有持倉。`,
    tone: 'neutral',
  };
}

export function buildDashboardInsights(holdings: Holding[]) {
  if (holdings.length === 0) {
    return [];
  }

  return [
    buildConcentrationInsight(holdings),
    buildCurrencyInsight(holdings),
    buildCashInsight(holdings),
  ].filter((insight): insight is Insight => Boolean(insight));
}

export function buildDashboardStatusItems(params: {
  holdings: Holding[];
  assetsStatus: 'idle' | 'loading' | 'ready' | 'error';
  hasAnalysisCache: boolean;
  pendingPriceReviewCount: number;
}) {
  const { holdings, assetsStatus, hasAnalysisCache, pendingPriceReviewCount } = params;
  const totalValueHKD = getPortfolioTotalValue(holdings, 'HKD');

  const syncSummary =
    assetsStatus === 'loading'
      ? '正在同步共享 Firestore 資產資料。'
      : assetsStatus === 'error'
        ? '資產同步暫時失敗，需要先檢查 Firebase 設定或 rules。'
        : `已同步 ${holdings.length} 項資產，總值約 ${formatCurrency(totalValueHKD, 'HKD')}。`;

  const reviewSummary =
    pendingPriceReviewCount > 0
      ? `目前有 ${pendingPriceReviewCount} 項價格更新待確認，確認後總覽與分析結果會更準。`
      : '目前未有待確認價格更新，資產價格狀態算係穩定。';

  const analysisSummary = hasAnalysisCache
    ? '目前資產快照已有已快取分析，可直接重用上次結果。'
    : '目前未有已快取分析，下一次分析會以最新持倉重新建立結果。';

  return [
    {
      id: 'status-sync',
      title: '共享持倉同步',
      summary: syncSummary,
    },
    {
      id: 'status-reviews',
      title: '價格更新審核',
      summary: reviewSummary,
    },
    {
      id: 'status-analysis',
      title: 'AI 分析快取',
      summary: analysisSummary,
    },
  ] satisfies DashboardStatusItem[];
}
