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
  repairableMissingAssetCount: number;
  blockedMissingAssetCount: number;
  repairableMissingAssets: UnmatchedHistoricalAsset[];
  blockedMissingAssets: UnmatchedHistoricalAsset[];
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

function hasCompleteRepairData(entry: AssetTransactionEntry) {
  return Boolean(
    entry.assetId.trim() &&
    entry.assetName.trim() &&
    entry.symbol.trim() &&
    entry.assetType &&
    entry.accountSource &&
    entry.currency.trim() &&
    Number.isFinite(entry.price) &&
    entry.price > 0,
  );
}

function getMissingAssetReason(entry: AssetTransactionEntry) {
  if (!entry.assetId.trim()) {
    return 'assetId 缺失';
  }

  if (!hasCompleteRepairData(entry)) {
    return '資料不完整';
  }

  if ((entry.quantityAfter ?? 0) > 0.00000001) {
    return 'assets 文件不存在，但交易顯示仍有持倉';
  }

  return 'assets 文件不存在，可安全修復';
}

export function getLatestNonCashTransactionByAssetId(entries: AssetTransactionEntry[]) {
  const latestEntryByAssetId = new Map<string, AssetTransactionEntry>();

  entries
    .filter((entry) => entry.assetType !== 'cash')
    .sort(sortTransactionsNewestFirst)
    .forEach((entry) => {
      if (entry.assetId && !latestEntryByAssetId.has(entry.assetId)) {
        latestEntryByAssetId.set(entry.assetId, entry);
      }
    });

  return latestEntryByAssetId;
}

export function getRepairableMissingAssetEntries(
  entries: AssetTransactionEntry[],
  existingAssetIds: Set<string>,
) {
  return [...getLatestNonCashTransactionByAssetId(entries).values()].filter(
    (entry) => !existingAssetIds.has(entry.assetId) && getMissingAssetReason(entry) === 'assets 文件不存在，可安全修復',
  );
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
      repairableMissingAssetCount: 0,
      blockedMissingAssetCount: 0,
      repairableMissingAssets: [],
      blockedMissingAssets: [],
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
  const latestEntryByAssetId = getLatestNonCashTransactionByAssetId(entries);

  const targetHoldings: Holding[] = [];
  const unmatchedAssets: UnmatchedHistoricalAsset[] = [];
  const missingAssetIdCount = entries.filter(
    (entry) => entry.assetType !== 'cash' && !entry.assetId.trim(),
  ).length;

  if (missingAssetIdCount > 0) {
    unmatchedAssets.push({
      assetId: '',
      symbol: '',
      assetName: `${missingAssetIdCount} 筆交易`,
      reason: 'assetId 缺失',
    });
  }

  latestEntryByAssetId.forEach((entry, assetId) => {
    const holding = holdingsById.get(assetId);

    if (!holding) {
      unmatchedAssets.push({
        assetId,
        symbol: entry.symbol,
        assetName: entry.assetName,
        reason: getMissingAssetReason(entry),
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
  const repairableMissingAssets = unmatchedAssets.filter(
    (asset) => asset.reason === 'assets 文件不存在，可安全修復',
  );
  const blockedMissingAssets = unmatchedAssets.filter(
    (asset) => asset.reason !== 'assets 文件不存在，可安全修復',
  );

  return {
    targetHoldings: dedupedTargetHoldings,
    diagnostics: {
      historicalAssetCount: latestEntryByAssetId.size,
      matchedAssetCount: dedupedTargetHoldings.length,
      unmatchedAssetCount: unmatchedAssets.length,
      unmatchedAssets,
      repairableMissingAssetCount: repairableMissingAssets.length,
      blockedMissingAssetCount: blockedMissingAssets.length,
      repairableMissingAssets,
      blockedMissingAssets,
      currentAssetCount,
      historicalAssetUpdateCount: dedupedTargetHoldings.length - currentAssetCount,
    },
  };
}
