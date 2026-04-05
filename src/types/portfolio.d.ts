export type AssetType = 'stock' | 'etf' | 'bond' | 'crypto' | 'cash';
export type AccountSource = 'Futu' | 'IB' | 'Crypto' | 'Other';
export type PerformanceRange = '7d' | '30d' | '6m' | '1y';
export type DisplayCurrency = 'HKD' | 'USD' | 'JPY';
export type AllocationBucketKey = AssetType;
export type InsightTone = 'positive' | 'neutral' | 'caution';
export type ImportStatus = 'completed' | 'processing' | 'review';
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
}
export interface AccountPrincipalEntry {
    accountSource: AccountSource;
    principalAmount: number;
    currency: string;
    updatedAt?: string;
}
export interface PortfolioPerformancePoint {
    date: string;
    totalValue: number;
    netExternalFlow: number;
}
export interface PortfolioPerformanceSummary {
    range: PerformanceRange;
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
    updatedAt: string;
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
