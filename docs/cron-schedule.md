# Cron 任務時間表

| 任務 | UTC 時間 | HKT 時間 | 用途 | 依賴 |
|------|----------|----------|------|------|
| cron-update-prices | 每日 22:00 | 每日 06:00 | 自動更新所有非現金資產價格 + 匯率 | 無 |
| cron-capture-snapshot | 每日 23:00 | 每日 07:00 | 擷取當日投資組合快照 | 需要 update-prices 完成 |
| cron-monthly-analysis | 每月 1 號 00:00 | 每月 1 號 08:00 | 月度 AI 分析 | 無 |
| cron-quarterly-report | 每季首月 1 號 01:00 | 每季首月 1 號 09:00 | 季度報告生成 | 無 |
