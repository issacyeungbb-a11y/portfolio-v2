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
export interface ConfirmExtractedAssetsInput {
    accountSource: AccountSource;
    assets: EditableExtractedAsset[];
}
export declare function createEditableExtractedAsset(asset: ExtractedAssetCandidate, index: number): EditableExtractedAsset;
export declare function getMissingExtractedAssetFields(asset: EditableExtractedAsset): EditableExtractedAssetField[];
export declare function buildPortfolioAssetInputFromExtractedAsset(asset: EditableExtractedAsset, accountSource: AccountSource): PortfolioAssetInput;
