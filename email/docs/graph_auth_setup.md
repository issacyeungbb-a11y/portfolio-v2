# Microsoft Graph 認證準備

此專案使用 Microsoft Graph 的委派權限與 `refresh_token` 做長期運行。

## 需要的環境變數

- `MS_GRAPH_CLIENT_ID`
- `MS_GRAPH_CLIENT_SECRET`
- `MS_GRAPH_REFRESH_TOKEN`
- `MS_GRAPH_TENANT_ID`

## 建議權限

- `Mail.Read`
- `Mail.Send`
- `User.Read`
- `offline_access`

## 建立方式

1. 到 Microsoft Entra 建立應用程式。
2. 允許個人 Microsoft 帳戶登入。
3. 建立一個可用的 Redirect URI。
4. 在 API permissions 加入上述 delegated permissions。
5. 完成一次使用者授權流程，取得 `refresh_token`。
6. 把結果填入 `.env`，不要寫死在程式碼。

## 安全注意

- 不要把 `refresh_token`、`client_secret` 寫進 Git。
- 建議用伺服器 secret manager 或環境變數注入。
- 若 token 洩露，應立即在 Microsoft 端撤銷並重新簽發。

