import type { PendingPriceUpdateReview } from '../src/types/priceUpdates';
export declare function getUpdatePricesErrorResponse(error: unknown): {
    status: number;
    body: {
        ok: boolean;
        route: "/api/update-prices";
        message: string;
    };
};
export declare function generatePriceUpdates(payload: unknown): Promise<{
    ok: boolean;
    route: "/api/update-prices";
    mode: string;
    model: string;
    results: PendingPriceUpdateReview[];
}>;
