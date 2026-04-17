/**
 * P2-1: Price anomaly detection — centralised thresholds and structured anomaly check.
 *
 * Previously, diff thresholds were scattered as local constants inside updatePrices.ts.
 * This module makes them explicit, testable, and reusable across the pipeline.
 *
 * Threshold semantics:
 *   REVIEW_THRESHOLD  — price change >= this → failureCategory = 'diff_too_large', held for manual review
 *   WARNING_THRESHOLD — price change >= this → level = 'warning' (logged, not blocked)
 *
 * Both thresholds are expressed as a fraction of the current price (0.0 – 1.0).
 */

export type AnomalyLevel = 'ok' | 'warning' | 'critical';

export interface AnomalyCheckResult {
  /** true when the change exceeds REVIEW_THRESHOLD — the price update is blocked */
  isAnomaly: boolean;
  /** absolute relative change: |newPrice - currentPrice| / currentPrice */
  diffPct: number;
  /** human-readable diffPct, e.g. "23.5%" */
  diffPctDisplay: string;
  /** the REVIEW_THRESHOLD used for this asset type */
  threshold: number;
  /** 'ok' | 'warning' (≥ WARNING_THRESHOLD) | 'critical' (≥ REVIEW_THRESHOLD) */
  level: AnomalyLevel;
}

/**
 * A price change >= REVIEW_THRESHOLD blocks the update and creates a pending review.
 * These values mirror DEFAULT_STOCK_DIFF_THRESHOLD / DEFAULT_CRYPTO_DIFF_THRESHOLD
 * that were previously embedded in updatePrices.ts.
 */
export const REVIEW_THRESHOLDS: Record<string, number> = {
  stock: 0.5,   // 50% — covers stock splits, rights issues, circuit-breaker reopens
  etf:   0.5,
  bond:  0.5,
  crypto: 0.8,  // 80% — crypto can move 50%+ in hours; only flag extreme moves
  cash:  Number.POSITIVE_INFINITY,
};

/**
 * A price change >= WARNING_THRESHOLD is logged at warn level but does NOT block.
 * Useful for early-warning dashboards without creating noise in the review queue.
 */
export const WARNING_THRESHOLDS: Record<string, number> = {
  stock: 0.2,   // 20%
  etf:   0.2,
  bond:  0.1,   // bonds rarely move >10% intraday — worth flagging
  crypto: 0.3,  // 30%
  cash:  Number.POSITIVE_INFINITY,
};

export function getAnomalyThreshold(assetType: string): number {
  return REVIEW_THRESHOLDS[assetType] ?? REVIEW_THRESHOLDS.stock;
}

export function getWarningThreshold(assetType: string): number {
  return WARNING_THRESHOLDS[assetType] ?? WARNING_THRESHOLDS.stock;
}

/**
 * Checks whether a new price constitutes an anomaly relative to the current price.
 * Returns a structured result usable for both blocking decisions and logging.
 *
 * @param currentPrice  The stored price before this update (must be > 0 to be meaningful)
 * @param newPrice      The candidate price from the data source
 * @param assetType     Asset type string ('stock', 'etf', 'crypto', etc.)
 */
export function detectPriceAnomaly(
  currentPrice: number,
  newPrice: number,
  assetType: string,
): AnomalyCheckResult {
  const threshold = getAnomalyThreshold(assetType);
  const warnThreshold = getWarningThreshold(assetType);

  if (currentPrice <= 0 || newPrice <= 0) {
    return {
      isAnomaly: false,
      diffPct: 0,
      diffPctDisplay: '0.0%',
      threshold,
      level: 'ok',
    };
  }

  const diffPct = Math.abs(newPrice - currentPrice) / currentPrice;
  const isAnomaly = diffPct >= threshold;
  const level: AnomalyLevel = isAnomaly ? 'critical' : diffPct >= warnThreshold ? 'warning' : 'ok';

  return {
    isAnomaly,
    diffPct,
    diffPctDisplay: `${(diffPct * 100).toFixed(1)}%`,
    threshold,
    level,
  };
}
