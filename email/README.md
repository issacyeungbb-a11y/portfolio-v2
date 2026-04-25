# Kenji 每日文章電郵自動分析與回寄系統

這是一個可長期運行的 Python 小型系統，會在指定時間讀取 Outlook / Hotmail 郵箱中來自 `kenjiosone@substack.com` 的當日電郵，清洗文章內容，交給 Gemini 模型做結構化分析，最後以繁體中文摘要寄回同一個 Outlook / Hotmail 電郵地址。預設模型為 `gemini-3.1-pro-preview`。

## 專案結構

```text
app/
  cli.py
  config.py
  logger.py
  models.py
  prompts/
  services/
docs/
  deployment.md
scripts/
  run_daily.sh
tests/
  fixtures/
.env.example
requirements.txt
README.md
```

## 模組用途

- `app/config.py`: 讀取 `.env` 與環境變數，集中管理設定。
- `app/services/graph_mail.py`: 使用 Microsoft Graph 讀信與寄信。
- `app/services/mail_cleaner.py`: 清理 HTML 郵件正文，移除頁腳、退訂、社交分享與引用內容。
- `app/services/gemini_analyzer.py`: 將清洗後內容切段分析，再整合成結構化 JSON。
- `app/services/asset_intelligence.py`: 資產辨識、推介級別判斷、資產彙總。
- `app/services/digest_builder.py`: 生成最終繁體中文摘要電郵正文。
- `app/services/mail_sender.py`: 寄信、重試、失敗備份。
- `app/services/state_store.py`: SQLite 狀態保存，避免重覆分析與重覆發送。
- `app/services/orchestrator.py`: 主流程協調器。
- `app/prompts/analysis_prompts.py`: 集中管理 Gemini 分析提示詞與 JSON Schema。

## 本地啟動

1. 建立 `.env`：

```bash
cp .env.example .env
```

2. 填入 Microsoft Graph 與 Gemini 金鑰。

3. 檢查設定：

```bash
python3 -m app.cli check-config --show
```

4. 執行當日流程：

```bash
python3 -m app.cli run
```

5. 測試指定日期：

```bash
python3 -m app.cli run --date 2026-04-19 --force
```

## 測試

```bash
python3 -m unittest discover -s tests -v
```

## 正式排程

### 推薦方案

使用 `systemd timer`，詳見 [docs/deployment.md](/Users/yinwaiyeung/Documents/Playground/Portfolio_V2/email/docs/deployment.md)。

### 備選方案

使用 `cron`，同樣見部署文件。

## 如何替換分析模型

- 直接修改 `.env` 中的 `LLM_MODEL`
- 若要更改 Gemini API key，修改 `LLM_API_KEY`
- 若之後要改用其他供應商，可把 `gemini_analyzer.py` 換成對應供應商客戶端，並沿用相同 JSON 輸出格式

## 如何改成其他作者也可重用

- 修改 `.env` 的 `SOURCE_SENDER_EMAIL`
- 修改 `.env` 的 `SOURCE_SENDER_NAME`
- 如需支援多位作者，可把 `graph_mail.py` 的單一寄件者條件改為清單過濾，並在 digest 中加入作者欄位

## Outlook / Hotmail 權限準備

此版本假設你已在 Azure / Microsoft Entra 建立應用程式，並取得：

- `MS_GRAPH_CLIENT_ID`
- `MS_GRAPH_CLIENT_SECRET`
- `MS_GRAPH_REFRESH_TOKEN`

應用程式需要至少授予委派權限：

- `Mail.Read`
- `Mail.Send`
- `User.Read`
- `offline_access`

更完整的準備步驟見 [docs/graph_auth_setup.md](/Users/yinwaiyeung/Documents/Playground/Portfolio_V2/email/docs/graph_auth_setup.md)。

## 狀態保存

系統會保存：

- 已處理郵件 ID
- 上次成功運行時間
- 上次寄信狀態
- 最近一次錯誤訊息

預設保存在 `var/state.sqlite3`。

## 日誌

- 應用日誌：`var/logs/app.log`
- 寄信失敗備份：`var/output/digests/digest-YYYY-MM-DD.txt`
