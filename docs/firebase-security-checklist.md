# Firebase Security Checklist

## 1. How access works

1. The login screen sends the shared access code to `POST /api/health?mode=unlock`.
2. The server compares it with `PORTFOLIO_ACCESS_CODE` (falls back to `VITE_PORTFOLIO_ACCESS_CODE`
   for older Vercel setups). A wrong code waits 800 ms and returns 401.
3. On success the server returns a Firebase custom token for the shared user
   `portfolio-shared-access` with the claim `portfolioAccess: true`.
4. The browser signs in with that token. Firestore rules only allow reads and writes when
   `request.auth.token.portfolioAccess == true`.
5. The typed code is kept in `localStorage` (`portfolio_access_code_v2`) and sent as the
   `x-portfolio-access-code` header to protected API routes.

The access code is never bundled into the frontend. `test/accessSecurity.test.mjs` fails if
frontend code reads `VITE_PORTFOLIO_ACCESS_CODE`, reads `import.meta.env` with a dynamic key
(which would inline every `VITE_*` value), or if any rule grants access unconditionally.

## 2. Firebase console

- `Authentication` must be enabled for the project (custom-token sign-in needs it; no
  sign-in provider has to be switched on for custom tokens).
- Publish [`firebase/firestore.rules`](../firebase/firestore.rules) **after** the matching app
  version is live. Publishing the rules first locks out the running site, because older
  builds read Firestore without signing in.
  - Console: Firestore Database → Rules → paste the file → Publish.
  - CLI: `npx firebase-tools deploy --only firestore:rules --project <project-id>`.

## 3. Vercel environment variables

Server-side only (never prefix with `VITE_`):

- `PORTFOLIO_ACCESS_CODE` — shared access code.
- `CRON_SECRET` — Vercel Cron sends `Authorization: Bearer <secret>`; cron routes refuse to
  run when it is missing.
- Firebase Admin credentials, one of:
  - `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`, or
  - `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`.
  The service account signs the custom tokens above.

Frontend (public by design; protection comes from the rules):

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.

See [`.env.example`](../.env.example) for the full list, including AI and CoinGecko keys.

## 4. Data covered by the rules

Everything lives under `portfolio/app`. Every rule requires the `portfolioAccess` claim; on top
of that:

- Crypto-account assets, principals and cash flows can only be changed by the server once
  `cryptoManagement/current` exists, except price fields on managed coins.
- `accountValuationOverrides` and `cryptoAssetSyncs` are read-only for the browser.
- Deletes are only allowed for non-Crypto assets, `analysisSessions`, `quarterlyReports` and
  `assetTransactions`.
- Server routes use Firebase Admin, which bypasses the rules.

## 5. Public read-only API

`/api/portfolio-public` and `/api/portfolio-transactions-public` require the same access code
as a `?code=` query parameter. Query strings can end up in logs, so share these URLs only with
trusted tools and change the code if a URL leaks.

## 6. Changing the access code

1. Update `PORTFOLIO_ACCESS_CODE` in Vercel and redeploy.
2. Devices that are already signed in keep their Firebase session, so if the old code leaked
   also end those sessions: Firebase console → Authentication → Users →
   `portfolio-shared-access` → Delete user. It is recreated on the next successful unlock.
   Tokens already issued can still be used for up to one hour.
3. Every device then has to enter the new code once.
