import assert from 'node:assert/strict';
import test from 'node:test';

const LOGIN_CODE = 'login-code-123';
const READ_TOKEN = 'read-only-token-0123456789abcdef0123456789';

process.env.PORTFOLIO_ACCESS_CODE = LOGIN_CODE;
process.env.PORTFOLIO_PUBLIC_READ_TOKEN = READ_TOKEN;
delete process.env.VITE_PORTFOLIO_ACCESS_CODE;

const {
  answerPublicRequestPreamble,
  getConfiguredPublicReadToken,
  isValidPublicReadToken,
} = await import('../server/publicApiAccess.js');

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

function call(method: string, url: string) {
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
}

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

for (const route of ['/api/portfolio-public', '/api/portfolio-transactions-public']) {
  test(`${route}: GET with the read-only token is passed on to read data`, () => {
    const { answered, response } = call('GET', `${route}?token=${READ_TOKEN}`);
    assert.equal(answered, false);
    assert.equal(response.ended, false);
    assert.equal(response.headers['access-control-allow-origin'], '*');
  });

  test(`${route}: the login access code no longer opens the public API`, () => {
    assert.equal(call('GET', `${route}?code=${LOGIN_CODE}`).response.statusCode, 401);
    assert.equal(call('GET', `${route}?token=${LOGIN_CODE}`).response.statusCode, 401);
  });

  test(`${route}: HEAD with the read-only token answers 200 without reading data`, () => {
    const { response, logs } = call('HEAD', `${route}?token=${READ_TOKEN}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.body, '');
    assert.match(logs.join('\n'), /"method":"HEAD","status":200/);
  });

  test(`${route}: HEAD and GET with a wrong or missing token answer 401`, () => {
    assert.equal(call('HEAD', `${route}?token=wrong`).response.statusCode, 401);
    assert.equal(call('GET', `${route}?token=wrong`).response.statusCode, 401);
    assert.equal(call('GET', route).response.statusCode, 401);
  });

  test(`${route}: OPTIONS preflight answers 204 with CORS headers`, () => {
    const { response } = call('OPTIONS', route);
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.equal(response.headers['access-control-allow-methods'], 'GET, HEAD, OPTIONS');
  });

  test(`${route}: other methods answer 405 with an Allow header`, () => {
    const { response } = call('POST', `${route}?token=${READ_TOKEN}`);
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'GET, HEAD, OPTIONS');
  });

  test(`${route}: request logs never contain the token or the login code`, () => {
    const logs = [
      ...call('GET', `${route}?token=${READ_TOKEN}x`).logs,
      ...call('GET', `${route}?code=${LOGIN_CODE}`).logs,
      ...call('HEAD', `${route}?token=${READ_TOKEN}`).logs,
    ].join('\n');
    assert.ok(logs.length > 0);
    assert.doesNotMatch(logs, new RegExp(`${READ_TOKEN}|${LOGIN_CODE}|token=|code=`));
    assert.match(logs, /"legacyCodeParam":true/);
  });
}

test('the read-only token is refused when it is missing or too short', () => {
  withEnv({ PORTFOLIO_PUBLIC_READ_TOKEN: undefined }, () => {
    assert.equal(getConfiguredPublicReadToken(), '');
    assert.equal(call('GET', `/api/portfolio-public?token=${READ_TOKEN}`).response.statusCode, 401);
  });
  withEnv({ PORTFOLIO_PUBLIC_READ_TOKEN: 'short-token' }, () => {
    assert.equal(getConfiguredPublicReadToken(), '');
    assert.equal(call('GET', '/api/portfolio-public?token=short-token').response.statusCode, 401);
  });
});

test('the read-only token is refused when it equals a login access code', () => {
  const sameAsLogin = 'same-value-as-login-code-0123456789abcdef';
  withEnv({ PORTFOLIO_ACCESS_CODE: sameAsLogin, PORTFOLIO_PUBLIC_READ_TOKEN: sameAsLogin }, () => {
    assert.equal(getConfiguredPublicReadToken(), '');
    assert.equal(call('GET', `/api/portfolio-public?token=${sameAsLogin}`).response.statusCode, 401);
  });
  withEnv({ VITE_PORTFOLIO_ACCESS_CODE: sameAsLogin, PORTFOLIO_PUBLIC_READ_TOKEN: sameAsLogin }, () => {
    assert.equal(getConfiguredPublicReadToken(), '');
  });
});

test('token comparison needs an exact match of the same length', () => {
  assert.equal(isValidPublicReadToken(READ_TOKEN, READ_TOKEN), true);
  assert.equal(isValidPublicReadToken(`${READ_TOKEN}x`, READ_TOKEN), false);
  assert.equal(isValidPublicReadToken(READ_TOKEN.slice(0, -1), READ_TOKEN), false);
  assert.equal(isValidPublicReadToken('', READ_TOKEN), false);
  assert.equal(isValidPublicReadToken(READ_TOKEN, ''), false);
});
