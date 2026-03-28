import type { Holding } from './portfolio';

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
  snapshotHash: string;
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
  model: string;
  snapshotHash: string;
  generatedAt: string;
}

export interface CachedPortfolioAnalysis extends PortfolioAnalysisResult {
  snapshotHash: string;
  model: string;
  generatedAt: string;
  assetCount: number;
}
