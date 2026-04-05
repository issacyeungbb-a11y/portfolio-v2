import type { Holding } from './portfolio';

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
  analysisModel: PortfolioAnalysisModel;
  analysisInstruction?: string;
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
  summary: string;
  topRisks: string[];
  allocationInsights: string[];
  currencyExposure: string[];
  nextQuestions: string[];
}

export interface PortfolioAnalysisResponse extends PortfolioAnalysisResult {
  ok: boolean;
  route: '/api/analyze';
  mode: 'live';
  cacheKey: string;
  provider: PortfolioAnalysisProvider;
  model: string;
  snapshotHash: string;
  analysisInstruction: string;
  generatedAt: string;
}

export interface CachedPortfolioAnalysis extends PortfolioAnalysisResult {
  cacheKey: string;
  snapshotHash: string;
  provider: PortfolioAnalysisProvider;
  model: string;
  analysisInstruction: string;
  generatedAt: string;
  assetCount: number;
}
