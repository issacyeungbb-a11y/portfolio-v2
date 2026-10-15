import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keep external package resolution inside this installation, then remove every
// generated file. No credentials, network calls or portfolio writes are needed.
const temporary = await mkdtemp(join(root, 'node_modules', '.server-runtime-'));
try {
  const routes = (await readdir(join(root, 'api'))).filter(name => name.endsWith('.ts'));
  await build({
    entryPoints: routes.map(name => join(root, 'api', name)),
    outdir: temporary,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  });
  const probe = join(temporary, 'probe.mjs');
  await writeFile(probe, `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { generateKeyPairSync, verify } from 'node:crypto';
    const require = createRequire(import.meta.url);
    // Vercel's function loader cannot rely on Node's optional require(esm)
    // interop. Exercise the actual Firebase Auth -> jwks-rsa -> jose chain.
    const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const app = initializeApp({ credential: cert({
      projectId: 'runtime-smoke-test',
      clientEmail: 'runtime@runtime-smoke-test.iam.gserviceaccount.com',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }) }, 'runtime-smoke-test');
    try {
      const token = await getAuth(app).createCustomToken('runtime-smoke-user', { portfolioAccess: true });
      const [header, payload, signature] = token.split('.');
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).claims.portfolioAccess, true);
      assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')));
    } finally { await deleteApp(app); }
    for (const route of ${JSON.stringify(routes)}) {
      const module = await import(new URL(route.replace(/\\.ts$/, '.mjs'), import.meta.url));
      assert.equal(typeof module.default, 'function', route + ' must export a handler');
      let body;
      const response = { statusCode: 0, setHeader() {}, end(value) { body = JSON.parse(value); } };
      await module.default({ method: 'OPTIONS', url: '/api/' + route.replace(/\\.ts$/, ''), headers: {} }, response);
      assert.equal(response.statusCode, 405, route + ' request dispatch');
      assert.equal(typeof body.ok, 'boolean', route + ' JSON response');
    }
    // Protected flows must fail closed before reaching real data or services.
    process.env.PORTFOLIO_ACCESS_CODE = 'local-runtime-test-only';
    process.env.CRON_SECRET = 'local-runtime-cron-only';
    for (const [file, method, url] of [
      ['health', 'POST', '/api/health?mode=crypto-management'],
      ['health', 'POST', '/api/health?mode=unlock'],
      ['update-prices', 'POST', '/api/update-prices'],
      ['manual-capture-snapshot', 'POST', '/api/manual-capture-snapshot'],
      ['cron-daily-update', 'GET', '/api/cron-daily-update'],
      ['cron-daily-rescue', 'GET', '/api/cron-daily-rescue'],
    ]) {
      const module = await import(new URL(file + '.mjs', import.meta.url));
      const response = { statusCode: 0, setHeader() {}, end(value) { assert.equal(JSON.parse(value).ok, false); } };
      await module.default({ method, url, headers: {}, body: {} }, response);
      assert.equal(response.statusCode, 401, url + ' must reject unauthenticated requests');
    }
    console.log('[server-runtime] Firebase Auth signing, ' + ${routes.length} + ' API handlers and protected requests passed without require(esm)');
  `);
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', probe], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
