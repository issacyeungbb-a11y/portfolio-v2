export interface CryptoCoin {
  symbol: string;
  name: string;
  priceSource: 'coingecko' | 'manual';
  priceSourceId: string;
  manualPriceUsd: number | null;
  manualPriceAt: string | null;
}
export interface CryptoPosition {
  id: string;
  symbol: string;
  custodian: string;
  quantity: number;
  status: string;
  network: string;
  collateralSymbol: string;
}
export interface CryptoFunding {
  id: string;
  date: string;
  source: string;
  type: 'deposit' | 'withdrawal' | 'adjustment';
  hkd: number;
  usd: number;
}
export interface CryptoManagementState {
  version: number;
  migratedAt: string;
  sourceChecksum: string;
  coins: CryptoCoin[];
  positions: CryptoPosition[];
  liabilities: CryptoPosition[];
  funding: CryptoFunding[];
}
export interface CryptoValuation {
  quantities: Record<string, number>;
  prices: Record<string, number | null>;
  warnings: string[];
  grossUsd: number;
  debtUsd: number;
  netUsd: number;
  principalHkd: number;
  withdrawnUsd: number;
}
export interface CryptoManagementResponse {
  draft?: { month: string; warnings: string[]; updatedAt: string } | null;
  state: CryptoManagementState | null;
  valuation: CryptoValuation | null;
  audit: Array<{ id: string; action: string; reason: string; at: string; version: number }>;
  sourceArchive: Array<{ id: string; title: string; rows: number }>;
}
