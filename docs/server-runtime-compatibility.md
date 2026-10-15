# Firebase Admin runtime compatibility

The October 2026 Firebase Admin 14 upgrade introduced `jwks-rsa@4.1.0`,
which synchronously requires the ESM-only `jose@6`. Vercel's Node 24
function loader rejected that dependency with `ERR_REQUIRE_ESM` before
request handlers ran. Both Crypto management (`/api/health`) and asset
price updates (`/api/update-prices`) consequently returned HTTP 500.

Keep Firebase Admin 14 and scope the npm override to `jwks-rsa > jose`:
`^5.10.0` provides the CommonJS entry point needed by that dependency.
Do not replace other consumers' dependencies or weaken authentication.
Revisit the override when upstream supports this loader without
`require(esm)` interop. See the
[upstream issue](https://github.com/auth0/node-jwks-rsa/issues/507).

`npm run build` now runs `npm run check:server-runtime` before compilation.
It bundles the existing 12 API entry points with external npm packages,
then loads them with `--no-experimental-require-module` in a fresh process.
It also signs and verifies a Firebase custom token using an ephemeral local
RSA key, including the `portfolioAccess` claim. It requires no credentials,
network access or portfolio writes, and removes its temporary output.

This catches dependency initialization crashes that TypeScript and the
frontend build cannot detect. Run it after dependency updates, including
updates that otherwise pass the application test suite.

Validation for this repair: all 12 API imports and local token signing
passed, 272 application tests passed, and TypeScript/Vite build passed.
An Admin read of the live Crypto state confirmed that its 15 coins and
managed asset quantities were synchronized; the price timestamps were
stale while the APIs could not start. Refresh quotes after deploying the
repair. Manual-price coins continue to require an explicit reliable price.
