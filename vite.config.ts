import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function sendJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload, null, 2));
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [
      react(),
      {
        name: 'local-api-mocks',
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            const pathname = request.url?.split('?')[0];

            if (request.method === 'GET' && pathname === '/api/health') {
              const { buildHealthResponse } = await import('./src/lib/api/mockFunctionResponses');
              sendJson(response, 200, buildHealthResponse());
              return;
            }

            if (request.method === 'POST' && pathname === '/api/extract-assets') {
              try {
                const {
                  getPortfolioAccessErrorResponse,
                  isPortfolioAccessError,
                  requirePortfolioAccess,
                } = await import('./server/requirePortfolioAccess');
                const {
                  extractAssetsFromScreenshot,
                  getExtractAssetsErrorResponse,
                } = await import('./server/extractAssets');
                await requirePortfolioAccess(request, '/api/extract-assets');
                const body = await readJsonBody(request);
                const result = await extractAssetsFromScreenshot(body);
                sendJson(response, 200, result);
              } catch (error) {
                const {
                  getPortfolioAccessErrorResponse,
                  isPortfolioAccessError,
                } = await import('./server/requirePortfolioAccess');
                if (isPortfolioAccessError(error)) {
                  const authError = getPortfolioAccessErrorResponse(error, '/api/extract-assets');
                  sendJson(response, authError.status, authError.body);
                  return;
                }

                const { getExtractAssetsErrorResponse } = await import('./server/extractAssets');
                const formatted = getExtractAssetsErrorResponse(error);
                sendJson(response, formatted.status, formatted.body);
              }
              return;
            }

            if (request.method === 'POST' && pathname === '/api/update-prices') {
              try {
                const {
                  getPortfolioAccessErrorResponse,
                  isPortfolioAccessError,
                  requirePortfolioAccess,
                } = await import('./server/requirePortfolioAccess');
                const {
                  generatePriceUpdates,
                  getUpdatePricesErrorResponse,
                } = await import('./server/updatePrices');
                await requirePortfolioAccess(request, '/api/update-prices');
                const body = await readJsonBody(request);
                const result = await generatePriceUpdates(body);
                sendJson(response, 200, result);
              } catch (error) {
                const {
                  getPortfolioAccessErrorResponse,
                  isPortfolioAccessError,
                } = await import('./server/requirePortfolioAccess');
                if (isPortfolioAccessError(error)) {
                  const authError = getPortfolioAccessErrorResponse(error, '/api/update-prices');
                  sendJson(response, authError.status, authError.body);
                  return;
                }

                const { getUpdatePricesErrorResponse } = await import('./server/updatePrices');
                const formatted = getUpdatePricesErrorResponse(error);
                sendJson(response, formatted.status, formatted.body);
              }
              return;
            }

            if (request.method === 'POST' && pathname === '/api/analyze') {
              try {
                const {
                  getPortfolioAccessErrorResponse,
                  isPortfolioAccessError,
                  requirePortfolioAccess,
                } = await import('./server/requirePortfolioAccess');
                const {
                  analyzePortfolio,
                  getAnalyzePortfolioErrorResponse,
                } = await import('./server/analyzePortfolio');
                await requirePortfolioAccess(request, '/api/analyze');
                const body = await readJsonBody(request);
                const result = await analyzePortfolio(body);
                sendJson(response, 200, result);
              } catch (error) {
                const {
                  getPortfolioAccessErrorResponse,
                  isPortfolioAccessError,
                } = await import('./server/requirePortfolioAccess');
                if (isPortfolioAccessError(error)) {
                  const authError = getPortfolioAccessErrorResponse(error, '/api/analyze');
                  sendJson(response, authError.status, authError.body);
                  return;
                }

                const { getAnalyzePortfolioErrorResponse } = await import('./server/analyzePortfolio');
                const formatted = getAnalyzePortfolioErrorResponse(error);
                sendJson(response, formatted.status, formatted.body);
              }
              return;
            }

            next();
          });
        },
      },
    ],
    build: {
      rollupOptions: {
        external: [
          'firebase-admin',
          'firebase-admin/app',
          'firebase-admin/auth',
          'firebase-admin/firestore',
          'yahoo-finance2',
        ],
      },
    },
  };
});

async function readJsonBody(request: IncomingMessage) {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody) as unknown;
}
