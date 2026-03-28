import {
  generatePriceUpdates,
  getUpdatePricesErrorResponse,
} from '../server/updatePrices';
import {
  getFirebaseApiAuthErrorResponse,
  isFirebaseApiAuthError,
  requireFirebaseUserFromRequest,
} from '../server/requireFirebaseUser';

export default async function handler(request: Request) {
  const route = '/api/update-prices';

  if (request.method !== 'POST') {
    return Response.json(
      {
        ok: false,
        route,
        message: 'Method not allowed',
      },
      { status: 405 },
    );
  }

  try {
    await requireFirebaseUserFromRequest(request, route);
    const payload = await request.json();
    const response = await generatePriceUpdates(payload);
    return Response.json(response);
  } catch (error) {
    if (isFirebaseApiAuthError(error)) {
      const authError = getFirebaseApiAuthErrorResponse(error, route);
      return Response.json(authError.body, { status: authError.status });
    }

    const formatted = getUpdatePricesErrorResponse(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}
