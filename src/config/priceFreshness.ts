/**
 * 價格新鮮度集中配置
 *
 * 三類時窗有不同用途，定義在此處以避免各模組硬編碼而產生不一致。
 *
 * 引用此模組的檔案：
 *   - server/updatePrices.ts      — 伺服器端報價接受判斷 (QUOTE_FRESHNESS_WINDOW_MS)
 *   - server/cronCaptureSnapshot.ts — 快照降級判斷 (SNAPSHOT_FALLBACK_WINDOW_MS)
 *   - src/lib/portfolio/priceValidity.ts — 前端顯示判斷 (DISPLAY_FRESHNESS_WINDOW_MS)
 *
 * ┌──────────────────────────────────┬───────────┬────────────┐
 * │ 時窗                             │ crypto    │ 非 crypto  │
 * ├──────────────────────────────────┼───────────┼────────────┤
 * │ QUOTE_FRESHNESS  (報價接受)       │ 72h       │ 5d (120h)  │
 * │ DISPLAY_FRESHNESS (前端顯示)      │ 36h       │ 4d  (96h)  │
 * │ SNAPSHOT_FALLBACK (快照降級)      │ 72h       │ 4d  (96h)  │
 * └──────────────────────────────────┴───────────┴────────────┘
 *
 * 設計原則：
 *   QUOTE_FRESHNESS > DISPLAY_FRESHNESS：
 *     報價接受窗口較寬，讓系統有更多機會接受市場資料；
 *     前端顯示窗口較嚴，提示使用者資料可能偏舊。
 *   SNAPSHOT_FALLBACK 與 QUOTE_FRESHNESS 故意相同：
 *     快照降級只在確認市場資料仍算可信時才使用舊價格。
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
  crypto: 72 * 60 * 60 * 1000,        // 72h — 加密貨幣全天候交易
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
  crypto: 72 * 60 * 60 * 1000,        // 72h
  stock:  96 * 60 * 60 * 1000,        // 4d (96h)
  etf:    96 * 60 * 60 * 1000,
  bond:   96 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};
