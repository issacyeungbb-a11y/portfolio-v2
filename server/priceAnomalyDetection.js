import { getFirebaseAdminDb } from "./firebaseAdmin.js";
const REVIEW_THRESHOLDS = {
  stock: 2,
  // 200% — allow high-volatility days and corporate actions to auto-update
  etf: 2,
  bond: 2,
  crypto: 5,
  // 500% — crypto can reprice violently; only block extreme data errors
  cash: Number.POSITIVE_INFINITY
};
const WARNING_THRESHOLDS = {
  stock: 0.2,
  // 20%
  etf: 0.2,
  bond: 0.1,
  // bonds rarely move >10% intraday — worth flagging
  crypto: 0.3,
  // 30%
  cash: Number.POSITIVE_INFINITY
};
function getAnomalyThreshold(assetType) {
  return REVIEW_THRESHOLDS[assetType] ?? REVIEW_THRESHOLDS.stock;
}
function getWarningThreshold(assetType) {
  return WARNING_THRESHOLDS[assetType] ?? WARNING_THRESHOLDS.stock;
}
function deriveHistoricalPriceAmplitudes(prices) {
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
function detectPriceAnomaly(currentPrice, newPrice, assetType) {
  const threshold = getAnomalyThreshold(assetType);
  const warnThreshold = getWarningThreshold(assetType);
  if (currentPrice <= 0 || newPrice <= 0) {
    return {
      isAnomaly: false,
      diffPct: 0,
      diffPctDisplay: "0.0%",
      threshold,
      level: "ok"
    };
  }
  const diffPct = Math.abs(newPrice - currentPrice) / currentPrice;
  const isAnomaly = diffPct >= threshold;
  const level = isAnomaly ? "critical" : diffPct >= warnThreshold ? "warning" : "ok";
  return {
    isAnomaly,
    diffPct,
    diffPctDisplay: `${(diffPct * 100).toFixed(1)}%`,
    threshold,
    level
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
  return {
    mean,
    stdDev: Math.sqrt(variance),
    min,
    max
  };
}
function buildInsufficientHistoryReason(sampleSize, minSampleSize) {
  return `\u6B77\u53F2\u50F9\u683C\u6A23\u672C\u4E0D\u8DB3\uFF08${sampleSize}/${minSampleSize}\uFF09`;
}
async function detectHistoricalAnomaly(assetId, newPrice, currentPrice, options = {}) {
  const limit = options.limit ?? 30;
  const minSampleSize = options.minSampleSize ?? 5;
  const todayDiffPct = currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0 ? Math.abs(newPrice - currentPrice) / currentPrice : null;
  if (!assetId || !Number.isFinite(newPrice) || newPrice <= 0) {
    return {
      isAnomaly: false,
      reason: null,
      sampleSize: 0,
      mean: null,
      stdDev: null,
      min: null,
      max: null,
      zScore: null
    };
  }
  if (todayDiffPct != null && todayDiffPct < 0.1) {
    return {
      isAnomaly: false,
      reason: null,
      sampleSize: 0,
      mean: null,
      stdDev: null,
      min: null,
      max: null,
      zScore: null
    };
  }
  try {
    const db = getFirebaseAdminDb();
    const snapshot = await db.collection("portfolio").doc("app").collection("assets").doc(assetId).collection("priceHistory").orderBy("recordedAt", "desc").limit(limit).get();
    const prices = snapshot.docs.map((document) => document.data().price).filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
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
        zScore: null
      };
    }
    const zScore = stats.stdDev && stats.stdDev > 0 ? (todayDiffPct - stats.mean) / stats.stdDev : null;
    const minGuard = todayDiffPct < stats.min * 0.1;
    const maxGuard = todayDiffPct > stats.max * 10;
    const zGuard = zScore != null && Math.abs(zScore) > 3;
    const isAnomaly = minGuard || maxGuard || zGuard;
    return {
      isAnomaly,
      reason: isAnomaly ? `\u6B77\u53F2\u50F9\u683C\u7570\u5E38\uFF1A${minGuard ? "\u4F4E\u65BC\u6B77\u53F2\u6700\u5C0F\u6CE2\u5E45 90%" : maxGuard ? "\u9AD8\u65BC\u6B77\u53F2\u6700\u5927\u6CE2\u5E45 10 \u500D" : "z-score \u8D85\u904E 3"}` : null,
      sampleSize: historicalAmplitudes.length,
      mean: stats.mean,
      stdDev: stats.stdDev,
      min: stats.min,
      max: stats.max,
      zScore
    };
  } catch (error) {
    console.warn("[priceAnomalyDetection] historical anomaly lookup failed", {
      assetId,
      error
    });
    return {
      isAnomaly: false,
      reason: "\u6B77\u53F2\u50F9\u683C\u67E5\u8A62\u5931\u6557",
      sampleSize: 0,
      mean: null,
      stdDev: null,
      min: null,
      max: null,
      zScore: null
    };
  }
}
export {
  REVIEW_THRESHOLDS,
  WARNING_THRESHOLDS,
  deriveHistoricalPriceAmplitudes,
  detectHistoricalAnomaly,
  detectPriceAnomaly,
  getAnomalyThreshold,
  getWarningThreshold
};
