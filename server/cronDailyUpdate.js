import { FieldValue } from "firebase-admin/firestore";
import { generatePriceUpdates, fetchLiveFxRatesWithStatus } from "./updatePrices.js";
import { getFirebaseAdminDb } from "./firebaseAdmin.js";
import { readAdminPortfolioAssets } from "./portfolioSnapshotAdmin.js";
import { runCoinGeckoCoinIdSync } from "./syncCoinIds.js";
import { writeSystemRun } from "./systemRuns.js";
import { runScheduledDailySnapshot } from "./cronCaptureSnapshot.js";
import { verifyCronRequest } from "./cronAuth.js";
import {
  readDailyJob,
  acquireDailyJobLock,
  updateDailyJob,
  addProcessedAssets,
  addFailedAssets,
  markUpdateDone,
  updateSnapshotStatus,
  finalizeDailyJob
} from "./dailyJobs.js";
const DAILY_ROUTE = "/api/cron-daily-update";
const RESCUE_ROUTE = "/api/cron-daily-rescue";
const BATCH_SIZE = 10;
const CRON_COIN_GECKO_TIMEOUT_MS = 2e4;
const CRON_COIN_GECKO_BUDGET_MS = 18e3;
const SYSTEM_RUN_TASK_NAME = "cron-daily-update";
const SHARED_PORTFOLIO_COLLECTION = "portfolio";
const SHARED_PORTFOLIO_DOC_ID = "app";
class DailyUpdateError extends Error {
  status;
  constructor(message, status = 500) {
    super(message);
    this.name = "DailyUpdateError";
    this.status = status;
  }
}
function getHongKongDateKey(date = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
function getDurationMs(start) {
  return Date.now() - start;
}
function raceWithTimeout(promise, ms, msg) {
  let handle;
  const t = new Promise((_, rej) => {
    handle = setTimeout(() => rej(new Error(msg)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(handle));
}
function omitUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== void 0));
}
function isRateLimitError(error, fallbackMessage = "") {
  const status = error instanceof Error ? error.status ?? error.httpStatus : void 0;
  return status === 429 || /429|too many requests/i.test(fallbackMessage);
}
async function applyCronResults(results) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
  const batch = db.batch();
  const valid = results.filter((r) => r.price != null && r.price > 0 && !r.invalidReason);
  const invalid = results.filter((r) => !(r.price != null && r.price > 0 && !r.invalidReason));
  const existingHasFirstSeen = /* @__PURE__ */ new Map();
  if (invalid.length > 0) {
    const snaps = await Promise.all(
      invalid.map((r) => portfolioRef.collection("priceUpdateReviews").doc(r.assetId).get())
    );
    snaps.forEach((s, i) => {
      existingHasFirstSeen.set(invalid[i].assetId, s.exists && s.data()?.firstSeenAt != null);
    });
  }
  for (const r of valid) {
    const assetRef = portfolioRef.collection("assets").doc(r.assetId);
    batch.update(assetRef, {
      currentPrice: r.price,
      currency: r.currency,
      updatedAt: FieldValue.serverTimestamp(),
      lastPriceUpdatedAt: FieldValue.serverTimestamp(),
      priceSource: "api_auto_cron",
      priceAsOf: r.asOf,
      priceSourceName: r.sourceName,
      priceSourceUrl: r.sourceUrl
    });
    batch.set(portfolioRef.collection("priceUpdateReviews").doc(r.assetId), {
      ...omitUndefined(r),
      status: "confirmed",
      confirmedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(assetRef.collection("priceHistory").doc(), {
      assetId: r.assetId,
      assetName: r.assetName,
      ticker: r.ticker,
      assetType: r.assetType,
      price: r.price,
      currency: r.currency,
      asOf: r.asOf,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      recordedAt: FieldValue.serverTimestamp()
    });
  }
  for (const r of invalid) {
    const hasFirstSeen = existingHasFirstSeen.get(r.assetId) ?? false;
    batch.set(portfolioRef.collection("priceUpdateReviews").doc(r.assetId), {
      ...omitUndefined(r),
      status: "pending",
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...hasFirstSeen ? {} : { firstSeenAt: FieldValue.serverTimestamp() }
    }, { merge: true });
  }
  if (valid.length > 0 || invalid.length > 0) await batch.commit();
  const total = results.length;
  return {
    appliedCount: valid.length,
    pendingCount: invalid.length,
    coveragePct: total === 0 ? 100 : Math.round(valid.length / total * 100)
  };
}
async function persistFxRates(fxRates) {
  await getFirebaseAdminDb().collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).set({ fxRates: { ...fxRates, updatedAt: (/* @__PURE__ */ new Date()).toISOString() } }, { merge: true });
}
async function runSnapshotPhase(dateKey, fxRates, holdings) {
  await updateSnapshotStatus(dateKey, "running", {
    snapshotStartedAt: FieldValue.serverTimestamp()
  });
  try {
    const result = await runScheduledDailySnapshot(fxRates, holdings);
    const finalStatus = result.skipped ? "skipped" : "completed";
    if (finalStatus === "skipped") {
      await updateSnapshotStatus(dateKey, "skipped", {
        snapshotSkipReason: typeof result.snapshotSkipReason === "string" ? result.snapshotSkipReason : null,
        snapshotReadinessSummary: result.snapshotReadinessSummary ?? null
      });
    }
    await updateSnapshotStatus(dateKey, finalStatus, {
      snapshotFinishedAt: FieldValue.serverTimestamp()
    });
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await updateSnapshotStatus(dateKey, "failed", {
      snapshotFinishedAt: FieldValue.serverTimestamp(),
      snapshotError: msg
    });
    console.warn("[cron-daily-update] \u5FEB\u7167\u57F7\u884C\u5931\u6557:", msg);
    return { failed: true, error: msg };
  }
}
async function runDailyUpdate(trigger) {
  const dateKey = getHongKongDateKey();
  const route = trigger === "rescue" ? RESCUE_ROUTE : DAILY_ROUTE;
  const startedAt = Date.now();
  const lockResult = await acquireDailyJobLock(dateKey, trigger);
  if (!lockResult.acquired) {
    const failedLock = lockResult;
    const msg = failedLock.reason === "already_completed" ? "\u4ECA\u65E5\u66F4\u65B0\u8207\u5FEB\u7167\u5DF2\u5B8C\u6210\uFF0C\u8DF3\u904E\u57F7\u884C\u3002" : "\u53E6\u4E00\u500B\u66F4\u65B0\u7A0B\u5E8F\u6B63\u5728\u9032\u884C\u4E2D\uFF0C\u8DF3\u904E\u6B64\u6B21\u57F7\u884C\u3002";
    console.info(`[${route}] ${msg}`);
    return { ok: true, route, skipped: true, message: msg, dateKey, triggeredAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const { lockToken, existingJob } = lockResult;
  const processedSet = new Set(existingJob?.processedAssets ?? []);
  const failedSet = new Set(existingJob?.failedAssets ?? []);
  if (trigger === "rescue" && failedSet.size > 0) {
    console.info(`[cron-daily-update] Rescue \u6E05\u7A7A ${failedSet.size} \u9805 failedAssets \u91CD\u8A66`);
    await updateDailyJob(dateKey, {
      failedAssets: [],
      lastError: null,
      rescueAttemptedAt: FieldValue.serverTimestamp(),
      previousFailedAssets: FieldValue.arrayUnion(...Array.from(failedSet))
    });
    failedSet.clear();
  }
  const updateAlreadyDone = existingJob?.status === "update_done" || existingJob?.status === "completed";
  const snapshotAlreadyDone = existingJob?.snapshotStatus === "completed" || existingJob?.snapshotStatus === "skipped";
  let appliedCount = existingJob?.appliedCount ?? 0;
  let pendingReviewCount = existingJob?.pendingReviewCount ?? 0;
  let fxUsingFallback = existingJob?.fxUsingFallback ?? false;
  let coinGeckoSyncStatus = existingJob?.coinGeckoSyncStatus ?? "skipped";
  let coveragePct = existingJob?.coveragePct ?? 0;
  let processCoveragePct = existingJob?.processCoveragePct ?? 0;
  let totalAssets = existingJob?.totalAssets ?? 0;
  let snapshotHoldings;
  let snapshotFxRates;
  try {
    if (!updateAlreadyDone) {
      const allAssets = await readAdminPortfolioAssets();
      const nonCashAssets = allAssets.filter((asset) => asset.assetType !== "cash");
      totalAssets = nonCashAssets.length;
      const assetsToProcess = nonCashAssets.filter((a) => !processedSet.has(a.id) && !failedSet.has(a.id));
      await updateDailyJob(dateKey, { totalAssets });
      if (assetsToProcess.length > 0) {
        const cryptoTickers = [...new Set(
          assetsToProcess.filter((a) => a.assetType === "crypto").map((a) => a.symbol.trim().toUpperCase()).filter(Boolean)
        )];
        if (cryptoTickers.length > 0) {
          try {
            await raceWithTimeout(
              runCoinGeckoCoinIdSync({ tickers: cryptoTickers }, { timeBudgetMs: CRON_COIN_GECKO_BUDGET_MS }),
              CRON_COIN_GECKO_TIMEOUT_MS,
              "CoinGecko sync timeout"
            );
            coinGeckoSyncStatus = "ok";
          } catch (e) {
            coinGeckoSyncStatus = e.message?.includes("timeout") ? "timeout" : "failed";
            console.warn("[cron-daily-update] CoinGecko sync \u5931\u6557:", e.message);
          }
        }
        const fxResult = await fetchLiveFxRatesWithStatus();
        fxUsingFallback = fxResult.usingFallback;
        snapshotFxRates = fxResult.rates;
        await persistFxRates(fxResult.rates);
        if (fxUsingFallback) console.warn("[cron-daily-update] \u4F7F\u7528\u5099\u63F4\u532F\u7387\u3002");
        for (let i = 0; i < assetsToProcess.length; i += BATCH_SIZE) {
          const batchAssets = assetsToProcess.slice(i, i + BATCH_SIZE);
          const batchIds = batchAssets.map((a) => a.id);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(assetsToProcess.length / BATCH_SIZE);
          try {
            const request = {
              assets: batchAssets.map((a) => ({
                assetId: a.id,
                assetName: a.name,
                ticker: a.symbol,
                assetType: a.assetType,
                currentPrice: a.currentPrice,
                currency: a.currency
              }))
            };
            const generateResponse = await generatePriceUpdates(request);
            const outcome = await applyCronResults(generateResponse.results);
            appliedCount += outcome.appliedCount;
            pendingReviewCount += outcome.pendingCount;
            await addProcessedAssets(dateKey, batchIds);
            await updateDailyJob(dateKey, { appliedCount, pendingReviewCount });
            console.info(`[cron-daily-update] Batch ${batchNum}/${totalBatches} \u5B8C\u6210\uFF1Aapplied=${outcome.appliedCount} pending=${outcome.pendingCount}`);
          } catch (batchError) {
            const batchErrMsg = batchError instanceof Error ? batchError.message : String(batchError);
            const isRateLimit = isRateLimitError(batchError, batchErrMsg);
            if (isRateLimit) {
              console.warn(`[cron-daily-update] Batch ${batchNum}/${totalBatches} \u56E0 rate limit \u5931\u6557\uFF0C\u7565\u904E\u9010\u9805\u91CD\u8A66\u3002`);
              await addFailedAssets(dateKey, batchIds, batchErrMsg);
              await updateDailyJob(dateKey, { appliedCount, pendingReviewCount });
              continue;
            }
            console.warn(`[cron-daily-update] Batch ${batchNum}/${totalBatches} \u6574\u6279\u5931\u6557\uFF0C\u5617\u8A66\u9010\u9805\u91CD\u8A66:`, batchErrMsg);
            const perAssetFailed = [];
            for (const asset of batchAssets) {
              await new Promise((r) => setTimeout(r, 300));
              try {
                const singleRequest = {
                  assets: [{
                    assetId: asset.id,
                    assetName: asset.name,
                    ticker: asset.symbol,
                    assetType: asset.assetType,
                    currentPrice: asset.currentPrice,
                    currency: asset.currency
                  }]
                };
                const singleResponse = await generatePriceUpdates(singleRequest);
                const outcome = await applyCronResults(singleResponse.results);
                appliedCount += outcome.appliedCount;
                pendingReviewCount += outcome.pendingCount;
                await addProcessedAssets(dateKey, [asset.id]);
                console.info(`[cron-daily-update] \u55AE\u9805\u91CD\u8A66\u6210\u529F: ${asset.symbol}`);
              } catch (assetError) {
                const assetMsg = assetError instanceof Error ? assetError.message : String(assetError);
                console.error(`[cron-daily-update] \u55AE\u9805\u91CD\u8A66\u5931\u6557: ${asset.symbol}:`, assetMsg);
                perAssetFailed.push(asset.id);
              }
            }
            if (perAssetFailed.length > 0) {
              await addFailedAssets(dateKey, perAssetFailed, batchErrMsg);
            }
            await updateDailyJob(dateKey, { appliedCount, pendingReviewCount });
          }
        }
      }
      const refreshed = await readDailyJob(dateKey);
      const processedCount = (refreshed?.processedAssets ?? []).length;
      const pendingCountSnapshot = await getFirebaseAdminDb().collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("priceUpdateReviews").where("status", "==", "pending").count().get();
      pendingReviewCount = pendingCountSnapshot.data().count;
      processCoveragePct = totalAssets === 0 ? 100 : Math.round(processedCount / totalAssets * 100);
      coveragePct = totalAssets === 0 ? 100 : Math.round(appliedCount / totalAssets * 100);
      await markUpdateDone(dateKey, lockToken, {
        appliedCount,
        pendingReviewCount,
        coveragePct,
        processCoveragePct,
        fxUsingFallback,
        coinGeckoSyncStatus,
        totalAssets
      });
    }
    let snapshotResult = null;
    if (!snapshotAlreadyDone) {
      await new Promise((r) => setTimeout(r, 2e3));
      snapshotHoldings = await readAdminPortfolioAssets();
      snapshotResult = await runSnapshotPhase(dateKey, snapshotFxRates, snapshotHoldings);
    }
    const durationMs = getDurationMs(startedAt);
    await finalizeDailyJob(dateKey, lockToken, true);
    await writeSystemRun({
      taskName: SYSTEM_RUN_TASK_NAME,
      trigger,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs,
      assetCount: totalAssets,
      appliedCount,
      pendingCount: pendingReviewCount,
      coinGeckoSyncStatus,
      coveragePct,
      fxUsingFallback,
      isRescueRun: trigger === "rescue",
      errorMessage: null,
      ok: true
    });
    const snapshotDesc = snapshotAlreadyDone ? "\u5DF2\u8DF3\u904E\uFF08\u5FEB\u7167\u5DF2\u5B58\u5728\uFF09" : snapshotResult?.failed ? "\u5931\u6557" : snapshotResult?.skipped ? "\u5DF2\u8DF3\u904E" : "\u5DF2\u5B8C\u6210";
    const message = `\u4ECA\u65E5\u66F4\u65B0\u5B8C\u6210\u3002\u5DF2\u66F4\u65B0 ${appliedCount} \u9805\uFF0C${pendingReviewCount} \u9805\u5F85\u5BE9\u6838\uFF0C\u8986\u84CB\u7387 ${coveragePct}%\uFF0C\u5FEB\u7167${snapshotDesc}\u3002`;
    console.info(`[${route}] \u5B8C\u6210`, { appliedCount, pendingReviewCount, coveragePct, durationMs });
    return {
      ok: true,
      route,
      message,
      dateKey,
      appliedCount,
      pendingReviewCount,
      coveragePct,
      fxUsingFallback,
      coinGeckoSyncStatus,
      snapshotStatus: snapshotAlreadyDone ? "skipped" : snapshotResult?.failed ? "failed" : snapshotResult?.skipped ? "skipped" : "completed",
      durationMs,
      triggeredAt: new Date(startedAt).toISOString()
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const durationMs = getDurationMs(startedAt);
    console.error(`[${route}] runDailyUpdate \u5931\u6557:`, msg);
    await finalizeDailyJob(dateKey, lockToken, false, msg);
    await writeSystemRun({
      taskName: SYSTEM_RUN_TASK_NAME,
      trigger,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs,
      assetCount: totalAssets,
      appliedCount,
      pendingCount: pendingReviewCount,
      coinGeckoSyncStatus,
      coveragePct,
      fxUsingFallback,
      isRescueRun: trigger === "rescue",
      errorMessage: msg,
      ok: false
    });
    throw error;
  }
}
function getDailyUpdateErrorResponse(error, route = DAILY_ROUTE) {
  const msg = error instanceof Error ? error.message : "\u6BCF\u65E5\u81EA\u52D5\u66F4\u65B0\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002";
  const statusProp = error instanceof Error && "status" in error ? error.status : void 0;
  const status = typeof statusProp === "number" ? statusProp : 500;
  return { status, body: { ok: false, route, message: msg } };
}
export {
  getDailyUpdateErrorResponse,
  runDailyUpdate,
  verifyCronRequest
};
