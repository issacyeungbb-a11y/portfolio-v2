import type { AnalysisCategory, Holding } from './portfolio';

export type PortfolioAnalysisProvider = 'google' | 'anthropic';
export type PortfolioAnalysisModel =
  | 'gemini-3.1-pro-preview'
  | 'claude-opus-4-7';

export interface PortfolioAnalysisRequestAsset {
  id: string;
  name: string;
  ticker: string;
  assetType: Holding['assetType'];
  accountSource: Holding['accountSource'];
  currency: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  costValue: number;
}

export interface PortfolioAnalysisRecentTransaction {
  date: string;
  type: 'buy' | 'sell';
  quantity: number;
  price: number;
}

export interface PortfolioAnalysisRecentTransactionGroup {
  assetId: string;
  assetName: string;
  ticker: string;
  transactions: PortfolioAnalysisRecentTransaction[];
}

export interface PortfolioAnalysisPriceHistoryPoint {
  date: string;
  price: number;
}

export interface PortfolioAnalysisPriceHistoryGroup {
  assetId: string;
  assetName: string;
  ticker: string;
  currency: string;
  currentPrice: number;
  change30dPct: number;
  points: PortfolioAnalysisPriceHistoryPoint[];
}

export interface PortfolioAnalysisRecentSnapshotHolding {
  assetId: string;
  ticker: string;
  assetName: string;
  currentPrice: number;
  marketValueHKD: number;
  quantity: number;
}

export interface PortfolioAnalysisRecentSnapshot {
  date: string;
  capturedAt?: string;
  totalValueHKD: number;
  netExternalFlowHKD: number;
  assetCount: number;
  holdings: PortfolioAnalysisRecentSnapshotHolding[];
}

export interface PortfolioAnalysisRequest {
  cacheKey: string;
  snapshotHash: string;
  category: AnalysisCategory;
  analysisModel: PortfolioAnalysisModel;
  analysisQuestion?: string;
  analysisBackground?: string;
  conversationContext?: string;
  assetCount: number;
  totalValueHKD: number;
  totalCostHKD: number;
  holdings: PortfolioAnalysisRequestAsset[];
  allocationsByType: Array<{
    assetType: Holding['assetType'];
    percentage: number;
    totalValueHKD: number;
  }>;
  allocationsByCurrency: Array<{
    currency: string;
    percentage: number;
    totalValueHKD: number;
  }>;
  recentTransactions?: PortfolioAnalysisRecentTransactionGroup[];
  priceHistory?: PortfolioAnalysisPriceHistoryGroup[];
  recentSnapshots?: PortfolioAnalysisRecentSnapshot[];
}

export interface PortfolioAnalysisResult {
  answer: string;
}

export interface PortfolioAnalysisResponse extends PortfolioAnalysisResult {
  ok: boolean;
  route: '/api/analyze';
  mode: 'live';
  cacheKey: string;
  category: AnalysisCategory;
  provider: PortfolioAnalysisProvider;
  model: string;
  snapshotHash: string;
  analysisQuestion: string;
  analysisBackground: string;
  delivery?: 'manual' | 'scheduled';
  generatedAt: string;
}

export interface CachedPortfolioAnalysis extends PortfolioAnalysisResult {
  cacheKey: string;
  snapshotHash: string;
  category: AnalysisCategory;
  provider: PortfolioAnalysisProvider;
  model: string;
  analysisQuestion: string;
  analysisBackground: string;
  delivery?: 'manual' | 'scheduled';
  generatedAt: string;
  assetCount: number;
}
