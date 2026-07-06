import { getFirebaseAdminDb } from "./firebaseAdmin.js";
import { captureAdminPortfolioSnapshot, readAdminPortfolioAssets, readPersistedFxRates } from "./portfolioSnapshotAdmin.js";
import { fetchLiveFxRates } from "./updatePrices.js";
import { verifyCronRequest } from "./cronAuth.js";
import { SNAPSHOT_FALLBACK_WINDOW_MS } from "./priceFreshness.js";
import { updateSnapshotStatus } from "./dailyJobs.js";
const CRON_ROUTE = "/api/cron-daily-update";
const MANUAL_ROUTE = "/api/manual-capture-snapshot";
class CronSnapshotError extends Error {
  status;
  constructor(message, status = 500) {
    super(message);
    this.name = "CronSnapshotError";
    this.status = status;
  }
}
function buildDailySnapshotId(date = /* @__PURE__ */ new Date()) {
  const hkDate = getHongKongDateKey(date);
  return `daily-${hkDate}`;
}
function getHongKongDateKey(date = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
function getHongKongDateKeyFromTimestamp(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "";
  }
  return getHongKongDateKey(value);
}
function getHoursSinceUpdate(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (Date.now() - date.getTime()) / (1e3 * 60 * 60));
}
function isFallbackUsable(asset, todayKey) {
  if (!asset.currentPrice || asset.currentPrice <= 0) {
    return false;
  }
  const lastUpdated = asset.lastPriceUpdatedAt ? new Date(asset.lastPriceUpdatedAt) : void 0;
  const updatedKey = getHongKongDateKeyFromTimestamp(lastUpdated);
  if (updatedKey === todayKey) {
    return true;
  }
  const windowHours = (SNAPSHOT_FALLBACK_WINDOW_MS[asset.assetType] ?? SNAPSHOT_FALLBACK_WINDOW_MS.stock) / (60 * 60 * 1e3);
  const hoursSinceUpdate = getHoursSinceUpdate(asset.lastPriceUpdatedAt);
  return hoursSinceUpdate <= windowHours;
}
function sanitizeFailureCategory(value) {
  if (value === "ticker_format" || value === "quote_time" || value === "source_missing" || value === "response_format" || value === "price_missing" || value === "confidence_low" || value === "diff_too_large" || value === "unknown") {
    return value;
  }
  return "unknown";
}
function isSoftPendingCategory(category) {
  return category === "quote_time" || category === "source_missing" || category === "response_format" || category === "price_missing" || category === "confidence_low" || category === "diff_too_large";
}
function parseReviewUpdatedAt(value) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    const parsed = value.toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
function createSnapshotStepTimings() {
  return {
    readinessMs: 0,
    snapshotWriteMs: 0
  };
}
function buildSnapshotReadinessSummary(readiness) {
  const hardPendingTolerance = Math.max(2, Math.floor(readiness.totalAssets * 0.05));
  return {
    totalAssets: readiness.totalAssets,
    nonCashAssets: readiness.totalAssets,
    readyAssets: readiness.readyAssets,
    staleAssetCount: readiness.staleAssets.length,
    fallbackAssetCount: readiness.fallbackAssetCount,
    missingAssetCount: readiness.missingAssetCount,
    coveragePct: readiness.coveragePct,
    pendingReviewCount: readiness.pendingReviewCount,
    softPendingReviewCount: readiness.softPendingReviewCount,
    hardPendingReviewCount: readiness.hardPendingReviewCount,
    hardPendingTolerance,
    isReady: readiness.isReady,
    canUseFallback: readiness.canUseFallback,
    valueWeightedHighRisk: readiness.valueWeightedHighRisk,
    staleValuePct: readiness.staleValuePct,
    largestStaleAssetSymbol: readiness.largestStaleAssetSymbol,
    largestStaleAssetPct: readiness.largestStaleAssetPct,
    valueWeightedGuardUnavailable: readiness.valueWeightedGuardUnavailable
  };
}
function getSnapshotSkipReason(readiness, captureSkipped, existingSnapshotAlreadyDone = false) {
  if (existingSnapshotAlreadyDone) {
    return "snapshot_already_done";
  }
  if (captureSkipped) {
    return "snapshot_already_exists";
  }
  if (!readiness.isReady) {
    return readiness.canUseFallback ? "readiness_not_met" : "fallback_not_allowed";
  }
  return null;
}
function getDurationMs(startedAt) {
  return Date.now() - startedAt;
}
async function verifyAssetsReadyForDailySnapshot(preloadedAssets, fxRates) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection("portfolio").doc("app");
  const assets = preloadedAssets ?? await readAdminPortfolioAssets();
  const reviewSnapshot = await portfolioRef.collection("priceUpdateReviews").where("status", "==", "pending").get();
  const todayKey = getHongKongDateKey();
  const nonCashAssets = assets.filter((asset) => asset.assetType !== "cash");
  const staleAssets = nonCashAssets.filter((asset) => {
    const lastUpdated = asset.lastPriceUpdatedAt ? new Date(asset.lastPriceUpdatedAt) : void 0;
    const updatedKey = getHongKongDateKeyFromTimestamp(lastUpdated);
    return !asset.currentPrice || updatedKey !== todayKey;
  });
  const fallbackAssets = staleAssets.filter((asset) => isFallbackUsable(asset, todayKey));
  const missingAssets = staleAssets.filter((asset) => !isFallbackUsable(asset, todayKey));
  const pendingReviews = reviewSnapshot.docs.map((document) => {
    const data = document.data();
    return {
      assetId: document.id,
      failureCategory: sanitizeFailureCategory(data.failureCategory),
      updatedAt: parseReviewUpdatedAt(data.updatedAt)
    };
  });
  const fallbackAssetIds = new Set(fallbackAssets.map((asset) => asset.id));
  const hardPendingReviews = pendingReviews.filter((review) => {
    if (review.failureCategory === "diff_too_large" && review.updatedAt && Date.now() - review.updatedAt.getTime() > 7 * 24 * 60 * 60 * 1e3) {
      return false;
    }
    if (!isSoftPendingCategory(review.failureCategory)) {
      return true;
    }
    return !fallbackAssetIds.has(review.assetId);
  });
  const softPendingReviews = pendingReviews.filter((review) => !hardPendingReviews.includes(review));
  const coveragePct = nonCashAssets.length === 0 ? 100 : Math.round((nonCashAssets.length - missingAssets.length) / nonCashAssets.length * 100);
  const hardPendingTolerance = Math.max(2, Math.floor(nonCashAssets.length * 0.05));
  let resolvedFxRates = fxRates;
  let valueWeightedGuardUnavailable = false;
  if (!resolvedFxRates) {
    resolvedFxRates = await readPersistedFxRates() ?? void 0;
    if (!resolvedFxRates) {
      try {
        resolvedFxRates = await fetchLiveFxRates();
      } catch {
        valueWeightedGuardUnavailable = true;
      }
    }
  }
  let valueWeightedHighRisk = false;
  let staleValuePct = 0;
  let largestStaleAssetSymbol;
  let largestStaleAssetPct;
  if (resolvedFxRates && nonCashAssets.length > 0) {
    const toHKD = (amount, currency) => {
      const cur = currency.trim().toUpperCase();
      if (cur === "HKD") return amount;
      if (cur === "USD") return amount * resolvedFxRates.USD;
      if (cur === "JPY") return amount * resolvedFxRates.JPY;
      return amount;
    };
    const totalHKD = nonCashAssets.reduce(
      (sum, a) => sum + toHKD(a.quantity * a.currentPrice, a.currency),
      0
    );
    if (totalHKD > 0) {
      const staleHKD = staleAssets.reduce(
        (sum, a) => sum + toHKD(a.quantity * a.currentPrice, a.currency),
        0
      );
      staleValuePct = Math.round(staleHKD / totalHKD * 100);
      if (staleValuePct > 20) {
        valueWeightedHighRisk = true;
      }
      let largestAssetHKD = 0;
      for (const asset of staleAssets) {
        const assetHKD = toHKD(asset.quantity * asset.currentPrice, asset.currency);
        if (assetHKD > largestAssetHKD) {
          largestAssetHKD = assetHKD;
          largestStaleAssetSymbol = asset.symbol;
          largestStaleAssetPct = Math.round(assetHKD / totalHKD * 100);
        }
        if (assetHKD / totalHKD > 0.15) {
          valueWeightedHighRisk = true;
        }
      }
    }
  }
  const canUseFallback = !valueWeightedHighRisk && !(valueWeightedGuardUnavailable && staleAssets.length > 0) && nonCashAssets.length > 0 && coveragePct >= 80 && hardPendingReviews.length <= hardPendingTolerance && (missingAssets.length <= 5 || coveragePct >= 80);
  return {
    todayKey,
    totalAssets: nonCashAssets.length,
    readyAssets: nonCashAssets.length - staleAssets.length,
    fallbackAssets,
    fallbackAssetCount: fallbackAssets.length,
    missingAssets,
    missingAssetCount: missingAssets.length,
    coveragePct,
    pendingReviewCount: reviewSnapshot.size,
    softPendingReviewCount: softPendingReviews.length,
    hardPendingReviewCount: hardPendingReviews.length,
    staleAssets,
    isReady: staleAssets.length === 0 && reviewSnapshot.empty,
    canUseFallback,
    valueWeightedHighRisk,
    staleValuePct,
    largestStaleAssetSymbol,
    largestStaleAssetPct,
    valueWeightedGuardUnavailable
  };
}
function verifySnapshotCronRequest(authorizationHeader) {
  try {
    verifyCronRequest(authorizationHeader);
  } catch (error) {
    if (error instanceof Error) {
      throw new CronSnapshotError(error.message, error.status ?? 401);
    }
    throw error;
  }
}
async function runScheduledDailySnapshot(fxRates, preloadedAssets) {
  return runDailySnapshotWorkflow("scheduled", fxRates, preloadedAssets);
}
async function runManualDailySnapshot(options = {}) {
  const startedAt = Date.now();
  const snapshotId = buildDailySnapshotId();
  const force = options.force === true;
  const db = getFirebaseAdminDb();
  const existingRef = db.collection("portfolio").doc("app").collection("portfolioSnapshots").doc(snapshotId);
  const existing = await existingRef.get();
  const existingQuality = existing.exists ? existing.data()?.snapshotQuality : void 0;
  if (existingQuality === "strict" && !force) {
    const payload = {
      ok: true,
      skipped: true,
      route: MANUAL_ROUTE,
      message: "\u4ECA\u65E5\u5DF2\u6709 strict \u54C1\u8CEA\u5FEB\u7167\uFF0C\u5514\u8986\u84CB\u3002\u5982\u9700\u5F37\u5236\u8986\u84CB\uFF0C\u8ACB\u5148\u522A\u9664\u73FE\u6709\u5FEB\u7167\u3002",
      snapshotId,
      reason: "strict_already_exists",
      triggeredAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: getDurationMs(startedAt)
    };
    console.info("[manual-capture-snapshot]", payload);
    return payload;
  }
  return runDailySnapshotWorkflow("manual", void 0, void 0, force);
}
async function runDailySnapshotWorkflow(mode, fxRates, preloadedAssets, force = false) {
  const startedAt = Date.now();
  const stepTimings = createSnapshotStepTimings();
  const readinessStartedAt = Date.now();
  const readiness = await verifyAssetsReadyForDailySnapshot(preloadedAssets, fxRates);
  const readinessSummary = buildSnapshotReadinessSummary(readiness);
  stepTimings.readinessMs = getDurationMs(readinessStartedAt);
  const snapshotReason = mode === "manual" ? "snapshot" : "daily_snapshot";
  const fallbackReason = mode === "manual" ? "snapshot" : "daily_snapshot_fallback";
  const route = mode === "manual" ? MANUAL_ROUTE : CRON_ROUTE;
  const logLabel = mode === "manual" ? "[manual-capture-snapshot]" : "[cron-daily-update/snapshot]";
  if (readiness.isReady) {
    const snapshotId = buildDailySnapshotId();
    const snapshotWriteStartedAt = Date.now();
    const result = await captureAdminPortfolioSnapshot({
      snapshotId,
      reason: snapshotReason,
      snapshotQuality: "strict",
      coveragePct: 100,
      fallbackAssetCount: 0,
      missingAssetCount: 0,
      fxRates,
      holdings: preloadedAssets,
      force
    });
    stepTimings.snapshotWriteMs = getDurationMs(snapshotWriteStartedAt);
    const durationMs2 = getDurationMs(startedAt);
    if (result.skipped) {
      await updateSnapshotStatus(readiness.todayKey, "skipped", {
        snapshotSkipReason: "snapshot_already_exists",
        snapshotReadinessSummary: readinessSummary
      });
      const payload3 = {
        ok: true,
        skipped: true,
        route,
        message: mode === "manual" ? "\u4ECA\u65E5\u5FEB\u7167\u5DF2\u5B58\u5728\uFF0C\u5514\u6703\u91CD\u8907\u88DC\u751F\u6210\u3002" : "\u4ECA\u65E5\u5FEB\u7167\u5DF2\u5B58\u5728\uFF0C\u5DF2\u7565\u904E\u91CD\u8907\u5BEB\u5165\u3002",
        snapshotId,
        reason: result.reason,
        snapshotSkipReason: "snapshot_already_exists",
        snapshotReadinessSummary: readinessSummary,
        triggeredAt: (/* @__PURE__ */ new Date()).toISOString(),
        durationMs: durationMs2,
        stepTimings
      };
      console.info(logLabel, payload3);
      return payload3;
    }
    const payload2 = {
      ok: true,
      route,
      message: mode === "manual" ? `\u5DF2\u88DC\u751F\u6210\u4ECA\u65E5\u8CC7\u7522\u5FEB\u7167\uFF0C\u8986\u84CB ${result.assetCount} \u9805\u8CC7\u7522\u3002` : `\u5DF2\u5EFA\u7ACB\u6BCF\u65E5\u8CC7\u7522\u5FEB\u7167\uFF0C\u8986\u84CB ${result.assetCount} \u9805\u8CC7\u7522\u3002`,
      assetCount: result.assetCount,
      totalValueHKD: result.totalValueHKD,
      snapshotId,
      snapshotQuality: "strict",
      coveragePct: 100,
      snapshotSkipReason: null,
      snapshotReadinessSummary: readinessSummary,
      triggeredAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: durationMs2,
      stepTimings
    };
    console.info(logLabel, payload2);
    return payload2;
  }
  if (readiness.canUseFallback) {
    const snapshotId = buildDailySnapshotId();
    const snapshotWriteStartedAt = Date.now();
    const result = await captureAdminPortfolioSnapshot({
      snapshotId,
      reason: fallbackReason,
      snapshotQuality: "fallback",
      coveragePct: readiness.coveragePct,
      fallbackAssetCount: readiness.fallbackAssetCount,
      missingAssetCount: readiness.missingAssetCount,
      fxRates,
      holdings: preloadedAssets,
      force
    });
    stepTimings.snapshotWriteMs = getDurationMs(snapshotWriteStartedAt);
    const durationMs2 = getDurationMs(startedAt);
    if (result.skipped) {
      await updateSnapshotStatus(readiness.todayKey, "skipped", {
        snapshotSkipReason: "snapshot_already_exists",
        snapshotReadinessSummary: readinessSummary
      });
      const payload3 = {
        ok: true,
        skipped: true,
        route,
        message: mode === "manual" ? "\u4ECA\u65E5\u5FEB\u7167\u5DF2\u5B58\u5728\uFF0C\u5514\u6703\u91CD\u8907\u88DC\u751F\u6210\u3002" : "\u4ECA\u65E5\u5FEB\u7167\u5DF2\u5B58\u5728\uFF0C\u5DF2\u7565\u904E\u91CD\u8907\u5BEB\u5165\u3002",
        snapshotId,
        reason: result.reason,
        snapshotSkipReason: "snapshot_already_exists",
        snapshotReadinessSummary: readinessSummary,
        triggeredAt: (/* @__PURE__ */ new Date()).toISOString(),
        durationMs: durationMs2,
        stepTimings
      };
      console.info(logLabel, payload3);
      return payload3;
    }
    const payload2 = {
      ok: true,
      route,
      message: mode === "manual" ? `\u5DF2\u88DC\u751F\u6210\u4ECA\u65E5\u5FEB\u7167\uFF08\u964D\u7D1A\uFF09\uFF1A\u8986\u84CB\u7387 ${readiness.coveragePct}%\uFF0C\u6CBF\u7528 ${readiness.fallbackAssetCount} \u9805\u6700\u8FD1\u6709\u6548\u50F9\u683C\u3002` : `\u5DF2\u5EFA\u7ACB\u964D\u7D1A\u6BCF\u65E5\u5FEB\u7167\uFF1A\u8986\u84CB\u7387 ${readiness.coveragePct}%\uFF0C\u6CBF\u7528 ${readiness.fallbackAssetCount} \u9805\u6700\u8FD1\u6709\u6548\u50F9\u683C\u3002`,
      assetCount: result.assetCount,
      totalValueHKD: result.totalValueHKD,
      snapshotId,
      snapshotQuality: "fallback",
      coveragePct: readiness.coveragePct,
      fallbackAssetCount: readiness.fallbackAssetCount,
      fallbackAssetSymbols: readiness.fallbackAssets.map((asset) => asset.symbol).slice(0, 10),
      softPendingReviewCount: readiness.softPendingReviewCount,
      snapshotSkipReason: null,
      snapshotReadinessSummary: readinessSummary,
      triggeredAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: durationMs2,
      stepTimings
    };
    console.info(logLabel, payload2);
    return payload2;
  }
  const durationMs = getDurationMs(startedAt);
  const snapshotSkipReason = getSnapshotSkipReason(readiness, false);
  const payload = {
    ok: true,
    skipped: true,
    route,
    message: mode === "manual" ? `\u4ECD\u672A\u80FD\u88DC\u751F\u6210\u4ECA\u65E5\u5FEB\u7167\uFF1A\u50F9\u683C\u66F4\u65B0\u672A\u5B8C\u6210\uFF08${readiness.readyAssets}/${readiness.totalAssets} \u5DF2\u66F4\u65B0\uFF0C\u5F85\u8655\u7406 ${readiness.pendingReviewCount} \u9805\uFF09\u3002` : `\u5DF2\u8DF3\u904E\u6BCF\u65E5\u8CC7\u7522\u5FEB\u7167\uFF1A\u50F9\u683C\u66F4\u65B0\u672A\u5B8C\u6210\uFF08${readiness.readyAssets}/${readiness.totalAssets} \u5DF2\u66F4\u65B0\uFF0C\u5F85\u8655\u7406 ${readiness.pendingReviewCount} \u9805\uFF09\u3002`,
    snapshotId: null,
    assetCount: readiness.totalAssets,
    readyAssets: readiness.readyAssets,
    pendingReviewCount: readiness.pendingReviewCount,
    hardPendingReviewCount: readiness.hardPendingReviewCount,
    coveragePct: readiness.coveragePct,
    staleAssetSymbols: readiness.staleAssets.map((asset) => asset.symbol).slice(0, 10),
    snapshotSkipReason,
    snapshotReadinessSummary: readinessSummary,
    triggeredAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs,
    stepTimings
  };
  console.info(logLabel, payload);
  return payload;
}
function getCronSnapshotErrorResponse(error, route = CRON_ROUTE) {
  if (error instanceof CronSnapshotError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route,
        message: error.message
      }
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route,
        message: error.message
      }
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      route,
      message: "\u6BCF\u65E5\u8CC7\u7522\u5FEB\u7167\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002"
    }
  };
}
export {
  getCronSnapshotErrorResponse,
  runManualDailySnapshot,
  runScheduledDailySnapshot,
  verifySnapshotCronRequest
};
