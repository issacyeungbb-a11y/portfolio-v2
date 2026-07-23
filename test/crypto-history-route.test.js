import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

test('crypto history is exposed through the protected read-only API', async () => {
  const [apiSource, functionConfigSource, hookSource] = await Promise.all([
    readFile(new URL('../api/crypto-history.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/api/vercelFunctions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/hooks/useCryptoHistory.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(apiSource, /request\.method !== 'GET'/);
  assert.match(apiSource, /requirePortfolioAccess\(request, ROUTE\)/);
  assert.match(apiSource, /from '\.\.\/server\/cryptoHistory\.js'/);
  assert.match(functionConfigSource, /'crypto-history': \{ path: '\/api\/crypto-history', method: 'GET' \}/);
  assert.match(hookSource, /callPortfolioFunction\('crypto-history'\)/);
  assert.doesNotMatch(apiSource, /\.(set|create|update|delete)\(/);

  await access(new URL('../server/cryptoHistory.js', import.meta.url));
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
