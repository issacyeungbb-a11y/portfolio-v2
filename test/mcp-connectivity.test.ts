import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('MCP endpoint works through the health handler and returns only synthetic holdings', async (t) => {
  const temporary = await mkdtemp(fileURLToPath(new URL('../node_modules/.mcp-test-', import.meta.url)));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, 'health.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../api/health.ts', import.meta.url))],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
  const { default: handler } = await import(pathToFileURL(output).href);

  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  t.after(() => { console.info = originalInfo; });

  const server = createServer((request, response) => { void handler(request, response); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const client = new Client({ name: 'local-connectivity-verification', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp-test`)));
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['test_connection']);
  assert.equal(tools[0].annotations?.readOnlyHint, true);

  const before = Date.now();
  const first = await client.callTool({ name: 'test_connection', arguments: {} });
  const second = await client.callTool({ name: 'test_connection', arguments: {} });
  const data = first.structuredContent!;
  assert.equal(data.dataSource, 'synthetic');
  assert.deepEqual(data.holdings, [{ symbol: 'DEMO', name: 'Fictional test holding', quantity: 7 }]);
  assert.ok(Date.parse(data.asOf as string) >= before);
  assert.match(data.requestId as string, /^[0-9a-f-]{36}$/);
  assert.notEqual(data.requestId, second.structuredContent?.requestId);
  assert.ok(logs.some((line) => line.startsWith('[mcp-test]') && line.includes(data.requestId as string)));

  const alias = await fetch(`${baseUrl}/api/health?mcpTest=1&mode=unlock&code=never-log-this`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'test_connection' } }),
  });
  assert.equal(alias.status, 200);
  assert.match(alias.headers.get('cache-control')!, /no-store/);
  const aliasBody = await alias.json();
  assert.equal(aliasBody.result.structuredContent.dataSource, 'synthetic');
  assert.equal(alias.headers.get('x-mcp-test-request-id'), aliasBody.result.structuredContent.requestId);
  assert.ok(logs.every((line) => !line.includes('never-log-this')));

  const unknownTool = await client.callTool({ name: 'read_portfolio', arguments: {} });
  assert.equal(unknownTool.isError, true);

  const getResponse = await fetch(`${baseUrl}/api/mcp-test`);
  assert.equal(getResponse.status, 405);
  const preflight = await fetch(`${baseUrl}/api/mcp-test`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  const malformed = await fetch(`${baseUrl}/api/mcp-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: '{broken',
  });
  assert.equal(malformed.status, 400);

  const portfolio = await fetch(`${baseUrl}/api/portfolio-public`);
  assert.equal(portfolio.status, 401);
  const transactions = await fetch(`${baseUrl}/api/portfolio-transactions-public`);
  assert.equal(transactions.status, 401);
});
