import type { AnalysisCategory, Holding } from './portfolio';

export type PortfolioAnalysisProvider = 'google' | 'anthropic';
export type PortfolioAnalysisModel =
  | 'gemini-3.1-pro-preview'
  | 'claude-opus-4-7';

export type AnalysisIntent =
  | 'portfolio_only'
  | 'earnings_analysis'
  | 'company_research'
  | 'macro_analysis'
  | 'strategy_analysis'
  | 'market_research'
  | 'deep_analysis';

export type ExternalEvidenceSourceType =
  | 'official_report'
  | 'sec_filing'
  | 'earnings_call'
  | 'news'
  | 'macro_data'
  | 'company_ir'
  | 'market_data'
  | 'other';

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

export interface ExternalEvidenceSource {
  sourceTitle: string;
  sourceUrl: string;
  publishedDate?: string;
  retrievedAt: string;
  sourceType: ExternalEvidenceSourceType;
  keyFacts: string[];
  keyFigures: string[];
  uncertainty: string[];
}

export interface EarningsEvidencePack {
  companyName: string | null;
  ticker: string | null;
  reportingPeriod: string | null;
  reportDate: string | null;
  revenue: string | null;
  revenueGrowth: string | null;
  operatingIncome: string | null;
  operatingMargin: string | null;
  netIncome: string | null;
  EPS: string | null;
  operatingCashFlow: string | null;
  freeCashFlow: string | null;
  capitalExpenditure: string | null;
  segmentRevenue: string[];
  segmentOperatingIncome: string[];
  managementCommentary: string[];
  marketReaction: string[];
  oneOffItems: string[];
  mainRisks: string[];
  sources: ExternalEvidenceSource[];
  uncertainty: string[];
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
  externalSearchStatus: 'not_needed' | 'ok' | 'partial' | 'failed' | 'cached';
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
  usedExternalSourcesDetailed?: ExternalEvidenceSource[];
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
  externalEvidence?: ExternalEvidenceSource[];
  earningsEvidencePack?: EarningsEvidencePack;
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
