import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { sendJson, type ApiRequest, type ApiResponse } from './apiShared.js';

export function isMcpConnectivityTestRequest(request: ApiRequest) {
  try {
    const url = new URL(request.url ?? '/api/health', 'http://localhost');
    return url.pathname === '/api/mcp-test' || url.searchParams.get('mcpTest') === '1';
  } catch {
    return false;
  }
}

/** Public connectivity probe. This module has no portfolio or Firebase access. */
export async function handleMcpConnectivityTest(request: ApiRequest, response: ApiResponse) {
  const requestId = randomUUID();
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version, MCP-Session-Id');
  response.setHeader('Access-Control-Expose-Headers', 'X-MCP-Test-Request-Id');
  response.setHeader('X-MCP-Test-Request-Id', requestId);

  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS');
    sendJson(response, 405, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Use an MCP client to POST to this test endpoint.' },
      id: null,
    });
    return;
  }

  const server = new McpServer(
    { name: 'portfolio-v2-connectivity-test', version: '1.0.0' },
    { instructions: 'Connectivity testing with synthetic data only. This server cannot read actual holdings or transactions.' },
  );

  server.registerTool(
    'test_connection',
    {
      title: 'Test Portfolio V2 connection',
      description: 'Verify a live connection using server time, a unique request ID and a fictional DEMO holding. All holding data is synthetic.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: { securitySchemes: [{ type: 'noauth' }] },
    },
    async () => {
      const result = {
        dataSource: 'synthetic',
        asOf: new Date().toISOString(),
        requestId,
        holdings: [{ symbol: 'DEMO', name: 'Fictional test holding', quantity: 7 }],
      };
      console.info('[mcp-test]', JSON.stringify({
        event: 'tool_called',
        tool: 'test_connection',
        requestId,
        asOf: result.asOf,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch {
    console.error('[mcp-test]', JSON.stringify({ event: 'request_failed', requestId }));
    if (!response.headersSent) {
      sendJson(response, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'MCP connectivity test failed.' },
        id: null,
      });
    }
  } finally {
    await server.close();
  }
}
