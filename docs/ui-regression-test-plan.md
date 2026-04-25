# UI Regression Test Plan

這份文件記錄目前可行的前端回歸檢查方式。現階段專案沒有獨立的 React UI 測試框架，因此先以低成本、可持續的檢查計劃為主。

## 1. 現況

- 已有 Node test 與部分 server-side 測試。
- 未見獨立的 React component testing 或 browser automation 測試套件。
- 因此暫時不引入大型 UI 測試框架，先維持輕量化。

## 2. 建議覆蓋範圍

1. Dashboard 是否可正常渲染。
2. Assets 是否可正常渲染。
3. Analysis 是否可正常渲染。
4. Trends 是否可正常渲染。
5. Transactions 是否可正常渲染。
6. TopBar 是否顯示 `title`、`subtitle`、`statusItems` 與 `actions`。
7. StatusBadge 是否可顯示 `normal`、`caution`、`danger`、`neutral`。
8. MoneyValue 是否可正確顯示 `HKD`、`USD`、`JPY`。
9. 空狀態是否顯示正確標題、原因與操作按鈕。
10. Modal 是否有正確標題與 danger action。

## 3. 建議回歸流程

1. 啟動本地預覽。
2. 逐頁打開六個主要頁面。
3. 檢查 TopBar、導覽、卡片、表格與狀態標籤是否正常。
4. 在 Assets 頁面檢查新增、編輯、刪除、更新價格、後補快照流程。
5. 在 Analysis 頁面檢查月報、季報與追問入口。
6. 在 Transactions 頁面檢查手動新增與匯入流程。
7. 在 Trends 頁面檢查快照狀態與走勢圖是否有清楚空狀態。

## 4. 如果要補正式測試

- 優先考慮以現有工具補少量純函式測試。
- 若日後要加 UI 自動化，建議先確認是否真的需要 browser automation，再決定是否引入額外套件。
- 在未確定前，不要為了測試而重構現有頁面結構。

## 5. 建議驗收命令

1. `npm run build`
2. `npm run test`
3. `npm run preview -- --host 0.0.0.0 --port 4173`
4. 手動檢查主要路由：
   - `/`
   - `/assets`
   - `/funds`
   - `/analysis`
   - `/trends`
   - `/transactions`

## 6. 備註

- 如果日後加入 React 測試框架，再把這份文件轉為實際測試清單與檔案結構。
- 在現階段，維持可預測、可手動驗證，比一次過引入大測試框架更重要。
