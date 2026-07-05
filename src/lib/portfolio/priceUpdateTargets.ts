import type { AssetTransactionEntry, Holding } from '../../types/portfolio';

export interface UnmatchedHistoricalAsset {
  assetId: string;
  symbol: string;
  assetName: string;
  reason: string;
}

export interface PriceUpdateTargetDiagnostics {
  historicalAssetCount: number;
  matchedAssetCount: number;
  unmatchedAssetCount: number;
  unmatchedAssets: UnmatchedHistoricalAsset[];
  currentAssetCount: number;
  historicalAssetUpdateCount: number;
}

export interface PriceUpdateTargetPlan {
  targetHoldings: Holding[];
  diagnostics: PriceUpdateTargetDiagnostics;
}

export function buildArchivedAssetRepairPayloadFromTransaction(entry: AssetTransactionEntry) {
  return {
    name: entry.assetName.trim(),
    symbol: entry.symbol.trim().toUpperCase(),
    assetType: entry.assetType,
    accountSource: entry.accountSource,
    currency: entry.currency.trim().toUpperCase() || 'USD',
    quantity: 0,
    averageCost: 0,
    currentPrice: Number.isFinite(entry.price) && entry.price > 0 ? entry.price : 0,
  };
}

function isActiveNonCashHolding(holding: Holding) {
  return holding.assetType !== 'cash' && !holding.archivedAt && holding.quantity > 0;
}

export function dedupeNonCashHoldingsByAssetId(holdings: Holding[]) {
  const result = new Map<string, Holding>();

  holdings.forEach((holding) => {
    if (holding.assetType !== 'cash' && holding.id && !result.has(holding.id)) {
      result.set(holding.id, holding);
    }
  });

  return [...result.values()];
}

export function buildAllAssetPriceUpdatePlan(allHoldings: Holding[]): PriceUpdateTargetPlan {
  const targetHoldings = dedupeNonCashHoldingsByAssetId(allHoldings);
  const currentAssetCount = targetHoldings.filter(isActiveNonCashHolding).length;
  const historicalAssetUpdateCount = targetHoldings.length - currentAssetCount;

  return {
    targetHoldings,
    diagnostics: {
      historicalAssetCount: targetHoldings.length,
      matchedAssetCount: targetHoldings.length,
      unmatchedAssetCount: 0,
      unmatchedAssets: [],
      currentAssetCount,
      historicalAssetUpdateCount,
    },
  };
}

function sortTransactionsNewestFirst(left: AssetTransactionEntry, right: AssetTransactionEntry) {
  const dateDiff = right.date.localeCompare(left.date);
  if (dateDiff !== 0) return dateDiff;

  const createdDiff = (right.createdAt ?? '').localeCompare(left.createdAt ?? '');
  if (createdDiff !== 0) return createdDiff;

  return right.id.localeCompare(left.id);
}

export function buildTransactionAssetPriceUpdatePlan(
  entries: AssetTransactionEntry[],
  allHoldings: Holding[],
): PriceUpdateTargetPlan {
  const holdingsById = new Map(allHoldings.map((holding) => [holding.id, holding]));
  const latestEntryByAssetId = new Map<string, AssetTransactionEntry>();

  entries
    .filter((entry) => entry.assetId && entry.assetType !== 'cash')
    .sort(sortTransactionsNewestFirst)
    .forEach((entry) => {
      if (!latestEntryByAssetId.has(entry.assetId)) {
        latestEntryByAssetId.set(entry.assetId, entry);
      }
    });

  const targetHoldings: Holding[] = [];
  const unmatchedAssets: UnmatchedHistoricalAsset[] = [];

  latestEntryByAssetId.forEach((entry, assetId) => {
    const holding = holdingsById.get(assetId);

    if (!holding) {
      unmatchedAssets.push({
        assetId,
        symbol: entry.symbol,
        assetName: entry.assetName,
        reason: 'assets 文件不存在',
      });
      return;
    }

    if (holding.assetType === 'cash') {
      return;
    }

    targetHoldings.push(holding);
  });

  const dedupedTargetHoldings = dedupeNonCashHoldingsByAssetId(targetHoldings);
  const currentAssetCount = dedupedTargetHoldings.filter(isActiveNonCashHolding).length;

  return {
    targetHoldings: dedupedTargetHoldings,
    diagnostics: {
      historicalAssetCount: latestEntryByAssetId.size,
      matchedAssetCount: dedupedTargetHoldings.length,
      unmatchedAssetCount: unmatchedAssets.length,
      unmatchedAssets,
      currentAssetCount,
      historicalAssetUpdateCount: dedupedTargetHoldings.length - currentAssetCount,
    },
  };
}
