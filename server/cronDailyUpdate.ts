import { FieldValue } from 'firebase-admin/firestore';
import { generatePriceUpdates, fetchLiveFxRatesWithStatus } from './updatePrices.js';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { runCoinGeckoCoinIdSync } from './syncCoinIds.js';
import { writeSystemRun } from './systemRuns.js';
import { runScheduledDailySnapshot } from './cronCaptureSnapshot.js';
// Re-export verifyCronRequest from cronAuth (dedicated auth module) so API routes
// can keep their existing imports while avoiding a circular dep with cronCaptureSnapshot.
export { verifyCronRequest } from './cronAuth.js';
import {
  readDailyJob,
  acquireDailyJobLock,
  updateDailyJob,
  addProcessedAssets,
  addFailedAssets,
  markUpdateDone,
  updateSnapshotStatus,
  finalizeDailyJob,
} from './dailyJobs.js';
import type { CoinGeckoSyncStatus } from './dailyJobs.js';
import type { FxRates } from '../src/types/fxRates';

const DAILY_ROUTE = '/api/cron-daily-update';
const RESCUE_ROUTE = '/api/cron-daily-rescue';
const BATCH_SIZE = 10;
const CRON_COIN_GECKO_TIMEOUT_MS = 20000;
const CRON_COIN_GECKO_BUDGET_MS = 18000;
const SYSTEM_RUN_TASK_NAME = 'cron-daily-update';
const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';

class DailyUpdateError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'DailyUpdateError';
    this.status = status;
  }
}


function getHongKongDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function getDurationMs(start: number): number {
  return Date.now() - start;
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, rej) => {
    handle = setTimeout(() => rej(new Error(msg)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(handle));
}

function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function isRateLimitError(error: unknown, fallbackMessage = '') {
  const status = error instanceof Error
    ? ((error as { status?: number; httpStatus?: number }).status ?? (error as { status?: number; httpStatus?: number }).httpStatus)
    : undefined;
  return status === 429 || /429|too many requests/i.test(fallbackMessage);
}

interface PriceUpdateResult {
  assetId: string;
  assetName: string;
  ticker: string;
  assetType: string;
  price: number | null;
  currency: string;
  asOf: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  invalidReason?: string;
}

interface ApplyCronOutcome {
  appliedCount: number;
  pendingCount: number;
  coveragePct: number;
}

/** Apply price update results to Firestore assets + reviews. */
async function applyCronResults(results: PriceUpdateResult[]): Promise<ApplyCronOutcome> {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
  const batch = db.batch();

  const valid = results.filter(r => r.price != null && r.price > 0 && !r.invalidReason);
  const invalid = results.filter(r => !(r.price != null && r.price > 0 && !r.invalidReason));

  // Preserve firstSeenAt for existing reviews
  const existingHasFirstSeen = new Map<string, boolean>();
  if (invalid.length > 0) {
    const snaps = await Promise.all(
      invalid.map(r => portfolioRef.collection('priceUpdateReviews').doc(r.assetId).get())
    );
    snaps.forEach((s, i) => {
      existingHasFirstSeen.set(invalid[i].assetId, s.exists && (s.data() as Record<string, unknown>)?.firstSeenAt != null);
    });
  }

  for (const r of valid) {
    const assetRef = portfolioRef.collection('assets').doc(r.assetId);
    batch.update(assetRef, {
      currentPrice: r.price,
      updatedAt: FieldValue.serverTimestamp(),
      lastPriceUpdatedAt: FieldValue.serverTimestamp(),
      priceSource: 'api_auto_cron',
      priceAsOf: r.asOf,
      priceSourceName: r.sourceName,
      priceSourceUrl: r.sourceUrl,
    });
    batch.set(portfolioRef.collection('priceUpdateReviews').doc(r.assetId), {
      ...omitUndefined(r as unknown as Record<string, unknown>), status: 'confirmed',
      confirmedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(assetRef.collection('priceHistory').doc(), {
      assetId: r.assetId, assetName: r.assetName, ticker: r.ticker,
      assetType: r.assetType, price: r.price, currency: r.currency,
      asOf: r.asOf, sourceName: r.sourceName, sourceUrl: r.sourceUrl,
      recordedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const r of invalid) {
    const hasFirstSeen = existingHasFirstSeen.get(r.assetId) ?? false;
    batch.set(portfolioRef.collection('priceUpdateReviews').doc(r.assetId), {
      ...omitUndefined(r as unknown as Record<string, unknown>), status: 'pending',
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(hasFirstSeen ? {} : { firstSeenAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
  }

  if (valid.length > 0 || invalid.length > 0) await batch.commit();

  const total = results.length;
  return {
    appliedCount: valid.length,
    pendingCount: invalid.length,
    coveragePct: total === 0 ? 100 : Math.round((valid.length / total) * 100),
  };
}

async function persistFxRates(fxRates: FxRates): Promise<void> {
  await getFirebaseAdminDb()
    .collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID)
    .set({ fxRates: { ...fxRates, updatedAt: new Date().toISOString() } }, { merge: true });
}

/**
 * P0-1: 接受 fxRates 並傳入 runScheduledDailySnapshot，確保匯率全程一致。
 */
async function runSnapshotPhase(
  dateKey: string,
  fxRates?: FxRates,
  holdings?: Awaited<ReturnType<typeof readAdminPortfolioAssets>>,
): Promise<Record<string, unknown>> {
  await updateSnapshotStatus(dateKey, 'running', {
    snapshotStartedAt: FieldValue.serverTimestamp(),
  });
  try {
    const result = await runScheduledDailySnapshot(fxRates, holdings) as Record<string, unknown>;
    const finalStatus = result.skipped ? 'skipped' : 'completed';
    await updateSnapshotStatus(dateKey, finalStatus, {
      snapshotFinishedAt: FieldValue.serverTimestamp(),
    });
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await updateSnapshotStatus(dateKey, 'failed', {
      snapshotFinishedAt: FieldValue.serverTimestamp(),
      snapshotError: msg,
    });
    console.warn('[cron-daily-update] 快照執行失敗:', msg);
    return { failed: true, error: msg };
  }
}

/**
 * Main orchestrator: handles scheduled (06:00 HKT) and rescue (08:00 HKT) triggers.
 * State-driven: reads dailyJobs/{dateKey} to determine what work remains.
 */
export async function runDailyUpdate(trigger: 'scheduled' | 'rescue'): Promise<Record<string, unknown>> {
  const dateKey = getHongKongDateKey();
  const route = trigger === 'rescue' ? RESCUE_ROUTE : DAILY_ROUTE;
  const startedAt = Date.now();

  // 1. Acquire lock (idempotency gate)
  const lockResult = await acquireDailyJobLock(dateKey, trigger);

  if (!lockResult.acquired) {
    const failedLock = lockResult as { acquired: false; reason: 'already_completed' | 'locked' };
    const msg = failedLock.reason === 'already_completed'
      ? '今日更新與快照已完成，跳過執行。'
      : '另一個更新程序正在進行中，跳過此次執行。';
    console.info(`[${route}] ${msg}`);
    return { ok: true, route, skipped: true, message: msg, dateKey, triggeredAt: new Date().toISOString() };
  }

  const { lockToken, existingJob } = lockResult;

  // 2. Determine what work remains
  const processedSet = new Set<string>(existingJob?.processedAssets ?? []);
  const failedSet = new Set<string>(existingJob?.failedAssets ?? []);

  // P1-1: Rescue run — clear previously failed assets so they get retried this run
  if (trigger === 'rescue' && failedSet.size > 0) {
    console.info(`[cron-daily-update] Rescue 清空 ${failedSet.size} 項 failedAssets 重試`);
    await updateDailyJob(dateKey, {
      failedAssets: [],
      lastError: null,
      rescueAttemptedAt: FieldValue.serverTimestamp(),
      previousFailedAssets: FieldValue.arrayUnion(...Array.from(failedSet)),
    });
    failedSet.clear();
  }
  const updateAlreadyDone = existingJob?.status === 'update_done' || existingJob?.status === 'completed';
  const snapshotAlreadyDone =
    existingJob?.snapshotStatus === 'completed' ||
    existingJob?.snapshotStatus === 'skipped';

  let appliedCount = existingJob?.appliedCount ?? 0;
  let pendingReviewCount = existingJob?.pendingReviewCount ?? 0;
  let fxUsingFallback = existingJob?.fxUsingFallback ?? false;
  let coinGeckoSyncStatus: CoinGeckoSyncStatus = (existingJob?.coinGeckoSyncStatus as CoinGeckoSyncStatus) ?? 'skipped';
  let coveragePct = existingJob?.coveragePct ?? 0;
  let processCoveragePct = existingJob?.processCoveragePct ?? 0;
  let totalAssets = existingJob?.totalAssets ?? 0;
  let snapshotHoldings: Awaited<ReturnType<typeof readAdminPortfolioAssets>> | undefined;
  // P0-1: 持有 cron 主流程抓到的 fxRates，傳給快照階段以確保匯率一致
  let snapshotFxRates: FxRates | undefined;

  try {
    // 3. Update phase (skip if already done)
    if (!updateAlreadyDone) {
      const allAssets = await readAdminPortfolioAssets();
      snapshotHoldings = allAssets;
      const nonCashAssets = allAssets.filter((asset) => asset.assetType !== 'cash');
      totalAssets = nonCashAssets.length;
      const assetsToProcess = nonCashAssets.filter(a => !processedSet.has(a.id) && !failedSet.has(a.id));

      await updateDailyJob(dateKey, { totalAssets });

      if (assetsToProcess.length > 0) {
        // CoinGecko sync once before batches
        const cryptoTickers = [...new Set(
          assetsToProcess
            .filter(a => a.assetType === 'crypto')
            .map(a => a.symbol.trim().toUpperCase())
            .filter(Boolean)
        )];
        if (cryptoTickers.length > 0) {
          try {
            await raceWithTimeout(
              runCoinGeckoCoinIdSync({ tickers: cryptoTickers }, { timeBudgetMs: CRON_COIN_GECKO_BUDGET_MS }) as Promise<unknown>,
              CRON_COIN_GECKO_TIMEOUT_MS, 'CoinGecko sync timeout'
            );
            coinGeckoSyncStatus = 'ok';
          } catch (e) {
            coinGeckoSyncStatus = (e as Error).message?.includes('timeout') ? 'timeout' : 'failed';
            console.warn('[cron-daily-update] CoinGecko sync 失敗:', (e as Error).message);
          }
        }

        // FX rates once — P0-1: 同時儲存到 snapshotFxRates 供快照階段使用
        const fxResult = await fetchLiveFxRatesWithStatus();
        fxUsingFallback = fxResult.usingFallback;
        snapshotFxRates = fxResult.rates;
        await persistFxRates(fxResult.rates);
        if (fxUsingFallback) console.warn('[cron-daily-update] 使用備援匯率。');

        // Process in batches
        for (let i = 0; i < assetsToProcess.length; i += BATCH_SIZE) {
          const batchAssets = assetsToProcess.slice(i, i + BATCH_SIZE);
          const batchIds = batchAssets.map(a => a.id);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(assetsToProcess.length / BATCH_SIZE);

          try {
            const request = {
              assets: batchAssets.map(a => ({
                assetId: a.id, assetName: a.name, ticker: a.symbol,
                assetType: a.assetType, currentPrice: a.currentPrice, currency: a.currency,
              })),
            };
            const generateResponse = await generatePriceUpdates(request) as { results: PriceUpdateResult[] };
            const outcome = await applyCronResults(generateResponse.results);

            appliedCount += outcome.appliedCount;
            pendingReviewCount += outcome.pendingCount;

            await addProcessedAssets(dateKey, batchIds);
            await updateDailyJob(dateKey, { appliedCount, pendingReviewCount });

            console.info(`[cron-daily-update] Batch ${batchNum}/${totalBatches} 完成：applied=${outcome.appliedCount} pending=${outcome.pendingCount}`);
          } catch (batchError) {
            // P1-2: Batch failed — fallback to per-asset retry with 300ms gap
            const batchErrMsg = batchError instanceof Error ? batchError.message : String(batchError);
            const isRateLimit = isRateLimitError(batchError, batchErrMsg);
            if (isRateLimit) {
              console.warn(`[cron-daily-update] Batch ${batchNum}/${totalBatches} 因 rate limit 失敗，略過逐項重試。`);
              await addFailedAssets(dateKey, batchIds, batchErrMsg);
              await updateDailyJob(dateKey, { appliedCount, pendingReviewCount });
              continue;
            }
            console.warn(`[cron-daily-update] Batch ${batchNum}/${totalBatches} 整批失敗，嘗試逐項重試:`, batchErrMsg);
            const perAssetFailed: string[] = [];
            for (const asset of batchAssets) {
              await new Promise<void>((r) => setTimeout(r, 300));
              try {
                const singleRequest = {
                  assets: [{
                    assetId: asset.id, assetName: asset.name, ticker: asset.symbol,
                    assetType: asset.assetType, currentPrice: asset.currentPrice, currency: asset.currency,
                  }],
                };
                const singleResponse = await generatePriceUpdates(singleRequest) as { results: PriceUpdateResult[] };
                const outcome = await applyCronResults(singleResponse.results);
                appliedCount += outcome.appliedCount;
                pendingReviewCount += outcome.pendingCount;
                await addProcessedAssets(dateKey, [asset.id]);
                console.info(`[cron-daily-update] 單項重試成功: ${asset.symbol}`);
              } catch (assetError) {
                const assetMsg = assetError instanceof Error ? assetError.message : String(assetError);
                console.error(`[cron-daily-update] 單項重試失敗: ${asset.symbol}:`, assetMsg);
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

      // P1-5: Recalculate both coverage metrics from Firestore state
      const refreshed = await readDailyJob(dateKey);
      const processedCount = (refreshed?.processedAssets ?? []).length;
      const pendingCountSnapshot = await getFirebaseAdminDb()
        .collection(SHARED_PORTFOLIO_COLLECTION)
        .doc(SHARED_PORTFOLIO_DOC_ID)
        .collection('priceUpdateReviews')
        .where('status', '==', 'pending')
        .count()
        .get();
      pendingReviewCount = pendingCountSnapshot.data().count;
      // processCoveragePct: how many assets were attempted (processed / total)
      processCoveragePct = totalAssets === 0 ? 100 : Math.round((processedCount / totalAssets) * 100);
      // coveragePct (validCoveragePct): how many assets received a valid price — main metric
      coveragePct = totalAssets === 0 ? 100 : Math.round((appliedCount / totalAssets) * 100);

      await markUpdateDone(dateKey, lockToken, {
        appliedCount, pendingReviewCount, coveragePct,
        processCoveragePct,
        fxUsingFallback, coinGeckoSyncStatus, totalAssets,
      });
    }

    // 4. Snapshot phase (skip if already done)
    // P0-1: 傳入主流程 fxRates，snapshot 優先使用相同匯率（無需再次 fetch）
    // P2 修補：等 Firestore 寫入收斂，避免 update phase batch commit 後即刻再讀
    //   priceUpdateReviews 時仲睇到舊嘅 pending 狀態（eventual consistency race）。
    let snapshotResult: Record<string, unknown> | null = null;
    if (!snapshotAlreadyDone) {
      snapshotHoldings ??= await readAdminPortfolioAssets();
      await new Promise<void>((r) => setTimeout(r, 2000));
      snapshotResult = await runSnapshotPhase(dateKey, snapshotFxRates, snapshotHoldings);
    }

    // 5. Finalize
    const durationMs = getDurationMs(startedAt);
    await finalizeDailyJob(dateKey, lockToken, true);

    // 6. Write legacy systemRun record (for backward compat with health/diagnose UI)
    await writeSystemRun({
      taskName: SYSTEM_RUN_TASK_NAME,
      trigger,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs, assetCount: totalAssets,
      appliedCount, pendingCount: pendingReviewCount,
      coinGeckoSyncStatus, coveragePct, fxUsingFallback,
      isRescueRun: trigger === 'rescue',
      errorMessage: null, ok: true,
    });

    const snapshotDesc = snapshotAlreadyDone
      ? '已跳過（快照已存在）'
      : snapshotResult?.failed
        ? '失敗'
        : snapshotResult?.skipped
          ? '已跳過'
          : '已完成';
    const message = `今日更新完成。已更新 ${appliedCount} 項，${pendingReviewCount} 項待審核，覆蓋率 ${coveragePct}%，快照${snapshotDesc}。`;
    console.info(`[${route}] 完成`, { appliedCount, pendingReviewCount, coveragePct, durationMs });

    return {
      ok: true, route, message, dateKey,
      appliedCount, pendingReviewCount, coveragePct,
      fxUsingFallback, coinGeckoSyncStatus,
      snapshotStatus: snapshotAlreadyDone
        ? 'skipped'
        : snapshotResult?.failed
          ? 'failed'
          : snapshotResult?.skipped
            ? 'skipped'
            : 'completed',
      durationMs, triggeredAt: new Date(startedAt).toISOString(),
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const durationMs = getDurationMs(startedAt);
    console.error(`[${route}] runDailyUpdate 失敗:`, msg);
    await finalizeDailyJob(dateKey, lockToken, false, msg);
    await writeSystemRun({
      taskName: SYSTEM_RUN_TASK_NAME, trigger,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs, assetCount: totalAssets,
      appliedCount, pendingCount: pendingReviewCount,
      coinGeckoSyncStatus, coveragePct, fxUsingFallback,
      isRescueRun: trigger === 'rescue',
      errorMessage: msg, ok: false,
    });
    throw error;
  }
}

export function getDailyUpdateErrorResponse(
  error: unknown,
  route = DAILY_ROUTE,
): { status: number; body: Record<string, unknown> } {
  const msg = error instanceof Error ? error.message : '每日自動更新失敗，請稍後再試。';
  // Respect .status on any typed error (DailyUpdateError, CronAuthError, etc.)
  const statusProp =
    error instanceof Error && 'status' in error
      ? (error as { status: unknown }).status
      : undefined;
  const status = typeof statusProp === 'number' ? statusProp : 500;
  return { status, body: { ok: false, route, message: msg } };
}
