# Vercel Cron Notes

`vercel.json` 目前只有每日更新相關 cron，未有每月分析或季度報告 cron。

如日後需要保守加入，香港時間與 UTC 轉換建議如下：

- Monthly analysis: 香港時間每月 1 日 08:15
  - UTC cron: `15 0 1 * *`
- Quarterly report: 香港時間每季第一個月 1 日 09:15
  - UTC cron: `15 1 1 1,4,7,10 *`

現有 `hasExistingMonthlyAnalysis()` / `hasExistingQuarterlyReport()` 已可避免重複生成，但正式啟用前仍應先驗證：

- baseline snapshot 是否存在
- cash-flow / data-quality 限制是否按預期寫入報告
- Vercel runtime 是否已部署最新 `server/scheduledAnalysis.js`
