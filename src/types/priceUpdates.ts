import type { AssetType } from './portfolio';

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
  confidence: number | null;
  needsReview: boolean;
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
  confidence: number;
  diffPct: number;
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
  confidence: number;
  recordedAt: string;
}
