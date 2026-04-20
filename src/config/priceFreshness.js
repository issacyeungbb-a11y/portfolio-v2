/**
 * 價格新鮮度集中配置 — server runtime (ESM JS)
 *
 * AUTO-GENERATED — 請勿直接修改此檔案。
 * 來源：src/config/priceFreshness.ts
 * 產生方式：node scripts/gen-price-freshness.mjs（或 npm run prebuild）
 */


/**
 * 伺服器端：判斷從 Yahoo Finance / CoinGecko 抓回的報價時間是否可接受
 * 用於 server/updatePrices.ts → getQuoteFreshnessWindowMs()
 */
export const QUOTE_FRESHNESS_WINDOW_MS = {
  crypto: 24 * 60 * 60 * 1000,        // 24h — 加密貨幣每日更新一次，接受窗口放寬至 24 小時
  stock:  5 * 24 * 60 * 60 * 1000,    // 5d  — 覆蓋週末及假期停市
  etf:    5 * 24 * 60 * 60 * 1000,
  bond:   5 * 24 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};

/**
 * 前端：判斷資產價格是否過舊（用於 stale 標記及 isHoldingPriceStale）
 * 用於 src/lib/portfolio/priceValidity.ts
 */
export const DISPLAY_FRESHNESS_WINDOW_MS = {
  crypto: 36 * 60 * 60 * 1000,        // 36h — 比接受窗口更嚴格，鼓勵更頻繁更新
  stock:  4 * 24 * 60 * 60 * 1000,    // 4d
  etf:    4 * 24 * 60 * 60 * 1000,
  bond:   4 * 24 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};

/**
 * 快照降級：判斷舊有價格是否可用於每日快照降級
 * 用於 server/cronCaptureSnapshot.ts → isFallbackUsable()
 */
export const SNAPSHOT_FALLBACK_WINDOW_MS = {
  crypto: 12 * 60 * 60 * 1000,        // 12h — 價格波動大，降級窗口縮短
  stock:  96 * 60 * 60 * 1000,        // 4d (96h)
  etf:    96 * 60 * 60 * 1000,
  bond:   96 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};
