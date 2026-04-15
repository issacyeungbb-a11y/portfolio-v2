import type { AssetType } from './portfolio';

export type PriceSource = 'api_auto' | 'api_auto_cron' | 'api_review_confirmed' | 'manual';

export interface PriceUpdateRequestAsset {
  assetId: string;
  assetName: string;
  ticker: string;
  assetType: AssetType;
  currentPrice: number;
  currency: string;
}

export interface PriceUpdateRequest {
  assets: PriceUpdateRequestAsset[];
}

export interface PriceUpdateModelResult {
  assetName: string | null;
  ticker: string | null;
  assetType: AssetType | null;
  price: number | null;
  currency: string | null;
  asOf: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  isValid: boolean;
}

export interface PriceUpdateResponse {
  ok: boolean;
  route: '/api/update-prices';
  mode: 'live';
  model: string;
  results: PendingPriceUpdateReview[];
}

export interface PendingPriceUpdateReview extends PriceUpdateModelResult {
  id: string;
  assetId: string;
  assetName: string;
  ticker: string;
  assetType: AssetType;
  currentPrice: number;
  currency: string;
  asOf: string;
  sourceName: string;
  sourceUrl: string;
  diffPct: number;
  failureCategory?:
    | 'ticker_format'
    | 'quote_time'
    | 'source_missing'
    | 'response_format'
    | 'price_missing'
    | 'confidence_low'
    | 'diff_too_large'
    | 'unknown';
  invalidReason?: string;
  status: 'pending' | 'confirmed' | 'dismissed';
}

export interface AssetPriceHistoryEntry {
  id: string;
  assetId: string;
  assetName: string;
  ticker: string;
  assetType: AssetType;
  price: number;
  currency: string;
  asOf: string;
  sourceName: string;
  sourceUrl: string;
  recordedAt: string;
}
