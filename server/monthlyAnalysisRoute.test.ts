import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import handler from '../api/cron-monthly-analysis.ts';

async function request(method: string, headers: Record<string, string> = {}, url = '/api/cron-monthly-analysis') {
  let body: any;
  const response = { statusCode: 0, setHeader() {}, end(value: string) { body = JSON.parse(value); } };
  await handler({ method, headers, url } as any, response as any);
  return { status: response.statusCode, body };
}

test('monthly status and generation both require portfolio authorization', async () => {
  const old = process.env.PORTFOLIO_ACCESS_CODE;
  process.env.PORTFOLIO_ACCESS_CODE = 'test-monthly-access';
  try {
    for (const method of ['GET', 'POST']) {
      assert.equal((await request(method)).status, 401);
      assert.equal((await request(method, { 'x-portfolio-access-code': 'wrong' })).status, 401);
    }
    const invalid = await request('GET', { 'x-portfolio-access-code': 'test-monthly-access' }, '/api/cron-monthly-analysis?jobId=invalid');
    assert.equal(invalid.status, 400);
  } finally {
    if (old === undefined) delete process.env.PORTFOLIO_ACCESS_CODE;
    else process.env.PORTFOLIO_ACCESS_CODE = old;
  }
});

test('job status reuses the monthly route within the Hobby function limit', async () => {
  const files = await readdir(new URL('../api/', import.meta.url));
  assert.ok(files.filter((name) => name.endsWith('.ts')).length <= 12);
  assert.equal((await request('DELETE')).status, 405);
});
