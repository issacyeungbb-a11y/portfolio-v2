import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readdir, readFile } from 'node:fs/promises';

test('crypto history is exposed through the protected read-only API', async () => {
  const [apiSource, functionConfigSource, hookSource] = await Promise.all([
    readFile(new URL('../api/health.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/api/vercelFunctions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/hooks/useCryptoHistory.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(apiSource, /mode === 'crypto-history'/);
  assert.match(apiSource, /requirePortfolioAccess\(request, '\/api\/health'\)/);
  assert.match(apiSource, /from '\.\.\/server\/cryptoHistory\.js'/);
  assert.match(functionConfigSource, /'crypto-history': \{ path: '\/api\/health\?mode=crypto-history', method: 'GET' \}/);
  assert.match(hookSource, /callPortfolioFunction\('crypto-history'\)/);

  await access(new URL('../server/cryptoHistory.js', import.meta.url));
});

test('manual crypto month sync reuses the protected health function', async () => {
  const [apiSource, functionConfigSource, syncSource, historyReader] = await Promise.all([
    readFile(new URL('../api/health.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/api/vercelFunctions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/cryptoMonthlySync.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/cryptoHistory.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(apiSource, /mode === 'crypto-sync'/);
  assert.match(apiSource, /runCryptoMonthlySync\(body\)/);
  assert.match(apiSource, /requirePortfolioAccess\(request, '\/api\/health'\)/);
  assert.match(
    functionConfigSource,
    /'crypto-history-sync': \{ path: '\/api\/health\?mode=crypto-sync', method: 'POST' \}/,
  );
  assert.match(syncSource, /spreadsheets\.readonly/);
  assert.match(syncSource, /SYNC_RUN_COLLECTION = 'cryptoSyncRuns'/);
  assert.match(syncSource, /APPLY_CRYPTO_MONTHLY_SYNC/);
  assert.doesNotMatch(syncSource, /portfolioSnapshots/);
  assert.match(historyReader, /collection\('cryptoSyncRuns'\)/);
});

test('crypto history reuses an existing function to stay within the Hobby limit', async () => {
  const apiFiles = (await readdir(new URL('../api/', import.meta.url))).filter((file) =>
    file.endsWith('.ts'),
  );

  assert.equal(apiFiles.includes('crypto-history.ts'), false);
  assert.ok(apiFiles.length <= 12, `Expected at most 12 Vercel functions, found ${apiFiles.length}.`);
});

test('Vercel serves SPA routes directly without swallowing API or static asset paths', async () => {
  const vercelConfig = JSON.parse(
    await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  );
  const spaRewrite = vercelConfig.rewrites.find(
    (rewrite) => rewrite.destination === '/index.html',
  );

  assert.deepEqual(spaRewrite, {
    source: '/((?!api/|api$|.*\\..*).*)',
    destination: '/index.html',
  });
});

test('crypto history KPI amounts stay on one line and scale to their card width', async () => {
  const styles = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const kpiRule = styles.match(/\.crypto-kpi > strong\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(styles, /\.crypto-kpi\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(kpiRule, /font-size:\s*clamp\([^;]*cqi[^;]*\)/);
  assert.match(kpiRule, /white-space:\s*nowrap/);
  assert.match(kpiRule, /word-break:\s*normal/);
});

test('crypto allocation renders as an accessible pie chart', async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL('../src/components/crypto/CryptoAllocationPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8'),
  ]);

  assert.match(component, /className="crypto-allocation-pie"/);
  assert.match(component, /role="img"/);
  assert.match(component, /conic-gradient/);
  assert.doesNotMatch(component, /crypto-allocation-track/);
  assert.match(styles, /\.crypto-allocation-pie\s*\{[^}]*aspect-ratio:\s*1[^}]*border-radius:\s*50%/s);
});

test('server reader and importer stay inside independent crypto collections', async () => {
  const [readerSource, importerSource, rulesSource] = await Promise.all([
    readFile(new URL('../server/cryptoHistory.ts', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/import-crypto-history.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8'),
  ]);

  assert.match(readerSource, /collection\('cryptoMonthlySnapshots'\)/);
  assert.match(readerSource, /collection\('cryptoHistoricalImports'\)/);
  assert.doesNotMatch(readerSource, /portfolioSnapshots/);
  assert.match(importerSource, /SNAPSHOT_COLLECTION = 'cryptoMonthlySnapshots'/);
  assert.match(importerSource, /IMPORT_COLLECTION = 'cryptoHistoricalImports'/);
  assert.match(importerSource, /portfolioSnapshots/);
  assert.doesNotMatch(rulesSource, /cryptoMonthlySnapshots|cryptoHistoricalImports/);
});
