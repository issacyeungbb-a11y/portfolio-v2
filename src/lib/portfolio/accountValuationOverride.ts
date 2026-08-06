export interface AccountValuationOverride {
  accountSource: 'Crypto';
  active: boolean;
  month: string;
  targetTotalUsd: number;
  targetTotalHkd: number;
  usdHkdRate: number;
  sourceSnapshotId: string;
  sourceChecksum: string;
  shadowChecksum: string;
  applicationMode: 'proportional_account_overlay';
}

export interface ValuationInput {
  accountSource: string;
  assetType: string;
  currency: string;
  quantity: number;
  currentPrice: number;
}

export interface AppliedAccountValuationOverride<T> {
  assets: T[];
  applied: boolean;
  accountSource: string;
  assetCount: number;
  baseTotalUsd: number;
  targetTotalUsd: number;
  scaleFactor: number;
}

const MONEY_TOLERANCE_USD = 0.01;

function localValue(asset: ValuationInput) {
  return asset.assetType === 'cash'
    ? asset.currentPrice
    : asset.quantity * asset.currentPrice;
}

function toUsd(asset: ValuationInput, usdHkdRate: number) {
  const currency = asset.currency.trim().toUpperCase();
  const value = localValue(asset);
  if (currency === 'HKD') return value / usdHkdRate;
  if (currency === 'USD' || currency === 'USDT' || currency === 'USDC') return value;
  return null;
}

export function normalizeAccountValuationOverride(
  value: Record<string, unknown> | null | undefined,
): AccountValuationOverride | null {
  if (
    !value ||
    value.accountSource !== 'Crypto' ||
    value.active !== true ||
    typeof value.month !== 'string' ||
    !/^\d{4}-\d{2}$/.test(value.month) ||
    typeof value.targetTotalUsd !== 'number' ||
    !Number.isFinite(value.targetTotalUsd) ||
    value.targetTotalUsd <= 0 ||
    typeof value.targetTotalHkd !== 'number' ||
    !Number.isFinite(value.targetTotalHkd) ||
    value.targetTotalHkd <= 0 ||
    typeof value.usdHkdRate !== 'number' ||
    !Number.isFinite(value.usdHkdRate) ||
    value.usdHkdRate <= 0 ||
    typeof value.sourceSnapshotId !== 'string' ||
    typeof value.sourceChecksum !== 'string' ||
    typeof value.shadowChecksum !== 'string' ||
    value.applicationMode !== 'proportional_account_overlay'
  ) {
    return null;
  }

  if (Math.abs(value.targetTotalUsd * value.usdHkdRate - value.targetTotalHkd) > 1) {
    return null;
  }

  return value as unknown as AccountValuationOverride;
}

/**
 * Applies one account-level monthly total without changing persisted holdings,
 * quantities, cost basis, transactions, or any other account. The same factor
 * is applied to every current valuation inside the target account, preserving
 * its relative composition while making all existing portfolio calculations
 * reconcile to the locked monthly total.
 */
export function applyAccountValuationOverride<T extends ValuationInput>(
  assets: T[],
  override: AccountValuationOverride | null,
): AppliedAccountValuationOverride<T> {
  if (!override) {
    return {
      assets,
      applied: false,
      accountSource: '',
      assetCount: 0,
      baseTotalUsd: 0,
      targetTotalUsd: 0,
      scaleFactor: 1,
    };
  }

  const accountAssets = assets.filter(
    (asset) => asset.accountSource === override.accountSource,
  );
  const unsupportedCurrencies = accountAssets
    .filter((asset) => toUsd(asset, override.usdHkdRate) == null)
    .map((asset) => asset.currency);

  if (unsupportedCurrencies.length > 0) {
    throw new Error(
      `Crypto 月結估值覆蓋遇到未支援貨幣：${[...new Set(unsupportedCurrencies)].join('、')}`,
    );
  }

  const baseTotalUsd = accountAssets.reduce(
    (sum, asset) => sum + (toUsd(asset, override.usdHkdRate) ?? 0),
    0,
  );
  if (!(baseTotalUsd > MONEY_TOLERANCE_USD)) {
    throw new Error('Crypto 帳戶現值為 0，無法安全套用月結估值覆蓋。');
  }

  const scaleFactor = override.targetTotalUsd / baseTotalUsd;
  const scaledAssets = assets.map((asset) =>
    asset.accountSource === override.accountSource
      ? { ...asset, currentPrice: asset.currentPrice * scaleFactor }
      : asset,
  );

  return {
    assets: scaledAssets,
    applied: true,
    accountSource: override.accountSource,
    assetCount: accountAssets.length,
    baseTotalUsd,
    targetTotalUsd: override.targetTotalUsd,
    scaleFactor,
  };
}
