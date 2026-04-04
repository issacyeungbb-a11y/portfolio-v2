import type { AssetType, AccountSource, PortfolioAssetInput } from './portfolio';

export interface ExtractAssetsRequest {
  fileName: string;
  mimeType: string;
  imageBase64: string;
}

export interface ParseAssetsCommandRequest {
  text: string;
}

export interface ExtractedAssetCandidate {
  name: string | null;
  ticker: string | null;
  type: AssetType | null;
  quantity: number | null;
  currency: string | null;
  costBasis: number | null;
  currentPrice: number | null;
}

export interface ExtractAssetsResponse {
  ok: boolean;
  route: '/api/extract-assets';
  mode: 'live';
  model: string;
  assets: ExtractedAssetCandidate[];
}

export interface ParseAssetsCommandResponse {
  ok: boolean;
  route: '/api/parse-assets-command';
  mode: 'live';
  model: string;
  assets: ExtractedAssetCandidate[];
}

export type EditableExtractedAssetField =
  | 'name'
  | 'ticker'
  | 'type'
  | 'quantity'
  | 'currency'
  | 'costBasis'
  | 'currentPrice';

export interface EditableExtractedAsset {
  id: string;
  name: string;
  ticker: string;
  type: AssetType | '';
  quantity: string;
  currency: string;
  costBasis: string;
  currentPrice: string;
}

export interface ConfirmExtractedAssetsInput {
  accountSource: AccountSource;
  assets: EditableExtractedAsset[];
}

export function createEditableExtractedAsset(
  asset: ExtractedAssetCandidate,
  index: number,
): EditableExtractedAsset {
  return {
    id: `extracted-${index}-${asset.ticker ?? 'asset'}`,
    name: asset.name ?? '',
    ticker: asset.ticker ?? '',
    type: asset.type ?? '',
    quantity: asset.quantity == null ? '' : String(asset.quantity),
    currency: asset.currency ?? '',
    costBasis: asset.costBasis == null ? '' : String(asset.costBasis),
    currentPrice: asset.currentPrice == null ? '' : String(asset.currentPrice),
  };
}

export function getMissingExtractedAssetFields(
  asset: EditableExtractedAsset,
): EditableExtractedAssetField[] {
  const missing: EditableExtractedAssetField[] = [];

  if (!asset.name.trim()) {
    missing.push('name');
  }

  if (!asset.ticker.trim()) {
    missing.push('ticker');
  }

  if (!asset.type) {
    missing.push('type');
  }

  if (!asset.quantity.trim()) {
    missing.push('quantity');
  }

  if (!asset.currency.trim()) {
    missing.push('currency');
  }

  if (!asset.costBasis.trim()) {
    missing.push('costBasis');
  }

  return missing;
}

export function buildPortfolioAssetInputFromExtractedAsset(
  asset: EditableExtractedAsset,
  accountSource: AccountSource,
): PortfolioAssetInput {
  const normalizedCurrency = asset.currency.trim().toUpperCase();
  const normalizedCostBasis = Number(asset.costBasis);
  const normalizedAssetType = asset.type as AssetType;
  const normalizedCurrentPrice = asset.currentPrice.trim()
    ? Number(asset.currentPrice)
    : normalizedAssetType === 'cash'
      ? normalizedCostBasis
      : 0;

  return {
    name: asset.name.trim(),
    symbol: asset.ticker.trim().toUpperCase(),
    assetType: normalizedAssetType,
    accountSource,
    currency: normalizedCurrency,
    quantity: Number(asset.quantity),
    averageCost: normalizedCostBasis,
    currentPrice: normalizedCurrentPrice,
  };
}
