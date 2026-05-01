import type { AnalysisCategory, Holding } from './portfolio';

export type PortfolioAnalysisProvider = 'google' | 'anthropic';
export type PortfolioAnalysisModel =
  | 'gemini-3.1-pro-preview'
  | 'claude-opus-4-7';

export type AnalysisIntent = 'portfolio_only' | 'market_research' | 'deep_analysis';

export interface ExternalSource {
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
  snippet: string;
  query: string;
  relatedTickers: string[];
}

export interface MacroContext {
  retrievedAt: string;
  summary: string;
  interestRateNotes?: string[];
  inflationNotes?: string[];
  bondYieldNotes?: string[];
  fxNotes?: string[];
  equityMarketNotes?: string[];
  cryptoMarketNotes?: string[];
  sources: ExternalSource[];
}

export interface GeneralQuestionDataFreshness {
  portfolioSnapshotAt?: string;
  externalSearchAt?: string;
  hasExternalSearch: boolean;
  externalSearchStatus: 'not_needed' | 'ok' | 'partial' | 'failed';
}

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
  marketValueHKD: number;
  costValue: number;
  costValueHKD: number;
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
  enrichmentStatus?: 'ok' | 'partial' | 'failed';
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
  usedPortfolioFacts?: string[];
  usedExternalSources?: string[];
  uncertainty?: string[];
  suggestedActions?: string[];
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
  enrichmentStatus: 'ok' | 'partial' | 'failed';
  analysisQuestion: string;
  analysisBackground: string;
  delivery?: 'manual' | 'scheduled';
  generatedAt: string;
  intent?: AnalysisIntent;
  dataFreshness?: GeneralQuestionDataFreshness;
  macroContext?: MacroContext;
}

export interface CachedPortfolioAnalysis extends PortfolioAnalysisResult {
  cacheKey: string;
  snapshotHash: string;
  category: AnalysisCategory;
  provider: PortfolioAnalysisProvider;
  model: string;
  enrichmentStatus: 'ok' | 'partial' | 'failed';
  analysisQuestion: string;
  analysisBackground: string;
  delivery?: 'manual' | 'scheduled';
  generatedAt: string;
  assetCount: number;
}
