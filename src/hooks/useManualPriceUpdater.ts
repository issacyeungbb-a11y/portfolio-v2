import { useState } from 'react';

import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import type { Holding } from '../types/portfolio';
import type { PendingPriceUpdateReview, PriceUpdateRequest, PriceUpdateResponse } from '../types/priceUpdates';

const MANUAL_PRICE_UPDATE_BATCH_SIZE = 3;
const MANUAL_PRICE_UPDATE_RETRY_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPriceUpdateRequest(targetHoldings: Holding[]): PriceUpdateRequest {
  return {
    assets: targetHoldings.map((holding) => ({
      assetId: holding.id,
      assetName: holding.name,
      ticker: holding.symbol,
      assetType: holding.assetType,
      accountSource: holding.accountSource,
      currentPrice: holding.currentPrice,
      currency: holding.currency,
    })),
  };
}

function chunkHoldingsForManualUpdate(targetHoldings: Holding[]) {
  const chunks: Holding[][] = [];

  for (let index = 0; index < targetHoldings.length; index += MANUAL_PRICE_UPDATE_BATCH_SIZE) {
    chunks.push(targetHoldings.slice(index, index + MANUAL_PRICE_UPDATE_BATCH_SIZE));
  }

  return chunks;
}

async function callPriceUpdateChunkWithRetry(chunk: Holding[]) {
  try {
    return (await callPortfolioFunction(
      'update-prices',
      buildPriceUpdateRequest(chunk),
    )) as PriceUpdateResponse;
  } catch {
    await sleep(MANUAL_PRICE_UPDATE_RETRY_DELAY_MS);
    return (await callPortfolioFunction(
      'update-prices',
      buildPriceUpdateRequest(chunk),
    )) as PriceUpdateResponse;
  }
}

export function useManualPriceUpdater(params: {
  applyReviews: (reviews: PendingPriceUpdateReview[]) => Promise<void>;
  saveReviews: (reviews: PendingPriceUpdateReview[]) => Promise<void>;
  emptyTargetMessage?: string;
}) {
  const [isUpdatingAllPrices, setIsUpdatingAllPrices] = useState(false);
  const [updatingAssetIds, setUpdatingAssetIds] = useState<string[]>([]);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);
  const [priceUpdateSuccess, setPriceUpdateSuccess] = useState<string | null>(null);

  async function runPriceUpdates(targetHoldings: Holding[]) {
    const updatableHoldings = targetHoldings.filter((holding) => holding.assetType !== 'cash');

    if (updatableHoldings.length === 0) {
      setPriceUpdateError(params.emptyTargetMessage ?? '目前沒有可更新的資產。');
      setPriceUpdateSuccess(null);
      return;
    }

    const targetIds = updatableHoldings.map((holding) => holding.id);
    const isBulkUpdate = updatableHoldings.length > 1;

    setPriceUpdateError(null);
    setPriceUpdateSuccess(null);

    if (isBulkUpdate) {
      setIsUpdatingAllPrices(true);
    } else {
      setUpdatingAssetIds((current) => [...new Set([...current, ...targetIds])]);
    }

    try {
      const responses: PriceUpdateResponse[] = [];

      for (const chunk of chunkHoldingsForManualUpdate(updatableHoldings)) {
        const response = await callPriceUpdateChunkWithRetry(chunk);
        responses.push(response);
      }

      const mergedResults = responses.flatMap((response) => response.results);
      const validResults = mergedResults.filter(
        (review) => review.price != null && review.price > 0 && !review.invalidReason,
      );
      const invalidResults = mergedResults.filter(
        (review) => review.price == null || review.price <= 0 || Boolean(review.invalidReason),
      );

      if (validResults.length > 0) {
        await params.applyReviews(validResults);
      }

      await params.saveReviews(invalidResults);

      if (validResults.length > 0 && invalidResults.length > 0) {
        setPriceUpdateSuccess(
          `已自動更新 ${validResults.length} 項資產；${invalidResults.length} 項需要人工確認。`,
        );
      } else if (validResults.length > 0) {
        setPriceUpdateSuccess(`已自動更新 ${validResults.length} 項資產價格。`);
      } else if (invalidResults.length > 0) {
        setPriceUpdateSuccess(`現有 ${invalidResults.length} 項需要人工確認。`);
      } else {
        setPriceUpdateSuccess('本次沒有可套用的價格更新。');
      }
    } catch (error) {
      setPriceUpdateError(
        error instanceof Error ? error.message : '價格更新失敗，請稍後再試。',
      );
    } finally {
      if (isBulkUpdate) {
        setIsUpdatingAllPrices(false);
      }
      setUpdatingAssetIds((current) => current.filter((id) => !targetIds.includes(id)));
    }
  }

  return {
    isUpdating: isUpdatingAllPrices || updatingAssetIds.length > 0,
    isUpdatingAllPrices,
    updatingAssetIds,
    priceUpdateError,
    priceUpdateSuccess,
    runPriceUpdates,
  };
}
