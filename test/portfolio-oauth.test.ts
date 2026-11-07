import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  PortfolioOAuthProvider,
  MCP_RESOURCE,
  OAUTH_ORIGIN,
} from '../server/portfolioOAuthProvider.js';
import { buildOAuthApp } from '../server/portfolioOAuth.js';

class MemoryFirestore {
  records = new Map<string, Record<string, any>>();
  private queue: Promise<unknown> = Promise.resolve();
  doc(path: string) {
    const snapshot = () => ({
      exists: this.records.has(path),
      data: () => structuredClone(this.records.get(path)),
    });
    return {
      path,
      get: async () => snapshot(),
      create: async (value: Record<string, any>) => {
        assert.ok(!this.records.has(path));
        this.records.set(path, structuredClone(value));
      },
      update: async (value: Record<string, any>) => {
        assert.ok(this.records.has(path));
        this.records.set(path, { ...this.records.get(path), ...structuredClone(value) });
      },
    };
  }
  collection(name: string) {
    return {
      doc: (id: string) => this.doc(`${name}/${id}`),
      where: (field: string, _operator: string, value: unknown) => ({
        get: async () => ({
          docs: [...this.records.entries()]
            .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
            .map(([, data]) => ({ data: () => structuredClone(data) })),
        }),
      }),
    };
  }
  runTransaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const writes: Array<() => unknown> = [];
      const result = await callback({
        get: async (ref: ReturnType<MemoryFirestore['doc']>) => {
          assert.equal(writes.length, 0, 'Firestore requires all reads before writes');
          return ref.get();
        },
        create: (ref: ReturnType<MemoryFirestore['doc']>, value: Record<string, any>) =>
          writes.push(() => ref.create(value)),
        update: (ref: ReturnType<MemoryFirestore['doc']>, value: Record<string, any>) =>
          writes.push(() => ref.update(value)),
        set: (ref: ReturnType<MemoryFirestore['doc']>, value: Record<string, any>) =>
          writes.push(() => this.records.set(ref.path, structuredClone(value))),
      });
      for (const write of writes) await write();
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

const redirectUri = 'https://chatgpt.com/connector/oauth/test-callback';
const verifier = 'a'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function setup() {
  const db = new MemoryFirestore();
  let now = 1900000000;
  const provider = new PortfolioOAuthProvider(
    db as unknown as Firestore,
    Buffer.alloc(32, 42),
    () => now,
  );
  return {
    db,
    provider,
    advance: (seconds: number) => {
      now += seconds;
    },
  };
}

async function issue(
  provider: PortfolioOAuthProvider,
  scopes = ['portfolio:read', 'transactions:read'],
) {
  const client = await provider.clientsStore.registerClient({
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  let consentUrl = '';
  await provider.authorize(
    client,
    {
      redirectUri,
      codeChallenge: challenge,
      scopes,
      resource: new URL(MCP_RESOURCE),
      state: 'test-state',
    },
    {
      redirect: (value: string) => {
        consentUrl = value;
      },
    } as any,
  );
  const pendingId = new URL(consentUrl).searchParams.get('request')!;
  const approvedUrl = await provider.approve(pendingId, 'portfolio-shared-access', true);
  assert.equal(new URL(approvedUrl).searchParams.get('state'), 'test-state');
  const code = new URL(approvedUrl).searchParams.get('code')!;
  const tokens = await provider.exchangeAuthorizationCode(
    client,
    code,
    undefined,
    redirectUri,
    new URL(MCP_RESOURCE),
  );
  return { client, tokens, code, pendingId };
}

test('OAuth codes are single use and bound to client, redirect, resource and expiration', async () => {
  const { provider, advance } = setup();
  const first = await issue(provider);
  await assert.rejects(
    provider.exchangeAuthorizationCode(
      first.client,
      first.code,
      undefined,
      redirectUri,
      new URL(MCP_RESOURCE),
    ),
  );
  await assert.rejects(provider.approve(first.pendingId, 'portfolio-shared-access', true));
  const auth = await provider.verifyAccessToken(first.tokens.access_token);
  assert.equal(auth.resource?.href, MCP_RESOURCE);
  advance(601);
  await assert.rejects(provider.verifyAccessToken(first.tokens.access_token));
  const refreshed = await provider.exchangeRefreshToken(first.client, first.tokens.refresh_token!);
  assert.ok(await provider.verifyAccessToken(refreshed.access_token));
  advance(30 * 86400);
  await assert.rejects(provider.exchangeRefreshToken(first.client, refreshed.refresh_token!));
});

test('refresh rotates, rejects expanded scopes, and revokes the family on replay', async () => {
  const { provider } = setup();
  const first = await issue(provider, ['portfolio:read']);
  await assert.rejects(
    provider.exchangeRefreshToken(first.client, first.tokens.refresh_token!, ['transactions:read']),
  );
  await assert.rejects(
    provider.exchangeRefreshToken(
      first.client,
      first.tokens.refresh_token!,
      undefined,
      new URL('https://example.com/mcp'),
    ),
  );
  const next = await provider.exchangeRefreshToken(first.client, first.tokens.refresh_token!);
  assert.notEqual(next.refresh_token, first.tokens.refresh_token);
  await assert.rejects(provider.exchangeRefreshToken(first.client, first.tokens.refresh_token!));
  await assert.rejects(provider.verifyAccessToken(next.access_token));
  await assert.rejects(provider.verifyAccessToken(first.tokens.access_token));
});

test('concurrent refresh cannot create two usable token families', async () => {
  const { provider } = setup();
  const first = await issue(provider);
  const results = await Promise.allSettled([
    provider.exchangeRefreshToken(first.client, first.tokens.refresh_token!),
    provider.exchangeRefreshToken(first.client, first.tokens.refresh_token!),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  for (const result of results)
    if (result.status === 'fulfilled')
      await assert.rejects(provider.verifyAccessToken(result.value.access_token));
});

test('client secrets are encrypted, tokens are hashed, and another client cannot revoke a grant', async () => {
  const { db, provider } = setup();
  const confidential = await provider.clientsStore.registerClient({
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'client_secret_post',
    client_secret: 'confidential-client-secret',
  });
  assert.equal(
    (await provider.clientsStore.getClient(confidential.client_id))?.client_secret,
    'confidential-client-secret',
  );
  const first = await issue(provider);
  assert.ok(!JSON.stringify([...db.records]).includes('confidential-client-secret'));
  assert.ok(!JSON.stringify([...db.records]).includes(first.tokens.access_token));
  assert.ok(!JSON.stringify([...db.records]).includes(first.tokens.refresh_token!));
  await provider.revokeToken(confidential, { token: first.tokens.access_token });
  assert.ok(await provider.verifyAccessToken(first.tokens.access_token));
  await provider.revokeToken(first.client, { token: first.tokens.refresh_token! });
  await assert.rejects(provider.verifyAccessToken(first.tokens.access_token));
});

test('registration rejects arbitrary redirects and rate limits are shared across instances', async () => {
  const { db, provider } = setup();
  for (const uri of [
    'https://evil.example/redirect',
    'https://chatgpt.com.evil.example/connector/oauth/a',
    'https://chatgpt.com/connector/oauth/a?next=evil',
    'http://chatgpt.com/connector/oauth/a',
  ]) {
    await assert.rejects(
      provider.clientsStore.registerClient({
        redirect_uris: [uri],
        token_endpoint_auth_method: 'none',
      }),
    );
  }
  const second = new PortfolioOAuthProvider(
    db as unknown as Firestore,
    Buffer.alloc(32, 42),
    () => 1900000000,
  );
  const allowed = await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      (index % 2 ? provider : second).allowRequest('test', 'private-ip', 10),
    ),
  );
  assert.equal(allowed.filter(Boolean).length, 10);
  assert.ok(!JSON.stringify([...db.records]).includes('private-ip'));
});

test('HTTP discovery, PKCE, bearer scopes, tools and safe audit logs work together', async (t) => {
  const { provider } = setup();
  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  t.after(() => {
    console.info = originalInfo;
  });
  let transactionReads = 0;
  const app = buildOAuthApp(
    {
      readHoldings: async () => [
        { symbol: 'PENG', quantity: 3 },
        { symbol: 'BTC', accountSource: 'Crypto', averageCost: 0, unrealizedPnl: 100 },
      ],
      readTransactions: async (query) => {
        transactionReads += 1;
        return {
          ...query,
          transactionCount: 2,
          summary: {
            totalTransactions: 2,
            buyTransactions: 2,
            sellTransactions: 0,
            uniqueAssets: 1,
          },
          assetsTraded: ['PENG'],
          transactions: [
            { date: '2026-11-01', transactionType: 'buy', symbol: 'PENG', quantity: 1, price: 10 },
            { date: '2026-11-02', transactionType: 'buy', symbol: 'PENG', quantity: 2, price: 11 },
          ] as any,
        };
      },
    },
    provider,
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const local = `http://127.0.0.1:${address.port}`;
  const metadata = await fetch(`${local}/.well-known/oauth-authorization-server`).then((response) =>
    response.json(),
  );
  assert.equal(metadata.issuer, `${OAUTH_ORIGIN}/`);
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  const denied = await fetch(`${local}/api/mcp`, { method: 'POST' });
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate')!, /oauth-protected-resource/);

  const registered = await fetch(`${local}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  }).then((response) => response.json());
  const authorizeUrl = new URL('/authorize', local);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: registered.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'private-state-do-not-log',
    resource: MCP_RESOURCE,
    scope: 'portfolio:read transactions:read',
  }).toString();
  const authorize = await fetch(authorizeUrl, { redirect: 'manual' });
  assert.equal(authorize.status, 302);
  const pendingId = new URL(authorize.headers.get('location')!).searchParams.get('request')!;
  const callback = new URL(await provider.approve(pendingId, 'portfolio-shared-access', true));
  const code = callback.searchParams.get('code')!;
  const tokenBody = {
    grant_type: 'authorization_code',
    client_id: registered.client_id,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: MCP_RESOURCE,
  };
  const wrongPkce = await fetch(`${local}/token`, {
    method: 'POST',
    body: new URLSearchParams({ ...tokenBody, code_verifier: 'b'.repeat(64) }),
  });
  assert.equal(wrongPkce.status, 400);
  const wrongRedirect = await fetch(`${local}/token`, {
    method: 'POST',
    body: new URLSearchParams({
      ...tokenBody,
      redirect_uri: 'https://chatgpt.com/connector/oauth/other',
    }),
  });
  assert.equal(wrongRedirect.status, 400);
  const wrongResource = await fetch(`${local}/token`, {
    method: 'POST',
    body: new URLSearchParams({ ...tokenBody, resource: 'https://example.com' }),
  });
  assert.equal(wrongResource.status, 400);
  const tokenResponse = await fetch(`${local}/token`, {
    method: 'POST',
    body: new URLSearchParams(tokenBody),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  const client = new Client({ name: 'oauth-integration-test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${local}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    }),
  );
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [
    'get_holdings',
    'get_transactions',
  ]);
  const holdings = await client.callTool({ name: 'get_holdings', arguments: { symbol: 'peng' } });
  assert.equal((holdings.structuredContent?.assets as any[])[0].quantity, 3);
  const crypto = await client.callTool({ name: 'get_holdings', arguments: { symbol: 'BTC' } });
  assert.equal((crypto.structuredContent?.assets as any[])[0].unrealizedPnl, null);
  const trades = await client.callTool({
    name: 'get_transactions',
    arguments: { days: 365, symbol: 'PENG', limit: 1 },
  });
  assert.equal(trades.structuredContent?.transactionCount, 2);
  assert.equal(trades.structuredContent?.returnedCount, 1);
  assert.equal(trades.structuredContent?.hasMore, true);
  const invalidDays = await client.callTool({ name: 'get_transactions', arguments: { days: 366 } });
  assert.equal(invalidDays.isError, true);
  assert.equal(transactionReads, 1);
  const write = await client.callTool({ name: 'update_holding', arguments: {} });
  assert.equal(write.isError, true);
  const limited = await issue(provider, ['portfolio:read']);
  const limitedClient = new Client({ name: 'limited-integration-test', version: '1' });
  await limitedClient.connect(
    new StreamableHTTPClientTransport(new URL(`${local}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${limited.tokens.access_token}` } },
    }),
  );
  t.after(() => limitedClient.close());
  const insufficient = await limitedClient.callTool({ name: 'get_transactions', arguments: {} });
  assert.equal(insufficient.isError, true);
  assert.equal(transactionReads, 1);
  assert.ok(
    logs.every(
      (line) =>
        ![tokens.access_token, tokens.refresh_token, code, 'private-state-do-not-log'].some(
          (secret) => line.includes(secret),
        ),
    ),
  );
  assert.ok(logs.some((line) => line.includes('"outcome":"success"')));
});
