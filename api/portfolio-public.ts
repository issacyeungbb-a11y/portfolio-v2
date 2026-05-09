import { sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';

const ROUTE = '/api/portfolio-public';

type PublicAssetRecord = {
  id: string;
  name: string;
  symbol: string;
  assetType: string;
  accountSource: string;
  currency: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  priceAsOf: string;
  lastPriceUpdatedAt: string;
};

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
};

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

type FirestoreListResponse = {
  documents?: FirestoreDocument[];
  nextPageToken?: string;
  error?: {
    message?: string;
  };
};

function getConfiguredAccessCode() {
  return (
    process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() ||
    process.env.PORTFOLIO_ACCESS_CODE?.trim() ||
    ''
  );
}

function getFirebaseProjectId() {
  return (
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    ''
  );
}

function getQueryCode(request: ApiRequest) {
  try {
    return new URL(request.url ?? ROUTE, 'http://localhost').searchParams.get('code')?.trim() ?? '';
  } catch {
    return '';
  }
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function getFirestoreDocumentId(name: string) {
  return name.split('/').pop() ?? name;
}

function readFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) {
    return undefined;
  }

  if ('stringValue' in value) {
    return value.stringValue ?? '';
  }

  if ('integerValue' in value) {
    return toNumber(value.integerValue);
  }

  if ('doubleValue' in value) {
    return toNumber(value.doubleValue);
  }

  if ('booleanValue' in value) {
    return value.booleanValue === true;
  }

  if ('timestampValue' in value) {
    return value.timestampValue ?? '';
  }

  return undefined;
}

function readFirestoreFields(fields: Record<string, FirestoreValue> | undefined) {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields ?? {})) {
    result[key] = readFirestoreValue(value);
  }

  return result;
}

function isArchived(value: Record<string, unknown>) {
  return Boolean(value.archivedAt) || value.archived === true;
}

function buildPublicAsset(id: string, value: Record<string, unknown>): PublicAssetRecord {
  const assetType = toStringValue(value.assetType);
  const quantity = toNumber(value.quantity);
  const averageCost = toNumber(value.averageCost);
  const currentPrice = toNumber(value.currentPrice);
  const fallbackMarketValue = assetType === 'cash' ? currentPrice : quantity * currentPrice;
  const marketValue = value.marketValue == null ? fallbackMarketValue : toNumber(value.marketValue);
  const costBasis = assetType === 'cash' ? averageCost : quantity * averageCost;
  const fallbackUnrealizedPnl = marketValue - costBasis;
  const unrealizedPnl =
    value.unrealizedPnl == null ? fallbackUnrealizedPnl : toNumber(value.unrealizedPnl);
  const unrealizedPct =
    value.unrealizedPct == null
      ? costBasis === 0
        ? 0
        : (unrealizedPnl / costBasis) * 100
      : toNumber(value.unrealizedPct);

  return {
    id,
    name: toStringValue(value.name),
    symbol: toStringValue(value.symbol),
    assetType,
    accountSource: toStringValue(value.accountSource),
    currency: toStringValue(value.currency),
    quantity,
    averageCost,
    currentPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    priceAsOf: toStringValue(value.priceAsOf),
    lastPriceUpdatedAt: toStringValue(value.lastPriceUpdatedAt),
  };
}

async function fetchAssetDocuments(projectId: string) {
  const documents: FirestoreDocument[] = [];
  let pageToken = '';

  do {
    const searchParams = new URLSearchParams({ pageSize: '100' });

    if (pageToken) {
      searchParams.set('pageToken', pageToken);
    }

    const firestoreUrl =
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/databases/(default)/documents/portfolio/app/assets?${searchParams.toString()}`;
    const firestoreResponse = await fetch(firestoreUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = (await firestoreResponse.json()) as FirestoreListResponse;

    if (!firestoreResponse.ok) {
      throw new Error(payload.error?.message ?? 'Failed to load portfolio assets');
    }

    documents.push(...(payload.documents ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);

  return documents;
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      message: 'Method not allowed',
    });
    return;
  }

  const configuredCode = getConfiguredAccessCode();
  const requestCode = getQueryCode(request);

  if (!configuredCode || requestCode !== configuredCode) {
    sendJson(response, 401, {
      ok: false,
      message: 'Unauthorized',
    });
    return;
  }

  try {
    const projectId = getFirebaseProjectId();

    if (!projectId) {
      throw new Error('Missing Firebase project id');
    }

    const documents = await fetchAssetDocuments(projectId);
    const assets = documents
      .map((document) => ({
        id: getFirestoreDocumentId(document.name),
        value: readFirestoreFields(document.fields),
      }))
      .filter((entry) => !isArchived(entry.value))
      .map((entry) => buildPublicAsset(entry.id, entry.value));

    response.setHeader('Cache-Control', 'no-store');
    sendJson(response, 200, {
      ok: true,
      assets,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to load portfolio assets',
    });
  }
}
