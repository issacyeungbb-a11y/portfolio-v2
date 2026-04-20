/**
 * 價格新鮮度集中配置 — 單一來源（Single Source of Truth）
 *
 * 此檔案是唯一需要修改時窗數值的地方。
 * server/priceFreshness.js 由 `npm run prebuild` 自動從此檔案產生，
 * 請勿直接修改 server/priceFreshness.js。
 *
 * 引用此模組的路徑：
 *   - src/lib/portfolio/priceValidity.ts — 前端顯示判斷
 *   - server/priceFreshness.js（自動產生）— 伺服器端所有判斷
 *
 * ┌──────────────────────────────────┬───────────┬────────────┐
 * │ 時窗                             │ crypto    │ 非 crypto  │
 * ├──────────────────────────────────┼───────────┼────────────┤
 * │ QUOTE_FRESHNESS  (報價接受)       │ 24h       │ 5d (120h)  │
 * │ DISPLAY_FRESHNESS (前端顯示)      │ 36h       │ 4d  (96h)  │
 * │ SNAPSHOT_FALLBACK (快照降級)      │ 12h       │ 4d  (96h)  │
 * └──────────────────────────────────┴───────────┴────────────┘
 *
 * 設計原則：
 *   QUOTE_FRESHNESS > DISPLAY_FRESHNESS：
 *     報價接受窗口較寬，讓系統有更多機會接受市場資料；
 *     前端顯示窗口較嚴（DISPLAY），額外提示價格偏舊，不等同「未更新」。
 *   SNAPSHOT_FALLBACK 介於兩者之間（非 crypto 與 DISPLAY 相同，crypto 與 QUOTE 相同）：
 *     快照降級只在確認市場資料仍算可信時才沿用舊價格。
 *     注意：SNAPSHOT_FALLBACK 與 QUOTE_FRESHNESS 並不相同（非 crypto：96h vs 120h）。
 *   crypto 時窗採用 24h/12h，因加密貨幣全天候交易，但報價接受窗口保留較寬容的每日更新節奏。
 */

export interface AssetFreshnessWindows {
  readonly crypto: number;
  readonly stock: number;
  readonly etf: number;
  readonly bond: number;
  readonly cash: number;
  readonly [key: string]: number;
}

/**
 * 伺服器端：判斷從 Yahoo Finance / CoinGecko 抓回的報價時間是否可接受
 * 用於 server/updatePrices.ts → getQuoteFreshnessWindowMs()
 */
export const QUOTE_FRESHNESS_WINDOW_MS: AssetFreshnessWindows = {
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
export const DISPLAY_FRESHNESS_WINDOW_MS: AssetFreshnessWindows = {
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
export const SNAPSHOT_FALLBACK_WINDOW_MS: AssetFreshnessWindows = {
  crypto: 12 * 60 * 60 * 1000,        // 12h — 價格波動大，降級窗口縮短
  stock:  96 * 60 * 60 * 1000,        // 4d (96h)
  etf:    96 * 60 * 60 * 1000,
  bond:   96 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};
