import {
  convertCurrency,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
} from '../../data/mockPortfolio';
import type { Holding } from '../../types/portfolio';
import type {
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
  analysisModel: string,
  analysisInstruction: string,
) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify({
        snapshotHash,
        analysisModel,
        analysisInstruction: analysisInstruction.trim(),
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

export function buildPortfolioAnalysisRequest(
  holdings: Holding[],
  snapshotHash: string,
  cacheKey: string,
  analysisModel: PortfolioAnalysisRequest['analysisModel'],
  analysisInstruction: string,
): PortfolioAnalysisRequest {
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

  return {
    cacheKey,
    snapshotHash,
    analysisModel,
    analysisInstruction: analysisInstruction.trim(),
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
