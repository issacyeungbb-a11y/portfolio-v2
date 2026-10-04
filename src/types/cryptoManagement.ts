export interface CryptoCoin {
  symbol: string;
  name: string;
  priceSource: 'coingecko' | 'manual';
  priceSourceId: string;
  manualPriceUsd: number | null;
  manualPriceAt: string | null;
}
export type CryptoAssetStatus = '可用' | '鎖定(質押)' | '鎖定(抵押)' | '質押所賺';
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
  platforms?: string[];
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

export type CryptoMovementType = 'buy' | 'sell' | 'transfer' | 'transfer_in' | 'transfer_out' | 'stake' | 'unstake' | 'staking_reward' | 'collateral_lock' | 'collateral_unlock';
export interface CryptoMovementInput {
  type: CryptoMovementType;
  date: string;
  symbol: string;
  quantity: number;
  sourcePositionId?: string;
  destinationPositionId?: string;
  destination?: { custodian: string; status: CryptoAssetStatus; network: string };
  counterparty?: string;
  unitPrice?: number;
  fees?: number;
  quoteCurrency?: string;
  settlementPositionId?: string;
  note: string;
}
export interface CryptoMovementLeg {
  positionId: string;
  symbol: string;
  custodian: string;
  status: string;
  network: string;
  delta: number;
  before: number;
  after: number;
}
export interface CryptoMovementEntry extends CryptoMovementInput {
  id: string;
  createdAt: string;
  version: number;
  legs: CryptoMovementLeg[];
  totalAmount: number | null;
  sourceLabel: string;
  destinationLabel: string;
  sourceCustodian: string;
  destinationCustodian: string;
}
export interface CryptoMovementHistory {
  entries: CryptoMovementEntry[];
  nextCursor: { createdAt: string; id: string } | null;
  opening: { at: string; version: number; positions: CryptoPosition[] } | null;
}
