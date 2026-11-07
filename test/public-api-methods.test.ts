import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PORTFOLIO_ACCESS_CODE = 'test-code';
delete process.env.VITE_PORTFOLIO_ACCESS_CODE;

const { answerPublicRequestPreamble } = await import('../server/publicApiAccess.js');

type FakeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
};

function createResponse(): FakeResponse {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk ?? '';
      this.ended = true;
    },
  };
}

async function call(method: string, url: string) {
  const response = createResponse();
  const originalInfo = console.info;
  const logs: string[] = [];
  console.info = (...args: unknown[]) => { logs.push(args.join(' ')); };
  try {
    const answered = answerPublicRequestPreamble(
      { method, url, headers: { 'user-agent': 'ChatGPT-User/1.0' } } as never,
      response as never,
      url.split('?')[0],
      Date.now(),
    );
    return { response, logs, answered };
  } finally {
    console.info = originalInfo;
  }
  return { response, logs, answered: false };
}

for (const route of ['/api/portfolio-public', '/api/portfolio-transactions-public']) {
  test(`${route}: HEAD with a valid code answers 200 without reading data`, async () => {
    const { response, logs } = await call('HEAD', `${route}?code=test-code`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.body, '');
    assert.match(logs.join('\n'), /"method":"HEAD","status":200/);
  });

  test(`${route}: HEAD and GET with a wrong code answer 401`, async () => {
    assert.equal((await call('HEAD', `${route}?code=wrong`)).response.statusCode, 401);
    assert.equal((await call('GET', `${route}?code=wrong`)).response.statusCode, 401);
  });

  test(`${route}: OPTIONS preflight answers 204 with CORS headers`, async () => {
    const { response } = await call('OPTIONS', route);
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.equal(response.headers['access-control-allow-methods'], 'GET, HEAD, OPTIONS');
  });

  test(`${route}: other methods answer 405 with an Allow header`, async () => {
    const { response } = await call('POST', `${route}?code=test-code`);
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'GET, HEAD, OPTIONS');
  });

  test(`${route}: GET with a valid code is passed on to read data`, async () => {
    const { answered, response } = await call('GET', `${route}?code=test-code`);
    assert.equal(answered, false);
    assert.equal(response.ended, false);
    assert.equal(response.headers['access-control-allow-origin'], '*');
  });

  test(`${route}: request logs never contain the access code`, async () => {
    const { logs } = await call('GET', `${route}?code=wrong-secret-value`);
    assert.ok(logs.length > 0);
    assert.doesNotMatch(logs.join('\n'), /wrong-secret-value|code=/);
  });
}
