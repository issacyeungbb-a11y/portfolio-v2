/**
 * 日期工具 — 成個系統嘅每日資料（快照、交易日期、資金流）
 * 一律以香港時區嘅 YYYY-MM-DD 作為日期 key。
 *
 * 注意：`new Date().toISOString().slice(0, 10)` 係 UTC 日期，
 * 香港時間 00:00–07:59 會攞到「琴日」，唔可以用嚟做「今日」。
 */

const HONG_KONG_DATE_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Hong_Kong',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getHongKongDateKey(date: Date = new Date()): string {
  return HONG_KONG_DATE_KEY_FORMATTER.format(date);
}
