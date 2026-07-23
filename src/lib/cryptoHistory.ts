import type {
  CryptoDataQuality,
  CryptoMonthlySnapshot,
} from '../types/cryptoHistory';

export type CryptoHistoryYearFilter = 'all' | string;

export function sortCryptoSnapshots(
  snapshots: CryptoMonthlySnapshot[],
): CryptoMonthlySnapshot[] {
  return [...snapshots].sort((left, right) => left.month.localeCompare(right.month));
}

export function filterCryptoSnapshots(
  snapshots: CryptoMonthlySnapshot[],
  year: CryptoHistoryYearFilter,
): CryptoMonthlySnapshot[] {
  const sorted = sortCryptoSnapshots(snapshots);
  return year === 'all'
    ? sorted
    : sorted.filter((snapshot) => snapshot.month.startsWith(`${year}-`));
}

export function getCryptoHistoryYears(snapshots: CryptoMonthlySnapshot[]) {
  return [...new Set(snapshots.map((snapshot) => snapshot.month.slice(0, 4)))].sort();
}

export function getCryptoSnapshotQualityLabel(quality: CryptoDataQuality) {
  if (quality === 'verified') return '已核對';
  if (quality === 'attention') return '需要注意';
  return '部分資料';
}

export function getCryptoSnapshotQualityTone(quality: CryptoDataQuality) {
  if (quality === 'verified') return 'success' as const;
  if (quality === 'attention') return 'danger' as const;
  return 'warning' as const;
}

export function getCryptoSourceLabel(sourceType: string) {
  return sourceType === 'locked_month_log' ? '鎖定月結記錄' : '年度工作表';
}
