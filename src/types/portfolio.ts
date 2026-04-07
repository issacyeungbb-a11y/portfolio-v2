export type AssetType = 'stock' | 'etf' | 'bond' | 'crypto' | 'cash';
export type AccountSource = 'Futu' | 'IB' | 'Crypto' | 'Other';
export type PerformanceRange = '7d' | '30d' | '6m' | '1y';
export type DisplayCurrency = 'HKD' | 'USD' | 'JPY';
export type AllocationBucketKey = AssetType;
export type InsightTone = 'positive' | 'neutral' | 'caution';
export type ImportStatus = 'completed' | 'processing' | 'review';
export type AccountCashFlowType = 'deposit' | 'withdrawal' | 'adjustment';
export type AssetChangeRange = '1d' | '7d' | '30d';
export type AssetTransactionType = 'buy' | 'sell';
export type AssetTransactionRecordType = 'asset_created' | 'seed' | 'trade';

export interface PortfolioAssetInput {
  name: string;
  symbol: string;
  assetType: AssetType;
  accountSource: AccountSource;
  currency: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
}

export interface Holding extends PortfolioAssetInput {
  id: string;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  allocation: number;
  priceAsOf?: string;
  lastPriceUpdatedAt?: string;
  archivedAt?: string;
}

export interface AccountPrincipalEntry {
  accountSource: AccountSource;
  principalAmount: number;
  currency: string;
  updatedAt?: string;
}

export interface AccountCashFlowEntry {
  id: string;
  accountSource: AccountSource;
  type: AccountCashFlowType;
  amount: number;
  currency: string;
  date: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssetTransactionEntry {
  id: string;
  assetId: string;
  assetName: string;
  symbol: string;
  assetType: AssetType;
  accountSource: AccountSource;
  transactionType: AssetTransactionType;
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  date: string;
  realizedPnlHKD: number;
  recordType?: AssetTransactionRecordType;
  quantityAfter?: number;
  averageCostAfter?: number;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SnapshotHoldingPoint {
  assetId: string;
  name: string;
  symbol: string;
  assetType: AssetType;
  accountSource: AccountSource;
  currency: string;
  quantity: number;
  currentPrice: number;
  averageCost: number;
  marketValueHKD: number;
}

export interface PortfolioPerformancePoint {
  id?: string;
  date: string;
  capturedAt?: string;
  totalValue: number;
  netExternalFlow: number;
  assetCount?: number;
  holdings?: SnapshotHoldingPoint[];
  reason?:
    | 'asset_created'
    | 'assets_imported'
    | 'price_update_confirmed'
    | 'snapshot'
    | 'daily_snapshot'
    | 'cash_flow_recorded';
}

export interface PortfolioPerformanceSummary {
  range: PerformanceRange | AssetChangeRange;
  label: string;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  netExternalFlow: number;
  changeAmount: number;
  returnPct: number;
}

export interface AllocationSlice {
  key: AllocationBucketKey;
  label: string;
  value: number;
  color: string;
  totalValueHKD: number;
  totalValueUSD: number;
  holdings: Holding[];
}

export interface Insight {
  id: string;
  title: string;
  summary: string;
  tone: InsightTone;
}

export interface ImportJob {
  id: string;
  fileName: string;
  broker: string;
  status: ImportStatus;
  detectedCount: number;
  updatedAt: string;
}

export interface AnalysisSession {
  id: string;
  title: string;
  question: string;
  result: string;
  model: string;
  provider?: 'google' | 'anthropic';
  snapshotHash?: string;
  updatedAt: string;
  createdAt?: string;
}

export interface PortfolioSnapshot {
  owner: string;
  baseCurrency: string;
  totalValue: number;
  totalCost: number;
  lastUpdatedAt: string;
  holdings: Holding[];
  performanceHistory: PortfolioPerformancePoint[];
  allocations: AllocationSlice[];
  insights: Insight[];
  importJobs: ImportJob[];
  analysisSessions: AnalysisSession[];
  prompts: string[];
}
