import type { AnalysisCategory, Holding } from './portfolio';

export type PortfolioAnalysisProvider = 'google' | 'anthropic';
export type PortfolioAnalysisModel =
  | 'gemini-3.1-pro-preview'
  | 'claude-opus-4-6';

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
  generatedAt: string;
  assetCount: number;
}
