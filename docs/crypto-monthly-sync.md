# Crypto 月結單向同步

## 範圍

- 唯讀來源：Google Sheet `crypto` 的隱藏工作表 `月結記錄`
- 讀取範圍：`A1:S500`
- 寫入目標：`portfolio/app/cryptoMonthlySnapshots`
- 執行紀錄：`portfolio/app/cryptoSyncRuns`
- 不會讀取 `2026_V2` 即時持倉，也不會寫入 `portfolioSnapshots`

## 安全流程

1. 使用「檢查新月結」執行 preview；preview 只讀 Google Sheet 及 Firestore。
2. 系統以 `YYYY-MM` 和來源 checksum 比較資料。
3. 新月份列為準備新增；相同 checksum 直接略過。
4. 已鎖定月份如有差異，顯示欄位級 conflict 並停止，絕不覆蓋。
5. 只有在畫面明確確認後才執行 apply。Apply 會再次讀取來源，並驗證 preview checksum 未改變。
6. Firestore transaction 只會 create 新月份，並原子寫入一筆 `cryptoSyncRuns`。

## Vercel 設定

同步器優先使用 `CRYPTO_SHEET_SERVICE_ACCOUNT_JSON`。如未設定，會沿用
`FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` 或 Firebase Admin 分拆變數。

Google Sheet 必須以「檢視者」身份分享給相應 service account 的
`client_email`，不應授予編輯權限。對應 Google Cloud project 亦必須啟用
Google Sheets API。

可選環境變數：

- `CRYPTO_SHEET_SPREADSHEET_ID`
- `CRYPTO_SHEET_SOURCE_RANGE`
- `CRYPTO_SHEET_SERVICE_ACCOUNT_JSON`
- `CRYPTO_SHEET_CLIENT_EMAIL`
- `CRYPTO_SHEET_PRIVATE_KEY`

目前維持手動觸發。待第一個新月份成功 preview、apply 及核對後，才加入排程。
