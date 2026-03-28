import type { CachedPortfolioAnalysis } from '../../types/portfolioAnalysis';
export declare function getAnalysisCacheErrorMessage(error?: unknown): string;
export declare function subscribeToAnalysisCache(uid: string, snapshotHash: string, onData: (analysis: CachedPortfolioAnalysis | null) => void, onError: (error: unknown) => void): import("@firebase/firestore").Unsubscribe;
export declare function saveAnalysisCache(uid: string, analysis: CachedPortfolioAnalysis): Promise<void>;
