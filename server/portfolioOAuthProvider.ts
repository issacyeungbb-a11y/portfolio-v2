import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Response } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidClientError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { getFirebaseAdminDb } from './firebaseAdmin.js';

export const OAUTH_SCOPES = ['portfolio:read', 'transactions:read'];
export const ACCESS_TOKEN_SECONDS = 600;
const GRANT_SECONDS = 30 * 24 * 60 * 60;
const CODE_SECONDS = 120;
export const OAUTH_ORIGIN = 'https://portfolio-v2-ochre-chi.vercel.app';
export const MCP_RESOURCE = `${OAUTH_ORIGIN}/api/mcp`;

export function credentialHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function opaqueToken(kind: string) {
  return `pv_${kind}_${randomBytes(32).toString('base64url')}`;
}

function readEncryptionKey() {
  const json = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
  const secret = process.env.FIREBASE_ADMIN_PRIVATE_KEY || (json && JSON.parse(json).private_key);
  if (!secret) throw new Error('OAuth server credentials are not configured.');
  return createHash('sha256').update(`portfolio-oauth-v1:${secret}`).digest();
}

function validateRedirect(uri: string) {
  const url = new URL(uri);
  const validPath =
    url.pathname === '/connector_platform_oauth_redirect' ||
    /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname);
  if (
    url.origin !== 'https://chatgpt.com' ||
    !validPath ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new InvalidClientError('Only the registered ChatGPT OAuth callback is supported.');
  }
}

function validateScopes(scopes: string[]) {
  if (!scopes.length || scopes.some((scope) => !OAUTH_SCOPES.includes(scope))) {
    throw new InvalidScopeError('Only portfolio and transaction read scopes are supported.');
  }
}

type Grant = {
  clientId: string;
  scopes: string[];
  resource: string;
  ownerUid: string;
  expiresAt: number;
  createdAt: number;
  revoked: boolean;
};

type TokenRecord = {
  kind: 'access' | 'refresh';
  grantId: string;
  clientId: string;
  scopes: string[];
  resource: string;
  expiresAt: number;
  used: boolean;
};

export class PortfolioOAuthProvider implements OAuthServerProvider {
  constructor(
    readonly db: Firestore = getFirebaseAdminDb(),
    private readonly encryptionKey = readEncryptionKey(),
    private readonly now = () => Math.floor(Date.now() / 1000),
  ) {}

  private ref(kind: string, id: string) {
    return this.db.collection('portfolioOAuth').doc(`${kind}_${credentialHash(id)}`);
  }

  private encrypt(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url');
  }

  private decrypt(value: string) {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
  }

  readonly clientsStore = {
    getClient: async (clientId: string): Promise<OAuthClientInformationFull | undefined> => {
      if (clientId.length > 200) return undefined;
      const snapshot = await this.ref('client', clientId).get();
      if (!snapshot.exists) return undefined;
      const { encryptedSecret, ...client } = snapshot.data()!;
      return {
        ...client,
        ...(encryptedSecret ? { client_secret: this.decrypt(encryptedSecret) } : {}),
      } as OAuthClientInformationFull;
    },
    registerClient: async (
      input: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
    ): Promise<OAuthClientInformationFull> => {
      input.redirect_uris.forEach(validateRedirect);
      if (
        !input.redirect_uris.length ||
        input.redirect_uris.length > 3 ||
        !['none', 'client_secret_post'].includes(
          input.token_endpoint_auth_method ?? 'client_secret_post',
        )
      ) {
        throw new InvalidClientError('Unsupported client registration.');
      }
      const client = {
        ...input,
        client_id: opaqueToken('client'),
        client_id_issued_at: this.now(),
      };
      const { client_secret, ...metadata } = client;
      await this.ref('client', client.client_id).create(
        JSON.parse(
          JSON.stringify({
            ...metadata,
            ...(client_secret ? { encryptedSecret: this.encrypt(client_secret) } : {}),
          }),
        ),
      );
      return client;
    },
  };

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    response: Response,
  ) {
    validateRedirect(params.redirectUri);
    const scopes = params.scopes?.length ? params.scopes : OAUTH_SCOPES;
    validateScopes(scopes);
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) ||
      !params.state ||
      params.state.length > 2000
    ) {
      throw new InvalidRequestError('A state parameter and S256 PKCE challenge are required.');
    }
    if (params.resource?.href !== MCP_RESOURCE)
      throw new InvalidRequestError('The MCP resource is required.');
    const pendingId = opaqueToken('request');
    await this.ref('pending', pendingId).create({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? '',
      scopes,
      resource: MCP_RESOURCE,
      expiresAt: this.now() + 600,
      used: false,
    });
    response.redirect(`${OAUTH_ORIGIN}/connections?request=${pendingId}`);
  }

  async getPending(pendingId: string) {
    const snapshot = await this.ref('pending', pendingId).get();
    const pending = snapshot.data();
    if (!pending || pending.used || pending.expiresAt <= this.now())
      throw new InvalidGrantError('The authorization request has expired.');
    return pending;
  }

  async approve(pendingId: string, ownerUid: string, approved: boolean) {
    const code = opaqueToken('code');
    const grantId = opaqueToken('grant');
    const pending = await this.db.runTransaction(async (transaction) => {
      const pendingRef = this.ref('pending', pendingId);
      const snapshot = await transaction.get(pendingRef);
      const value = snapshot.data();
      if (!value || value.used || value.expiresAt <= this.now())
        throw new InvalidGrantError('The authorization request has expired.');
      transaction.update(pendingRef, { used: true });
      if (approved) {
        transaction.create(this.ref('grant', grantId), {
          clientId: value.clientId,
          scopes: value.scopes,
          resource: value.resource,
          ownerUid,
          createdAt: this.now(),
          expiresAt: this.now() + GRANT_SECONDS,
          revoked: false,
          grantId,
        });
        transaction.create(this.ref('code', code), {
          clientId: value.clientId,
          redirectUri: value.redirectUri,
          codeChallenge: value.codeChallenge,
          resource: value.resource,
          scopes: value.scopes,
          grantId,
          expiresAt: this.now() + CODE_SECONDS,
          used: false,
        });
      }
      return value;
    });
    const redirect = new URL(pending.redirectUri);
    console.info('[portfolio-oauth]', JSON.stringify({
      event: approved ? 'grant_created' : 'grant_denied',
      grantId: approved ? grantId : undefined,
      ownerUid,
      scopes: pending.scopes,
    }));
    redirect.searchParams.set(approved ? 'code' : 'error', approved ? code : 'access_denied');
    if (pending.state) redirect.searchParams.set('state', pending.state);
    return redirect.href;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    const snapshot = await this.ref('code', code).get();
    const value = snapshot.data();
    if (
      !value ||
      value.used ||
      value.expiresAt <= this.now() ||
      value.clientId !== client.client_id
    ) {
      throw new InvalidGrantError('Invalid authorization code.');
    }
    return value.codeChallenge as string;
  }

  private tokenPair(grantId: string, grant: Grant, scopes = grant.scopes) {
    const accessToken = opaqueToken('access');
    const refreshToken = opaqueToken('refresh');
    const record: TokenRecord = {
      kind: 'access',
      grantId,
      clientId: grant.clientId,
      scopes,
      resource: grant.resource,
      expiresAt: Math.min(this.now() + ACCESS_TOKEN_SECONDS, grant.expiresAt),
      used: false,
    };
    return {
      accessToken,
      refreshToken,
      record,
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: record.expiresAt - this.now(),
        scope: scopes.join(' '),
      } satisfies OAuthTokens,
    };
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ) {
    return this.db.runTransaction(async (transaction) => {
      const codeRef = this.ref('code', code);
      const codeSnapshot = await transaction.get(codeRef);
      const value = codeSnapshot.data();
      if (
        !value ||
        value.used ||
        value.expiresAt <= this.now() ||
        value.clientId !== client.client_id ||
        value.redirectUri !== redirectUri ||
        value.resource !== resource?.href
      ) {
        throw new InvalidGrantError('Invalid authorization code.');
      }
      const grantSnapshot = await transaction.get(this.ref('grant', value.grantId));
      const grant = grantSnapshot.data() as Grant | undefined;
      if (!grant || grant.revoked || grant.expiresAt <= this.now())
        throw new InvalidGrantError('Authorization revoked.');
      const pair = this.tokenPair(value.grantId, grant);
      transaction.update(codeRef, { used: true });
      transaction.create(this.ref('token', pair.accessToken), pair.record);
      transaction.create(this.ref('token', pair.refreshToken), {
        ...pair.record,
        kind: 'refresh',
        expiresAt: grant.expiresAt,
      });
      return pair.tokens;
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ) {
    const result = await this.db.runTransaction(async (transaction) => {
      const tokenRef = this.ref('token', refreshToken);
      const snapshot = await transaction.get(tokenRef);
      const token = snapshot.data() as TokenRecord | undefined;
      if (
        !token ||
        token.kind !== 'refresh' ||
        token.clientId !== client.client_id ||
        (resource && token.resource !== resource.href) ||
        token.expiresAt <= this.now()
      )
        throw new InvalidGrantError('Invalid refresh token.');
      const grantRef = this.ref('grant', token.grantId);
      const grant = (await transaction.get(grantRef)).data() as Grant | undefined;
      if (!grant || grant.revoked || grant.expiresAt <= this.now())
        throw new InvalidGrantError('Authorization revoked.');
      if (token.used) {
        transaction.update(grantRef, { revoked: true });
        return null;
      }
      const nextScopes = scopes ?? token.scopes;
      validateScopes(nextScopes);
      if (nextScopes.some((scope) => !token.scopes.includes(scope)))
        throw new InvalidScopeError('Refresh cannot expand scopes.');
      const pair = this.tokenPair(token.grantId, grant, nextScopes);
      transaction.update(tokenRef, { used: true });
      transaction.create(this.ref('token', pair.accessToken), pair.record);
      transaction.create(this.ref('token', pair.refreshToken), {
        ...pair.record,
        kind: 'refresh',
        expiresAt: grant.expiresAt,
      });
      return pair.tokens;
    });
    if (!result) throw new InvalidGrantError('Refresh token reuse revoked this connection.');
    return result;
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const snapshot = await this.ref('token', accessToken).get();
    const token = snapshot.data() as TokenRecord | undefined;
    if (
      !token ||
      token.kind !== 'access' ||
      token.expiresAt <= this.now() ||
      token.resource !== MCP_RESOURCE
    )
      throw new InvalidTokenError('Invalid access token.');
    const grant = (await this.ref('grant', token.grantId).get()).data() as Grant | undefined;
    if (
      !grant ||
      grant.revoked ||
      grant.expiresAt <= this.now() ||
      grant.clientId !== token.clientId ||
      grant.resource !== token.resource ||
      token.scopes.some((scope) => !grant.scopes.includes(scope))
    )
      throw new InvalidTokenError('Authorization revoked.');
    return {
      token: accessToken,
      clientId: token.clientId,
      scopes: token.scopes,
      expiresAt: token.expiresAt,
      resource: new URL(token.resource),
      extra: { grantId: token.grantId },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const token = (await this.ref('token', request.token).get()).data();
    if (token?.clientId === client.client_id)
      await this.ref('grant', token.grantId).update({ revoked: true });
  }

  async listConnections(ownerUid: string) {
    const snapshot = await this.db
      .collection('portfolioOAuth')
      .where('ownerUid', '==', ownerUid)
      .get();
    return snapshot.docs
      .map((document) => document.data())
      .filter((grant) => !grant.revoked && grant.expiresAt > this.now())
      .map((grant) => ({
        id: grant.grantId,
        scopes: grant.scopes,
        createdAt: grant.createdAt,
        expiresAt: grant.expiresAt,
      }));
  }

  async revokeConnection(grantId: string, ownerUid: string) {
    await this.db.runTransaction(async (transaction) => {
      const ref = this.ref('grant', grantId);
      const grant = (await transaction.get(ref)).data();
      if (!grant || grant.ownerUid !== ownerUid) throw new InvalidGrantError('Unknown connection.');
      transaction.update(ref, { revoked: true });
    });
    console.info('[portfolio-oauth]', JSON.stringify({ event: 'grant_revoked', grantId, ownerUid }));
  }

  async allowRequest(bucket: string, identity: string, limit: number, windowSeconds = 60) {
    const window = Math.floor(this.now() / windowSeconds);
    const key = createHmac('sha256', this.encryptionKey)
      .update(`${bucket}:${identity}:${window}`)
      .digest('hex');
    return this.db.runTransaction(async (transaction) => {
      const ref = this.db.collection('portfolioOAuthRateLimits').doc(key);
      const count = (await transaction.get(ref)).data()?.count ?? 0;
      if (count >= limit) return false;
      transaction.set(ref, { count: count + 1, expiresAt: (window + 1) * windowSeconds });
      return true;
    });
  }
}
