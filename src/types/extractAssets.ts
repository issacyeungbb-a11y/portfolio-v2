import type { AssetType, AccountSource, PortfolioAssetInput } from './portfolio';
import type { AssetTransactionType } from './portfolio';

export interface ExtractAssetsRequest {
  fileName: string;
  mimeType: string;
  imageBase64: string;
}

export interface ParseAssetsCommandRequest {
  text: string;
}

export interface ExtractTransactionsRequest {
  fileName: string;
  mimeType: string;
  imageBase64: string;
}

export interface ParseTransactionsCommandRequest {
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

export interface ExtractedTransactionCandidate {
  name: string | null;
  ticker: string | null;
  type: AssetType | null;
  transactionType: AssetTransactionType | null;
  quantity: number | null;
  currency: string | null;
  price: number | null;
  fees: number | null;
  date: string | null;
  note: string | null;
}

export interface ExtractTransactionsResponse {
  ok: boolean;
  route: '/api/extract-transactions';
  mode: 'live';
  model: string;
  transactions: ExtractedTransactionCandidate[];
}

export interface ParseTransactionsCommandResponse {
  ok: boolean;
  route: '/api/parse-transactions-command';
  mode: 'live';
  model: string;
  transactions: ExtractedTransactionCandidate[];
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

export type EditableExtractedTransactionField =
  | 'name'
  | 'ticker'
  | 'type'
  | 'transactionType'
  | 'quantity'
  | 'currency'
  | 'price'
  | 'fees'
  | 'date'
  | 'note';

export interface EditableExtractedTransaction {
  id: string;
  name: string;
  ticker: string;
  type: AssetType | '';
  transactionType: AssetTransactionType | '';
  settlementAccountSource: AccountSource | '';
  quantity: string;
  currency: string;
  price: string;
  fees: string;
  date: string;
  note: string;
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

export function createEditableExtractedTransaction(
  entry: ExtractedTransactionCandidate,
  index: number,
): EditableExtractedTransaction {
  return {
    id: `extracted-transaction-${index}-${entry.ticker ?? 'transaction'}`,
    name: entry.name ?? '',
    ticker: entry.ticker ?? '',
    type: entry.type ?? '',
    transactionType: entry.transactionType ?? '',
    settlementAccountSource: '',
    quantity: entry.quantity == null ? '' : String(entry.quantity),
    currency: entry.currency ?? '',
    price: entry.price == null ? '' : String(entry.price),
    fees: entry.fees == null ? '0' : String(entry.fees),
    date: entry.date ?? new Date().toISOString().slice(0, 10),
    note: entry.note ?? '',
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

export function getMissingExtractedTransactionFields(
  entry: EditableExtractedTransaction,
): EditableExtractedTransactionField[] {
  const missing: EditableExtractedTransactionField[] = [];

  if (!entry.ticker.trim()) {
    missing.push('ticker');
  }

  if (!entry.transactionType) {
    missing.push('transactionType');
  }

  if (!entry.quantity.trim()) {
    missing.push('quantity');
  }

  if (!entry.currency.trim()) {
    missing.push('currency');
  }

  if (!entry.price.trim()) {
    missing.push('price');
  }

  if (!entry.date.trim()) {
    missing.push('date');
  }

  return missing;
}
