// AUTO-GENERATED local dev runtime for server/priceAnomalyDetection.ts
// Do NOT edit directly — edit the .ts source instead.

export const REVIEW_THRESHOLDS = {
  stock: 0.5,
  etf:   0.5,
  bond:  0.5,
  crypto: 0.8,
  cash:  Number.POSITIVE_INFINITY,
};

export const WARNING_THRESHOLDS = {
  stock: 0.2,
  etf:   0.2,
  bond:  0.1,
  crypto: 0.3,
  cash:  Number.POSITIVE_INFINITY,
};

export function getAnomalyThreshold(assetType) {
  return REVIEW_THRESHOLDS[assetType] ?? REVIEW_THRESHOLDS.stock;
}

export function getWarningThreshold(assetType) {
  return WARNING_THRESHOLDS[assetType] ?? WARNING_THRESHOLDS.stock;
}

export function deriveHistoricalPriceAmplitudes(prices) {
  const amplitudes = [];
  for (let index = 1; index < prices.length; index += 1) {
    const previousPrice = prices[index - 1];
    const currentPrice = prices[index];
    if (previousPrice > 0 && currentPrice > 0) {
      amplitudes.push(Math.abs(currentPrice - previousPrice) / previousPrice);
    }
  }
  return amplitudes;
}

export function detectPriceAnomaly(currentPrice, newPrice, assetType) {
  const threshold = getAnomalyThreshold(assetType);
  const warnThreshold = getWarningThreshold(assetType);

  if (currentPrice <= 0 || newPrice <= 0) {
    return { isAnomaly: false, diffPct: 0, diffPctDisplay: '0.0%', threshold, level: 'ok' };
  }

  const diffPct = Math.abs(newPrice - currentPrice) / currentPrice;
  const isAnomaly = diffPct >= threshold;
  const level = isAnomaly ? 'critical' : diffPct >= warnThreshold ? 'warning' : 'ok';

  return {
    isAnomaly,
    diffPct,
    diffPctDisplay: `${(diffPct * 100).toFixed(1)}%`,
    threshold,
    level,
  };
}

function computeStats(values) {
  if (values.length === 0) {
    return { mean: null, stdDev: null, min: null, max: null };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const mean = sum / values.length;
  const variance = values.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance), min, max };
}

function buildInsufficientHistoryReason(sampleSize, minSampleSize) {
  return `歷史價格樣本不足（${sampleSize}/${minSampleSize}）`;
}

export async function detectHistoricalAnomaly(assetId, newPrice, currentPrice, options = {}) {
  const limit = options.limit ?? 30;
  const minSampleSize = options.minSampleSize ?? 5;
  const todayDiffPct = currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0
    ? Math.abs(newPrice - currentPrice) / currentPrice
    : null;
  if (!assetId || !Number.isFinite(newPrice) || newPrice <= 0) {
    return {
      isAnomaly: false, reason: null, sampleSize: 0, mean: null, stdDev: null, min: null, max: null, zScore: null,
    };
  }
  if (todayDiffPct != null && todayDiffPct < 0.1) {
    return {
      isAnomaly: false, reason: null, sampleSize: 0, mean: null, stdDev: null, min: null, max: null, zScore: null,
    };
  }
  try {
    const db = getFirebaseAdminDb();
    const snapshot = await db
      .collection('portfolio').doc('app')
      .collection('assets').doc(assetId)
      .collection('priceHistory')
      .orderBy('recordedAt', 'desc')
      .limit(limit)
      .get();
    const prices = snapshot.docs
      .map((document) => document.data().price)
      .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const historicalAmplitudes = deriveHistoricalPriceAmplitudes(prices.slice().reverse());
    const stats = computeStats(historicalAmplitudes);
    if (historicalAmplitudes.length < minSampleSize || stats.mean == null || stats.min == null || stats.max == null || todayDiffPct == null) {
      return {
        isAnomaly: false,
        reason: buildInsufficientHistoryReason(historicalAmplitudes.length, minSampleSize),
        sampleSize: historicalAmplitudes.length,
        mean: stats.mean,
        stdDev: stats.stdDev,
        min: stats.min,
        max: stats.max,
        zScore: null,
      };
    }
    const zScore = stats.stdDev && stats.stdDev > 0 ? (todayDiffPct - stats.mean) / stats.stdDev : null;
    const minGuard = todayDiffPct < stats.min * 0.1;
    const maxGuard = todayDiffPct > stats.max * 10;
    const zGuard = zScore != null && Math.abs(zScore) > 3;
    const isAnomaly = minGuard || maxGuard || zGuard;
    return {
      isAnomaly,
      reason: isAnomaly ? `歷史價格異常：${minGuard ? '低於歷史最小波幅 90%' : maxGuard ? '高於歷史最大波幅 10 倍' : 'z-score 超過 3'}` : null,
      sampleSize: historicalAmplitudes.length,
      mean: stats.mean,
      stdDev: stats.stdDev,
      min: stats.min,
      max: stats.max,
      zScore,
    };
  } catch (error) {
    console.warn('[priceAnomalyDetection] historical anomaly lookup failed', {
      assetId,
      error,
    });
    return {
      isAnomaly: false,
      reason: '歷史價格查詢失敗',
      sampleSize: 0,
      mean: null,
      stdDev: null,
      min: null,
      max: null,
      zScore: null,
    };
  }
}
import { getFirebaseAdminDb } from './firebaseAdmin.js';
