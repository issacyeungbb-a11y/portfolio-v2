import type { PendingPriceUpdateReview } from '../../types/priceUpdates';
export declare function getPriceReviewsErrorMessage(error?: unknown): string;
export declare function subscribeToPriceUpdateReviews(uid: string, onData: (reviews: PendingPriceUpdateReview[]) => void, onError: (error: unknown) => void): import("@firebase/firestore").Unsubscribe;
export declare function savePendingPriceUpdateReviews(uid: string, reviews: PendingPriceUpdateReview[]): Promise<void>;
export declare function confirmPriceUpdateReview(uid: string, review: PendingPriceUpdateReview): Promise<void>;
export declare function dismissPriceUpdateReview(uid: string, assetId: string): Promise<void>;
