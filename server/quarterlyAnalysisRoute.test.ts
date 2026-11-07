import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import handler from '../api/manual-quarterly-report.ts';

async function request(method: string, headers: Record<string, string> = {}, url = '/api/manual-quarterly-report') {
  let body: any;
  const response = { statusCode: 0, setHeader() {}, end(value: string) { body = JSON.parse(value); } };
  await handler({ method, headers, url } as any, response as any);
  return { status: response.statusCode, body };
}

test('quarterly status and generation both require portfolio authorization', async () => {
  const old = process.env.PORTFOLIO_ACCESS_CODE;
  const adminKeys = ['FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY', 'FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON'];
  const adminValues = adminKeys.map((key) => process.env[key]);
  adminKeys.forEach((key) => { delete process.env[key]; });
  process.env.PORTFOLIO_ACCESS_CODE = 'test-quarterly-access';
  try {
    for (const method of ['GET', 'POST']) {
      assert.equal((await request(method)).status, 401);
      assert.equal((await request(method, { 'x-portfolio-access-code': 'wrong' })).status, 401);
    }
    const invalid = await request('GET', { 'x-portfolio-access-code': 'test-quarterly-access' }, '/api/manual-quarterly-report?jobId=invalid');
    assert.equal(invalid.status, 500, 'Matching codes fail closed when the revocation store is unavailable');
  } finally {
    adminKeys.forEach((key, index) => {
      if (adminValues[index] === undefined) delete process.env[key];
      else process.env[key] = adminValues[index];
    });
    if (old === undefined) delete process.env.PORTFOLIO_ACCESS_CODE;
    else process.env.PORTFOLIO_ACCESS_CODE = old;
  }
});

test('job status reuses the quarterly route within the Hobby function limit', async () => {
  const files = await readdir(new URL('../api/', import.meta.url));
  assert.ok(files.filter((name) => name.endsWith('.ts')).length <= 12);
  assert.equal((await request('DELETE')).status, 405);
});
