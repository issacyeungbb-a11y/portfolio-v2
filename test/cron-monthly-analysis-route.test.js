import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

import { SCHEDULED_ANALYSIS_LOGIC_VERSION } from '../server/scheduledAnalysis.js';

test('monthly cron route still points to runtime scheduledAnalysis.js and sync version marker matches source', async () => {
  const [apiSource, tsSource] = await Promise.all([
    readFile(new URL('../api/cron-monthly-analysis.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/scheduledAnalysis.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(apiSource, /from '\.\.\/server\/scheduledAnalysis\.js'/);
  assert.match(
    tsSource,
    new RegExp(`SCHEDULED_ANALYSIS_LOGIC_VERSION = '${SCHEDULED_ANALYSIS_LOGIC_VERSION}'`),
  );
});

test('analyze route has enough Vercel duration for grounded earnings analysis', async () => {
  const config = JSON.parse(
    await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  );

  assert.equal(config.functions['api/analyze.ts'].maxDuration, 120);
});

test('analyze route runtime JS imports exist for Vercel serverless', async () => {
  const apiSource = await readFile(new URL('../api/analyze.ts', import.meta.url), 'utf8');

  assert.match(apiSource, /from '\.\.\/server\/apiShared\.js'/);
  assert.match(apiSource, /from '\.\.\/server\/analyzePortfolio\.js'/);
  assert.match(apiSource, /from '\.\.\/server\/requirePortfolioAccess\.js'/);

  await access(new URL('../server/apiShared.js', import.meta.url));
  await access(new URL('../server/analyzePortfolio.js', import.meta.url));
  await access(new URL('../server/requirePortfolioAccess.js', import.meta.url));
});
