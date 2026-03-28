export declare function buildHealthResponse(): {
    ok: boolean;
    route: string;
    mode: string;
    service: string;
    version: string;
    timestamp: string;
};
export declare function buildExtractAssetsResponse(): {
    ok: boolean;
    route: string;
    mode: string;
    provider: string;
    jobId: string;
    status: string;
    candidates: {
        name: string;
        symbol: string;
        assetType: string;
        quantity: number;
        averageCost: number;
        currency: string;
        confidence: number;
    }[];
};
export declare function buildUpdatePricesResponse(): {
    ok: boolean;
    route: string;
    mode: string;
    provider: string;
    updatedAt: string;
    prices: {
        symbol: string;
        currency: string;
        price: number;
        source: string;
    }[];
};
export declare function buildAnalyzeResponse(): {
    ok: boolean;
    route: string;
    mode: string;
    provider: string;
    analysisId: string;
    modelTier: string;
    summary: string;
    highlights: string[];
};
