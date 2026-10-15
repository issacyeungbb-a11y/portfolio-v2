function isDailyJobComplete(job, snapshotExists) {
  return job?.status === "completed" && snapshotExists;
}
function resolveDailySnapshotOutcome(result, snapshotExists) {
  if (result.failed || !snapshotExists) {
    const reason = typeof result.error === "string" ? result.error : typeof result.message === "string" ? result.message : "\u6BCF\u65E5\u5FEB\u7167\u672A\u6709\u5EFA\u7ACB\uFF0C\u7B49\u5F85\u6551\u63F4\u91CD\u8A66\u3002";
    return { ok: false, status: "failed", error: reason };
  }
  return { ok: true, status: result.skipped ? "skipped" : "completed", error: null };
}
function snapshotRescueAssetIds(assets, today, failedIds = []) {
  const failed = new Set(failedIds);
  return assets.filter((asset) => {
    if (asset.assetType === "cash" || asset.managedManualPrice) return false;
    const time = Date.parse(asset.lastPriceUpdatedAt ?? "");
    const updatedDate = Number.isFinite(time) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time)) : null;
    return failed.has(asset.id) || updatedDate !== today;
  }).map((asset) => asset.id);
}
function snapshotContinuity(snapshotDates, today) {
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && (/* @__PURE__ */ new Date(`${value}T00:00:00Z`)).toISOString().slice(0, 10) === value;
  if (!validDate(today)) throw new Error("Invalid Hong Kong date key");
  const dates = new Set(snapshotDates.filter((date) => validDate(date) && date <= today));
  const latestSnapshotDate = [...dates].sort().at(-1) ?? null;
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const missingDates = Array.from(
    { length: 7 },
    (_, i) => new Date(todayMs - i * 864e5).toISOString().slice(0, 10)
  ).filter((date) => !dates.has(date)).reverse();
  return {
    latestSnapshotDate,
    daysSinceLastSnapshot: latestSnapshotDate ? Math.round((todayMs - Date.parse(`${latestSnapshotDate}T00:00:00Z`)) / 864e5) : null,
    missingDatesLast7Days: missingDates,
    todaySnapshotExists: dates.has(today)
  };
}
export {
  isDailyJobComplete,
  resolveDailySnapshotOutcome,
  snapshotContinuity,
  snapshotRescueAssetIds
};
