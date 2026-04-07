import { readJsonBody, sendJson, type ApiRequest, type ApiResponse } from './_shared.js';
import {
  getParseTransactionsCommandErrorResponse,
  parseTransactionsFromCommand,
} from '../server/parseTransactionsCommand.js';
import {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess,
} from '../server/requirePortfolioAccess.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const route = '/api/parse-transactions-command';

  if (request.method !== 'POST') {
    sendJson(response, 405, {
      ok: false,
      route,
      message: 'Method not allowed',
    });
    return;
  }

  try {
    await requirePortfolioAccess(request, route);
    const payload = await readJsonBody(request);
    const result = await parseTransactionsFromCommand(payload);
    sendJson(response, 200, result);
  } catch (error) {
    if (isPortfolioAccessError(error)) {
      const authError = getPortfolioAccessErrorResponse(error, route);
      sendJson(response, authError.status, authError.body);
      return;
    }

    const formatted = getParseTransactionsCommandErrorResponse(error);
    sendJson(response, formatted.status, formatted.body);
  }
}
