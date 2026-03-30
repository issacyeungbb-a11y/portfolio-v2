import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import {
  buildHealthResponse,
} from './src/lib/api/mockFunctionResponses';
import {
  analyzePortfolio,
  getAnalyzePortfolioErrorResponse,
} from './server/analyzePortfolio';
import {
  extractAssetsFromScreenshot,
  getExtractAssetsErrorResponse,
} from './server/extractAssets';
import {
  generatePriceUpdates,
  getUpdatePricesErrorResponse,
} from './server/updatePrices';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from './server/requirePortfolioAccess';

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
              sendJson(response, 200, buildHealthResponse());
              return;
            }

            if (request.method === 'POST' && pathname === '/api/extract-assets') {
              try {
                await requirePortfolioAccess(request, '/api/extract-assets');
                const body = await readJsonBody(request);
                const result = await extractAssetsFromScreenshot(body);
                sendJson(response, 200, result);
              } catch (error) {
                if (isPortfolioAccessError(error)) {
                  const authError = getPortfolioAccessErrorResponse(error, '/api/extract-assets');
                  sendJson(response, authError.status, authError.body);
                  return;
                }

                const formatted = getExtractAssetsErrorResponse(error);
                sendJson(response, formatted.status, formatted.body);
              }
              return;
            }

            if (request.method === 'POST' && pathname === '/api/update-prices') {
              try {
                await requirePortfolioAccess(request, '/api/update-prices');
                const body = await readJsonBody(request);
                const result = await generatePriceUpdates(body);
                sendJson(response, 200, result);
              } catch (error) {
                if (isPortfolioAccessError(error)) {
                  const authError = getPortfolioAccessErrorResponse(error, '/api/update-prices');
                  sendJson(response, authError.status, authError.body);
                  return;
                }

                const formatted = getUpdatePricesErrorResponse(error);
                sendJson(response, formatted.status, formatted.body);
              }
              return;
            }

            if (request.method === 'POST' && pathname === '/api/analyze') {
              try {
                await requirePortfolioAccess(request, '/api/analyze');
                const body = await readJsonBody(request);
                const result = await analyzePortfolio(body);
                sendJson(response, 200, result);
              } catch (error) {
                if (isPortfolioAccessError(error)) {
                  const authError = getPortfolioAccessErrorResponse(error, '/api/analyze');
                  sendJson(response, authError.status, authError.body);
                  return;
                }

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
