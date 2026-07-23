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

test('crypto history reuses an existing function to stay within the Hobby limit', async () => {
  const apiFiles = (await readdir(new URL('../api/', import.meta.url))).filter((file) =>
    file.endsWith('.ts'),
  );

  assert.equal(apiFiles.includes('crypto-history.ts'), false);
  assert.ok(apiFiles.length <= 12, `Expected at most 12 Vercel functions, found ${apiFiles.length}.`);
});

test('crypto history KPI amounts stay on one line and scale to their card width', async () => {
  const styles = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const kpiRule = styles.match(/\.crypto-kpi > strong\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(styles, /\.crypto-kpi\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(kpiRule, /font-size:\s*clamp\([^;]*cqi[^;]*\)/);
  assert.match(kpiRule, /white-space:\s*nowrap/);
  assert.match(kpiRule, /word-break:\s*normal/);
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
