import type { Holding, PortfolioAssetInput } from '../../types/portfolio';
export declare function buildHoldingFromInput(id: string, payload: PortfolioAssetInput & {
    priceAsOf?: unknown;
    lastPriceUpdatedAt?: unknown;
}): Holding;
export declare function recalculateHoldingAllocations(holdings: Holding[], getHoldingValue?: (holding: Holding) => number): {
    allocation: number;
    id: string;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPct: number;
    priceAsOf?: string | undefined;
    lastPriceUpdatedAt?: string | undefined;
    name: string;
    symbol: string;
    assetType: import("../../types/portfolio").AssetType;
    accountSource: import("../../types/portfolio").AccountSource;
    currency: string;
    quantity: number;
    averageCost: number;
    currentPrice: number;
}[];
export declare function getFirebaseAssetsErrorMessage(error?: unknown): string;
export declare function subscribeToPortfolioAssets(onData: (holdings: Holding[]) => void, onError: (error: unknown) => void): import("@firebase/firestore").Unsubscribe;
export declare function createPortfolioAsset(payload: PortfolioAssetInput): Promise<void>;
export declare function createPortfolioAssets(payloads: PortfolioAssetInput[]): Promise<void>;
export declare function updatePortfolioAsset(assetId: string, payload: PortfolioAssetInput): Promise<void>;
