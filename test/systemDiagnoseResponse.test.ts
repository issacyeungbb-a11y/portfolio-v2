import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { parseSystemDiagnoseResponse } from '../src/lib/api/systemDiagnose.ts';

const steps = Object.fromEntries(['environment', 'firebaseAdmin', 'firestoreRead', 'assets', 'yahooFinance', 'coinGecko', 'pendingReviews', 'snapshotQualityTrend', 'systemRuns', 'dailyJob'].map(name => [name, { ok: true, detail: '正常', durationMs: 1 }]));

test('an auth error is displayed as an error rather than crashing the asset page', () => {
  assert.throws(() => parseSystemDiagnoseResponse({ ok: false, message: '缺少共享存取碼' }), /缺少共享存取碼/);
});

test('an incomplete or non-JSON diagnostic payload is rejected before rendering', () => {
  for (const value of [null, '', '<html>Error</html>', {}, { ok: true, steps }, { ok: true, summary: {}, steps }]) {
    assert.throws(() => parseSystemDiagnoseResponse(value), /回應格式不完整/);
  }
});

test('a valid diagnostic with a missing historical snapshot remains visible as a failed check', () => {
  const value = {
    ok: false, triggeredAt: '2026-10-15T14:28:00Z', durationMs: 20,
    summary: { passedSteps: 9, failedSteps: 1 },
    steps: { ...steps, snapshotQualityTrend: { ok: false, detail: '缺少 2026-10-14', durationMs: 1 } },
  };
  assert.equal(parseSystemDiagnoseResponse(value), value);
  assert.equal(parseSystemDiagnoseResponse(value).steps.snapshotQualityTrend.detail, '缺少 2026-10-14');
});

test('the diagnostic request uses the shared authenticated client and propagates HTTP errors', async context => {
  const result = await build({
    entryPoints: [new URL('../src/lib/api/vercelFunctions.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'local-access-fixture', setup(build) {
      build.onResolve({ filter: /access\/accessCode$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const getCurrentPortfolioAccessCode = () => "local-test-code";' }));
    } }],
  });
  const client = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  let status = 200;
  context.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(path, '/api/health?mode=diagnose');
    assert.equal(options.method, 'GET');
    assert.equal((options.headers as Record<string, string>)['x-portfolio-access-code'], 'local-test-code');
    return new Response(JSON.stringify(status === 200 ? { ok: true } : { ok: false, message: '共享存取碼不正確' }), {
      status, headers: { 'content-type': 'application/json' },
    });
  });
  assert.deepEqual(await client.callPortfolioFunction('diagnose'), { ok: true });
  status = 401;
  await assert.rejects(client.callPortfolioFunction('diagnose'), /共享存取碼不正確.*HTTP 401/);
});
