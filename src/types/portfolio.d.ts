export type AssetType = 'stock' | 'etf' | 'bond' | 'crypto' | 'cash';
export type AccountSource = 'Futu' | 'IB' | 'Crypto' | 'Other';
export type PerformanceRange = '7d' | '30d' | '6m' | '1y';
export type DisplayCurrency = 'HKD' | 'USD' | 'JPY';
export type AllocationBucketKey = AssetType;
export type InsightTone = 'positive' | 'neutral' | 'caution';
export type ImportStatus = 'completed' | 'processing' | 'review';
export type AccountCashFlowType = 'deposit' | 'withdrawal' | 'adjustment';
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
export interface SnapshotFxRatesUsed {
    USD?: number;
    JPY?: number;
    HKD?: number;
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
    priceAsOf?: string;
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
export interface PortfolioPerformancePoint {
    id?: string;
    date: string;
    capturedAt?: string;
    totalValue: number;
    netExternalFlow: number;
    assetCount?: number;
    holdings?: SnapshotHoldingPoint[];
    reason?: 'daily_snapshot' | 'daily_snapshot_fallback';
    snapshotQuality?: 'strict' | 'fallback';
    coveragePct?: number;
    fallbackAssetCount?: number;
    missingAssetCount?: number;
    fxSource?: 'cron_pipeline' | 'persisted' | 'live' | 'unknown';
    fxRatesUsed?: SnapshotFxRatesUsed;
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
    category?: 'asset_analysis' | 'general_question' | 'asset_report';
    title: string;
    question: string;
    result: string;
    model: string;
    provider?: 'google' | 'anthropic';
    snapshotHash?: string;
    delivery?: 'manual' | 'scheduled';
    allocationSummary?: ReportAllocationSummary;
    reportFactsPayload?: ReportFactsPayload;
    updatedAt: string;
    createdAt?: string;
}
export interface ReportAllocationSliceSummary {
    key: AssetType;
    label: string;
    color: string;
    percentage: number;
    totalValueHKD: number;
    totalValueUSD: number;
}
export interface ReportAllocationSummary {
    asOfDate: string;
    basis: 'monthly' | 'quarterly';
    comparisonLabel?: string;
    styleTag: '平衡型' | '進攻型' | '防守型' | '高集中型';
    warningTags: string[];
    dominantBucketKey?: AssetType;
    slices: ReportAllocationSliceSummary[];
    deltas?: Array<{
        key: AssetType;
        deltaPercentagePoints: number;
    }>;
    totalValueHKD?: number;
    summarySentence?: string;
}
export interface ReportDataQualitySummary {
    status: 'ok' | 'partial' | 'warning';
    coveragePct?: number;
    staleAssetCount: number;
    fallbackAssetCount?: number;
    missingAssetCount?: number;
    fxSource?: 'cron_pipeline' | 'persisted' | 'live' | 'unknown';
    fxRatesUsed?: SnapshotFxRatesUsed;
    oldestPriceAsOf?: string;
    warningMessages: string[];
}
export interface ReportFactsPayload {
    generatedAt: string;
    reportType: 'monthly' | 'quarterly';
    periodStartDate: string;
    periodEndDate: string;
    baselineSnapshotId?: string;
    baselineSnapshotDate?: string;
    currentSnapshotDate: string;
    totalValueHKD: number;
    totalCostHKD: number;
    netExternalFlowHKD?: number;
    investmentGainHKD?: number;
    investmentGainPercent?: number;
    fxRatesUsed?: SnapshotFxRatesUsed;
    fxSource?: 'cron_pipeline' | 'persisted' | 'live' | 'unknown';
    dataQualitySummary: ReportDataQualitySummary;
    topHoldingsByHKD: Array<{
        ticker: string;
        name: string;
        currency: string;
        marketValueHKD: number;
        marketValueLocal?: number;
    }>;
    allocationByType: ReportAllocationSummary['slices'];
    allocationByCurrency: Array<{
        currency: string;
        percentage: number;
        totalValueHKD: number;
    }>;
    model: string;
    provider: 'google' | 'anthropic';
    snapshotHash: string;
    promptVersion: string;
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
