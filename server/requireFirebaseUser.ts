import type { IncomingMessage } from 'node:http';

import type { DecodedIdToken } from 'firebase-admin/auth';

import {
  getFirebaseAdminSetupErrorMessage,
  verifyFirebaseIdToken,
} from './firebaseAdmin';

class FirebaseApiAuthError extends Error {
  status: number;
  route: string;

  constructor(message: string, route: string, status = 401) {
    super(message);
    this.name = 'FirebaseApiAuthError';
    this.status = status;
    this.route = route;
  }
}

export function isFirebaseApiAuthError(error: unknown): error is FirebaseApiAuthError {
  return error instanceof FirebaseApiAuthError;
}

function getBearerToken(authorizationHeader: string | null | undefined) {
  if (!authorizationHeader) {
    throw new Error('MISSING_AUTH_HEADER');
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new Error('INVALID_AUTH_HEADER');
  }

  return token;
}

function getNodeAuthorizationHeader(request: IncomingMessage) {
  const header = request.headers.authorization;

  if (Array.isArray(header)) {
    return header[0] ?? null;
  }

  return header ?? null;
}

export async function requireFirebaseUserFromAuthorizationHeader(
  authorizationHeader: string | null | undefined,
  route: string,
): Promise<DecodedIdToken> {
  let token = '';

  try {
    token = getBearerToken(authorizationHeader);
  } catch (error) {
    if (error instanceof Error && error.message === 'MISSING_AUTH_HEADER') {
      throw new FirebaseApiAuthError('缺少 Firebase ID token，請重新登入後再試。', route, 401);
    }

    throw new FirebaseApiAuthError(
      'Authorization header 格式不正確，請使用 Bearer token。',
      route,
      401,
    );
  }

  try {
    return await verifyFirebaseIdToken(token);
  } catch (error) {
    const setupMessage = getFirebaseAdminSetupErrorMessage(error);

    if (
      setupMessage.includes('未設定 Firebase Admin 憑證') ||
      setupMessage.includes('Firebase Admin 設定不完整') ||
      setupMessage.includes('FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON')
    ) {
      throw new FirebaseApiAuthError(setupMessage, route, 500);
    }

    throw new FirebaseApiAuthError('Firebase ID token 驗證失敗，請重新整理後再試。', route, 401);
  }
}

export async function requireFirebaseUserFromRequest(request: Request, route: string) {
  return requireFirebaseUserFromAuthorizationHeader(
    request.headers.get('authorization'),
    route,
  );
}

export async function requireFirebaseUserFromNodeRequest(
  request: IncomingMessage,
  route: string,
) {
  return requireFirebaseUserFromAuthorizationHeader(getNodeAuthorizationHeader(request), route);
}

export function getFirebaseApiAuthErrorResponse(error: unknown, route: string) {
  if (error instanceof FirebaseApiAuthError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route,
      message: 'Firebase 驗證失敗，請稍後再試。',
    },
  };
}
