import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

test('monthly cron route still points to runtime scheduledAnalysis.js and sync version marker matches source', async () => {
  const [apiSource, tsSource, jsSource] = await Promise.all([
    readFile(new URL('../api/cron-monthly-analysis.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/scheduledAnalysis.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/scheduledAnalysis.js', import.meta.url), 'utf8'),
  ]);
  const versionMatch = tsSource.match(/SCHEDULED_ANALYSIS_LOGIC_VERSION = '([^']+)'/);

  assert.ok(versionMatch);
  assert.match(apiSource, /from '\.\.\/server\/scheduledAnalysis\.js'/);
  assert.match(jsSource, new RegExp(`SCHEDULED_ANALYSIS_LOGIC_VERSION = "${versionMatch[1]}"`));
});

test('analyze route has enough Vercel duration for grounded earnings analysis', async () => {
  const config = JSON.parse(
    await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  );

  assert.equal(config.functions['api/analyze.ts'].maxDuration, 300);
});

test('quarterly report is manual-only and not registered as a cron job', async () => {
  const [disabledCronSource, manualSource, functionConfigSource, vercelConfigSource] =
    await Promise.all([
      readFile(new URL('../api/cron-quarterly-report.ts', import.meta.url), 'utf8'),
      readFile(new URL('../api/manual-quarterly-report.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/lib/api/vercelFunctions.ts', import.meta.url), 'utf8'),
      readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    ]);
  const vercelConfig = JSON.parse(vercelConfigSource);

  assert.match(disabledCronSource, /410/);
  assert.doesNotMatch(disabledCronSource, /verifyCronRequest/);
  assert.doesNotMatch(disabledCronSource, /runQuarterlyAssetReport/);
  assert.match(manualSource, /runManualQuarterlyAssetReport/);
  assert.match(functionConfigSource, /\/api\/manual-quarterly-report/);
  assert.equal(vercelConfig.functions['api/manual-quarterly-report.ts'].maxDuration, 300);
  assert.equal(vercelConfig.functions['api/cron-quarterly-report.ts'], undefined);
  assert.ok(
    vercelConfig.crons.every(
      (entry) => !String(entry.path ?? '').includes('quarterly'),
    ),
  );
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

test('serverless analysis routes avoid top-level Google GenAI SDK import', async () => {
  const [tsSource, jsSource, scheduledTsSource, scheduledJsSource] = await Promise.all([
    readFile(new URL('../server/analyzePortfolio.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/analyzePortfolio.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/scheduledAnalysis.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/scheduledAnalysis.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(tsSource, /from ['"]@google\/genai['"]/);
  assert.doesNotMatch(jsSource, /from ['"]@google\/genai['"]/);
  assert.doesNotMatch(scheduledTsSource, /from ['"]@google\/genai['"]/);
  assert.doesNotMatch(scheduledJsSource, /from ['"]@google\/genai['"]/);
  assert.match(tsSource, /generateGeminiContentViaRest/);
  assert.match(jsSource, /generateGeminiContentViaRest/);
  assert.match(scheduledTsSource, /generateGeminiContentViaRest/);
  assert.match(scheduledJsSource, /generateGeminiContentViaRest/);
});
