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
export type EditableExtractedAssetField = 'name' | 'ticker' | 'type' | 'quantity' | 'currency' | 'costBasis' | 'currentPrice';
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
export type EditableExtractedTransactionField = 'name' | 'ticker' | 'type' | 'transactionType' | 'quantity' | 'currency' | 'price' | 'fees' | 'date' | 'note';
export interface EditableExtractedTransaction {
    id: string;
    name: string;
    ticker: string;
    type: AssetType | '';
    transactionType: AssetTransactionType | '';
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
export declare function createEditableExtractedAsset(asset: ExtractedAssetCandidate, index: number): EditableExtractedAsset;
export declare function createEditableExtractedTransaction(entry: ExtractedTransactionCandidate, index: number): EditableExtractedTransaction;
export declare function getMissingExtractedAssetFields(asset: EditableExtractedAsset): EditableExtractedAssetField[];
export declare function getMissingExtractedTransactionFields(entry: EditableExtractedTransaction): EditableExtractedTransactionField[];
export declare function buildPortfolioAssetInputFromExtractedAsset(asset: EditableExtractedAsset, accountSource: AccountSource): PortfolioAssetInput;
