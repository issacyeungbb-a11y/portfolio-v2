# Portfolio V2

個人投資組合追蹤系統，支持多帳戶、多幣種資產管理，配備 AI 分析引擎。

## 技術棧

- 前端：React 18 + Vite + TypeScript
- 後端：Vercel Serverless Functions
- 資料庫：Firebase Firestore
- AI：Google Gemini + Claude Opus（雙引擎）
- 自動化：Vercel Cron Jobs

## 環境變數

### 前端（`VITE_` prefix）

| 變數名 | 說明 |
|--------|------|
| `VITE_FIREBASE_API_KEY` | Firebase Web API Key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase App ID |
| `VITE_PORTFOLIO_ACCESS_CODE` | 前端共享存取碼 |

### Server-side

| 變數名 | 說明 |
|--------|------|
| `PORTFOLIO_ACCESS_CODE` | Server 端共享存取碼 |
| `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` | Firebase Admin SDK 憑證（JSON 字串） |
| `GEMINI_API_KEY` | Google Gemini API Key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API Key |
| `CRON_SECRET` | Vercel Cron 驗證密鑰 |

## 本地開發

```bash
npm install
cp .env.example .env.local
# 填入環境變數
npm run dev
```

## 部署

Push 到 main branch，Vercel 自動部署。

## Cron 任務

詳見 [docs/cron-schedule.md](./docs/cron-schedule.md)
