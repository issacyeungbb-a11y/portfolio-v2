/** A job flag is not evidence that the daily snapshot was actually persisted. */
export function isDailyJobComplete(job: { status: string } | null, snapshotExists: boolean) {
  return job?.status === 'completed' && snapshotExists;
}

export function resolveDailySnapshotOutcome(result: Record<string, unknown>, snapshotExists: boolean) {
  if (result.failed || !snapshotExists) {
    const reason = typeof result.error === 'string'
      ? result.error
      : typeof result.message === 'string'
        ? result.message
        : '每日快照未有建立，等待救援重試。';
    return { ok: false, status: 'failed' as const, error: reason };
  }
  return { ok: true, status: result.skipped ? 'skipped' as const : 'completed' as const, error: null };
}

export function snapshotRescueAssetIds(
  assets: Array<{ id: string; assetType: string; managedManualPrice?: boolean; lastPriceUpdatedAt?: string }>,
  today: string,
  failedIds: string[] = [],
) {
  const failed = new Set(failedIds);
  return assets.filter(asset => {
    if (asset.assetType === 'cash' || asset.managedManualPrice) return false;
    const time = Date.parse(asset.lastPriceUpdatedAt ?? '');
    const updatedDate = Number.isFinite(time)
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time))
      : null;
    return failed.has(asset.id) || updatedDate !== today;
  }).map(asset => asset.id);
}

/** Calendar dates are Hong Kong dates; compare keys without the host timezone. */
export function snapshotContinuity(snapshotDates: string[], today: string) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(today)) throw new Error('Invalid Hong Kong date key');
  const dates = new Set(snapshotDates.filter(date => validDate(date) && date <= today));
  const latestSnapshotDate = [...dates].sort().at(-1) ?? null;
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const missingDates = Array.from({ length: 7 }, (_, i) =>
    new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10),
  ).filter(date => !dates.has(date)).reverse();
  return {
    latestSnapshotDate,
    daysSinceLastSnapshot: latestSnapshotDate
      ? Math.round((todayMs - Date.parse(`${latestSnapshotDate}T00:00:00Z`)) / 86_400_000)
      : null,
    missingDatesLast7Days: missingDates,
    todaySnapshotExists: dates.has(today),
  };
}
