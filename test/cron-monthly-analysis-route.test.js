import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

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
