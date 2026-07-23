export type CryptoDataQuality = 'verified' | 'partial' | 'attention';
export type CryptoWarningSeverity = 'info' | 'warning' | 'error';

export interface CryptoHistoryWarning {
  code: string;
  message: string;
  severity: CryptoWarningSeverity;
}

export interface CryptoHistoricalHolding {
  rawLabel: string;
  normalizedLabel: string;
  valueUsd: number;
}

export interface CryptoHistoricalQuantity {
  rawLabel: string;
  symbol: string;
  platform: string | null;
  quantity: number;
}

export interface CryptoHistoricalPrice {
  rawLabel: string;
  symbol: string;
  priceUsd: number;
}

export interface CryptoHistoricalLiability {
  assetId?: string;
  symbol?: string;
  platform?: string;
  quantity?: number;
  network?: string;
  associatedCollateralAssetId?: string;
}

export interface CryptoAllocations {
  BTC?: number;
  ETH?: number;
  ADA?: number;
  USDT?: number;
  OTHER?: number;
}

export interface CryptoMonthlySnapshot {
  id: string;
  month: string;
  snapshotDate: string;
  snapshotTimestamp: string;
  locked: boolean;
  currentNetUsd: number;
  cumulativeWithdrawnUsd: number;
  performanceTotalUsd: number;
  totalHkd: number;
  btcEquivalent: number | null;
  principalHkd: number;
  returnHkd: number;
  returnPct: number;
  monthOverMonthPct: number | null;
  usdHkdRate: number;
  allocations: CryptoAllocations;
  historicalHoldings: CryptoHistoricalHolding[];
  historicalQuantities: CryptoHistoricalQuantity[];
  prices: CryptoHistoricalPrice[];
  liabilities: CryptoHistoricalLiability[];
  sourceSpreadsheetId: string;
  sourceSpreadsheetTitle: string;
  sourceSheet: string;
  sourceRange: string;
  sourceType: 'legacy_year_sheet' | 'locked_month_log' | string;
  importBatchId: string;
  importedAt: string;
  updatedAt: string;
  sourceChecksum: string;
  dataQuality: CryptoDataQuality;
  warnings: CryptoHistoryWarning[];
  rawSourceValues: Record<string, unknown>;
}

export interface CryptoHistoricalImport {
  id: string;
  importBatchId: string;
  sourceSpreadsheetId: string;
  sourceSpreadsheetTitle: string;
  sourceSheets: string[];
  sourceType: string;
  status: string;
  successMonthCount: number;
  createdMonthCount: number;
  skippedDuplicateMonthCount: number;
  warningCount: number;
  warningSummary: Record<string, number>;
  firstMonth: string;
  lastMonth: string;
  batchChecksum: string;
  validationPassed: boolean;
  sourceReadOnly: boolean;
  importedAt: string;
  updatedAt: string;
}
