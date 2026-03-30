# Portfolio_V2 Project Status

更新日期: 2026-03-30

## 目前專案重點

呢個版本已經由單機 mock portfolio，逐步轉向「單一共享投資組合」模式:

- 前端加入共享存取碼入口，未解鎖裝置唔會直接進入系統
- 資產主資料來源已切換到 Firestore
- 匯入、價格更新、AI 分析都改為走 Vercel Functions / server flow
- Dashboard / Assets / Import / Analysis 四頁已經串連成一條基本工作流

## 已完成

### 1. 共享存取控制

- `src/App.tsx`
- `src/hooks/usePortfolioAccess.ts`
- `src/lib/access/accessCode.ts`
- `server/requirePortfolioAccess.ts`

目前已經有:

- 前端存取碼解鎖頁
- localStorage 驗證狀態保存
- API header 驗證
- server 端 access code 檢查與錯誤回應

### 2. 共享資產資料

- `src/hooks/usePortfolioAssets.ts`
- `src/lib/firebase/assets.ts`
- `src/lib/firebase/sharedPortfolio.ts`
- `src/lib/portfolio/dashboardInsights.ts`
- `src/lib/firebase/portfolioSnapshots.ts`
- `src/hooks/usePortfolioSnapshots.ts`

目前已經有:

- 從 Firestore 讀取共享 holdings
- 手動新增資產
- 多頁共用同一份資產資料
- Dashboard 與 Assets 同步顯示同一批持倉
- Dashboard insight / system status 已改為根據真持倉與快取狀態生成
- 新增資產、匯入資產、確認價格更新後會寫入 `portfolio/app/portfolioSnapshots`
- Dashboard `PerformanceCard` 已可讀取真實 snapshot history 計算變動

### 3. 價格更新審核流程

- `src/hooks/usePriceUpdateReviews.ts`
- `src/lib/firebase/priceReviews.ts`
- `src/pages/AssetsPage.tsx`
- `api/update-prices.ts`

目前已經有:

- 針對單項或全部資產觸發價格更新
- 將 AI 建議先存成待審核資料
- 人手確認或略過更新

### 4. 截圖匯入流程

- `src/pages/ImportPage.tsx`
- `src/components/import/ExtractedAssetsEditor.tsx`
- `api/extract-assets.ts`

目前已經有:

- 截圖上傳與前端壓縮
- 呼叫 extract-assets function
- 人工修正抽取結果
- 寫入 Firestore assets

### 5. AI 分析快取流程

- `src/pages/AnalysisPage.tsx`
- `src/hooks/useAnalysisCache.ts`
- `src/lib/firebase/analysisCache.ts`
- `api/analyze.ts`

目前已經有:

- 依 holdings 建立 snapshot signature / hash
- 呼叫 analyze function
- 將分析結果快取到 Firestore
- 資產快照未變時優先讀取快取

## 進行中 / 半完成

### 1. 真資料與 mock 仍然混合

雖然 holdings 已經改用 Firestore，而且 Dashboard 主要觀察內容已轉做真資料推導，但以下內容仲未完全真實化:

- allocation / currency / formatting helper 仍集中喺 `mockPortfolio` data layer
- UI 文案仍有「preview / next steps」性質

### 2. 歷史價格能力未完成

目前已經有第一版 portfolio snapshot history，但仍未算完整:

- 單資產 `price_history` collection 設計
- 更細緻的每日定時 snapshot，而唔係只靠寫入事件觸發
- 7d / 30d / 半年 / 1年資料密度仍取決於你有幾多次寫入或價格確認

### 3. 權限模式剛轉型

目前架構已改成共享 access code 模式，但仍需再確認:

- Firestore rules 是否完全對應新共享資料模型
- server function 與 client env 設定是否已全面一致
- 之後會唔會需要再細分 admin / read-only / collaborator 權限

## 今次整理結果

### 已修正

- `tsconfig.node.json`

修正內容:

- 將 Node 專案編譯範圍收窄到真正 server / api / shared type 檔案
- 避免前端 `accessCode` 模組被 Node tsconfig 誤判
- `npm run build` 已恢復成功

## 建議下一步

1. 先抽離 `mockPortfolio` 依賴，將 Dashboard 全部改為真實 Firestore + computed selectors。
2. 定義 `price_history` / `portfolio_snapshots` 結構，補齊績效區間計算。
3. 為 access code + shared portfolio flow 補 smoke tests，至少覆蓋 unlock、API header、price review、analysis cache。
4. 新增 README 或 setup doc，寫清楚 `.env.local`、Firebase、Vercel function 所需環境變數。

## 當前狀態一句總結

專案核心 workflow 已經成形，屬於「可示範、可繼續疊真功能」階段；最大未完成部分係歷史價格、完全去 mock 化，以及共享權限模型的最後收口。
