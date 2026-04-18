import {
  convertCurrency,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
} from '../../data/mockPortfolio';
import {
  getRecentAssetTransactions,
} from '../firebase/assetTransactions';
import {
  getRecentAssetPriceHistory,
} from '../firebase/priceHistory';
import {
  getRecentPortfolioSnapshots,
} from '../firebase/portfolioSnapshots';
import type { Holding } from '../../types/portfolio';
import type {
  PortfolioAnalysisPriceHistoryGroup,
  PortfolioAnalysisRecentSnapshot,
  PortfolioAnalysisRecentTransactionGroup,
  PortfolioAnalysisRequest,
  PortfolioAnalysisRequestAsset,
} from '../../types/portfolioAnalysis';

function normalizeHoldingForSignature(holding: Holding) {
  return {
    id: holding.id,
    name: holding.name,
    symbol: holding.symbol,
    assetType: holding.assetType,
    accountSource: holding.accountSource,
    currency: holding.currency,
    quantity: Number(holding.quantity.toFixed(8)),
    averageCost: Number(holding.averageCost.toFixed(8)),
    currentPrice: Number(holding.currentPrice.toFixed(8)),
  };
}

export function createPortfolioSnapshotSignature(holdings: Holding[]) {
  const normalized = [...holdings]
    .map(normalizeHoldingForSignature)
    .sort((left, right) => left.id.localeCompare(right.id));

  return JSON.stringify(normalized);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createPortfolioSnapshotHash(signature: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(signature),
  );

  return bytesToHex(new Uint8Array(digest));
}

export async function createPortfolioAnalysisCacheKey(
  snapshotHash: string,
  category: string,
  analysisModel: string,
  analysisQuestion: string,
  analysisBackground: string,
) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify({
        snapshotHash,
        category,
        analysisModel,
        analysisQuestion: analysisQuestion.trim(),
        analysisBackground: analysisBackground.trim(),
      }),
    ),
  );

  return bytesToHex(new Uint8Array(digest));
}

function buildAnalysisRequestAsset(holding: Holding): PortfolioAnalysisRequestAsset {
  return {
    id: holding.id,
    name: holding.name,
    ticker: holding.symbol,
    assetType: holding.assetType,
    accountSource: holding.accountSource,
    currency: holding.currency,
    quantity: holding.quantity,
    averageCost: holding.averageCost,
    currentPrice: holding.currentPrice,
    marketValue: holding.marketValue,
    costValue: holding.quantity * holding.averageCost,
  };
}

function formatDailyClosePoint(entry: { date: string; price: number }) {
  return {
    date: entry.date,
    price: entry.price,
  };
}

function buildPriceHistoryGroup(
  holding: Holding,
  points: Array<{ date: string; price: number }>,
): PortfolioAnalysisPriceHistoryGroup {
  const sortedPoints = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const firstPoint = sortedPoints[0] ?? null;
  const lastPoint = sortedPoints[sortedPoints.length - 1] ?? null;
  const change30dPct =
    firstPoint && firstPoint.price > 0 && lastPoint
      ? ((lastPoint.price - firstPoint.price) / firstPoint.price) * 100
      : 0;

  return {
    assetId: holding.id,
    assetName: holding.name,
    ticker: holding.symbol,
    currency: holding.currency,
    currentPrice: holding.currentPrice,
    change30dPct,
    points: sortedPoints.map(formatDailyClosePoint),
  };
}

function buildRecentSnapshotPayload(snapshot: Awaited<ReturnType<typeof getRecentPortfolioSnapshots>>[number]) {
  const holdings = snapshot.holdings ?? [];

  return {
    date: snapshot.date,
    capturedAt: snapshot.capturedAt,
    totalValueHKD: snapshot.totalValue,
    netExternalFlowHKD: snapshot.netExternalFlow,
    assetCount: snapshot.assetCount ?? holdings.length,
    holdings: holdings
      .slice()
      .sort((left, right) => right.marketValueHKD - left.marketValueHKD)
      .slice(0, 10)
      .map((holding) => ({
        assetId: holding.assetId,
        ticker: holding.symbol,
        assetName: holding.name,
        currentPrice: holding.currentPrice,
        marketValueHKD: holding.marketValueHKD,
        quantity: holding.quantity,
      })),
  } satisfies PortfolioAnalysisRecentSnapshot;
}

export async function buildPortfolioAnalysisRequest(
  holdings: Holding[],
  snapshotHash: string,
  cacheKey: string,
  category: PortfolioAnalysisRequest['category'],
  analysisModel: PortfolioAnalysisRequest['analysisModel'],
  analysisQuestion: string,
  analysisBackground: string,
  conversationContext = '',
): Promise<PortfolioAnalysisRequest> {
  const requestAssets = [...holdings]
    .map(buildAnalysisRequestAsset)
    .sort((left, right) => left.id.localeCompare(right.id));

  const totalValueHKD = holdings.reduce(
    (sum, holding) => sum + getHoldingValueInCurrency(holding, 'HKD'),
    0,
  );
  const totalCostHKD = holdings.reduce(
    (sum, holding) => sum + getHoldingCostInCurrency(holding, 'HKD'),
    0,
  );

  const typeBuckets = new Map<
    Holding['assetType'],
    { totalValueHKD: number }
  >();
  const currencyBuckets = new Map<string, { totalValueHKD: number }>();

  for (const holding of holdings) {
    const valueHKD = getHoldingValueInCurrency(holding, 'HKD');

    const nextTypeBucket = typeBuckets.get(holding.assetType) ?? { totalValueHKD: 0 };
    nextTypeBucket.totalValueHKD += valueHKD;
    typeBuckets.set(holding.assetType, nextTypeBucket);

    const nextCurrencyBucket = currencyBuckets.get(holding.currency) ?? { totalValueHKD: 0 };
    nextCurrencyBucket.totalValueHKD += valueHKD;
    currencyBuckets.set(holding.currency, nextCurrencyBucket);
  }

  const baseRequest = {
    cacheKey,
    snapshotHash,
    category,
    analysisModel,
    analysisQuestion: analysisQuestion.trim(),
    analysisBackground: analysisBackground.trim(),
    conversationContext: conversationContext.trim(),
    assetCount: holdings.length,
    totalValueHKD,
    totalCostHKD,
    holdings: requestAssets,
    allocationsByType: [...typeBuckets.entries()]
      .map(([assetType, bucket]) => ({
        assetType,
        totalValueHKD: bucket.totalValueHKD,
        percentage: totalValueHKD === 0 ? 0 : (bucket.totalValueHKD / totalValueHKD) * 100,
      }))
      .sort((left, right) => right.totalValueHKD - left.totalValueHKD),
    allocationsByCurrency: [...currencyBuckets.entries()]
      .map(([currency, bucket]) => ({
        currency,
        totalValueHKD: bucket.totalValueHKD,
        percentage: totalValueHKD === 0 ? 0 : (bucket.totalValueHKD / totalValueHKD) * 100,
      }))
      .sort((left, right) => right.totalValueHKD - left.totalValueHKD),
  };

  if (category !== 'general_question' || holdings.length === 0) {
    return baseRequest;
  }

  try {
    const topHoldings = [...holdings]
      .sort((left, right) => right.marketValue - left.marketValue)
      .slice(0, 10);

    const [recentTransactions, recentSnapshots, priceHistoryGroups] = await Promise.all([
      getRecentAssetTransactions(30),
      getRecentPortfolioSnapshots(2),
      Promise.all(
        topHoldings.map(async (holding) => {
          const priceHistory = await getRecentAssetPriceHistory(holding.id, 30);
          return buildPriceHistoryGroup(
            holding,
            priceHistory.map((entry) => ({
              date: entry.asOf,
              price: entry.price,
            })),
          );
        }),
      ),
    ]);

    const groupedTransactions = recentTransactions.reduce<
      Record<string, PortfolioAnalysisRecentTransactionGroup>
    >((groups, transaction) => {
      const group =
        groups[transaction.assetId] ??
        ({
          assetId: transaction.assetId,
          assetName: transaction.assetName,
          ticker: transaction.symbol,
          transactions: [],
        } satisfies PortfolioAnalysisRecentTransactionGroup);

      group.transactions.push({
        date: transaction.date,
        type: transaction.transactionType,
        quantity: transaction.quantity,
        price: transaction.price,
      });
      groups[transaction.assetId] = group;
      return groups;
    }, {});

    return {
      ...baseRequest,
      recentTransactions: Object.values(groupedTransactions)
        .map((group) => ({
          ...group,
          transactions: group.transactions
            .filter((entry) => entry.date >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
            .sort((left, right) => left.date.localeCompare(right.date)),
        }))
        .filter((group) => group.transactions.length > 0)
        .sort((left, right) => left.ticker.localeCompare(right.ticker)),
      priceHistory: priceHistoryGroups
        .filter((group) => group.points.length > 0)
        .sort((left, right) => right.change30dPct - left.change30dPct),
      recentSnapshots: recentSnapshots
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date))
        .map(buildRecentSnapshotPayload),
    };
  } catch {
    return baseRequest;
  }
}

export function getPortfolioAnalysisCurrencyLabel(currency: string) {
  if (currency === 'HKD') {
    return '港幣';
  }

  if (currency === 'USD') {
    return '美元';
  }

  return currency;
}

export function convertHoldingMarketValue(holding: Holding, targetCurrency: 'HKD' | 'USD') {
  return convertCurrency(holding.marketValue, holding.currency, targetCurrency);
}
