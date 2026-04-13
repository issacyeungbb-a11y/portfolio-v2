/**
 * 價格新鮮度集中配置 — server runtime version (ESM JS)
 *
 * 此檔案與 src/config/priceFreshness.ts 保持相同數值。
 * server/*.js 運行時引用此檔案；前端引用 src/config/priceFreshness.ts。
 *
 * 任何時窗修改必須同時更新兩個檔案。
 */

/**
 * 伺服器端：判斷從 Yahoo Finance / CoinGecko 抓回的報價時間是否可接受。
 * 用於 server/updatePrices.js → getQuoteFreshnessWindowMs()
 */
export const QUOTE_FRESHNESS_WINDOW_MS = {
  crypto: 72 * 60 * 60 * 1000,       // 72h — 加密貨幣全天候交易
  stock:  5 * 24 * 60 * 60 * 1000,   // 5d  — 覆蓋週末及假期停市
  etf:    5 * 24 * 60 * 60 * 1000,
  bond:   5 * 24 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};

/**
 * 前端：判斷資產價格是否過舊（前端顯示用）。
 * 用於 src/lib/portfolio/priceValidity.ts（前端直接引用 TS 版本）。
 * 此處僅供伺服器端記錄參考，一般不在 server 使用。
 */
export const DISPLAY_FRESHNESS_WINDOW_MS = {
  crypto: 36 * 60 * 60 * 1000,       // 36h
  stock:  4 * 24 * 60 * 60 * 1000,   // 4d
  etf:    4 * 24 * 60 * 60 * 1000,
  bond:   4 * 24 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};

/**
 * 快照降級：判斷舊有價格是否可用於每日快照降級。
 * 用於 server/cronCaptureSnapshot.js → isFallbackUsable()
 */
export const SNAPSHOT_FALLBACK_WINDOW_MS = {
  crypto: 72 * 60 * 60 * 1000,       // 72h
  stock:  96 * 60 * 60 * 1000,       // 4d (96h)
  etf:    96 * 60 * 60 * 1000,
  bond:   96 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};
