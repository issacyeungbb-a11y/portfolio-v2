import { createSign, randomBytes } from 'node:crypto';

const PROJECT_ID = process.env.FIREBASE_ADMIN_PROJECT_ID;
const CLIENT_EMAIL = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
const APPLY_CHANGES = process.argv.includes('--apply');
const PORTFOLIO_PATH = `projects/${PROJECT_ID}/databases/(default)/documents/portfolio/app`;
const ASSETS_URL = `https://firestore.googleapis.com/v1/${PORTFOLIO_PATH}/assets?pageSize=1000`;

const julyAssets = [
  { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto', quantity: 0.6191466, currentPrice: 64386 },
  { name: 'Ethereum', symbol: 'ETH', assetType: 'crypto', quantity: 5.47003, currentPrice: 1822.03 },
  { name: 'Cardano', symbol: 'ADA', assetType: 'crypto', quantity: 25772.59451934, currentPrice: 0.17253 },
  { name: 'BNB', symbol: 'BNB', assetType: 'crypto', quantity: 1.0182448, currentPrice: 580.53 },
  { name: 'Cronos', symbol: 'CRO', assetType: 'crypto', quantity: 6625.2325, currentPrice: 0.056653 },
  { name: 'Cosmos', symbol: 'ATOM', assetType: 'crypto', quantity: 92.90442, currentPrice: 1.59 },
  { name: 'AtomOne', symbol: 'ATONE', assetType: 'crypto', quantity: 1458.98279, currentPrice: 0.19089 },
  { name: 'Osmosis', symbol: 'OSMO', assetType: 'crypto', quantity: 190.132, currentPrice: 0.03605684 },
  { name: 'Photon', symbol: 'PHOTON', assetType: 'crypto', quantity: 8.247679, currentPrice: 0 },
  { name: 'SNEK', symbol: 'SNEK', assetType: 'crypto', quantity: 365529, currentPrice: 0.00033829 },
  { name: 'Worldcoin', symbol: 'WLD', assetType: 'crypto', quantity: 76.6, currentPrice: 0.409347 },
  { name: 'NEAR Protocol', symbol: 'NEAR', assetType: 'crypto', quantity: 114.46492, currentPrice: 1.91 },
  { name: 'USDT', symbol: 'USDT', assetType: 'cash', quantity: 1, currentPrice: 895.78368696 },
  { name: 'USD Coin', symbol: 'USDC', assetType: 'crypto', quantity: 2.0072, currentPrice: 0.999873 },
];

function requireEnvironment() {
  const missing = [
    ['FIREBASE_ADMIN_PROJECT_ID', PROJECT_ID],
    ['FIREBASE_ADMIN_CLIENT_EMAIL', CLIENT_EMAIL],
    ['FIREBASE_ADMIN_PRIVATE_KEY', PRIVATE_KEY],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.map(([name]) => name).join(', ')}`);
  }
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJwtPart({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJwtPart({
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${signer.sign(PRIVATE_KEY, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Unable to obtain Firebase access token (${response.status}).`);
  }

  return (await response.json()).access_token;
}

async function fetchJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Firebase request failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

function decodeValue(value) {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('booleanValue' in value) return value.booleanValue;
  return null;
}

function decodeDocuments(response) {
  return (response.documents ?? []).map((document) => ({
    id: document.name.split('/').pop(),
    documentName: document.name,
    updateTime: document.updateTime,
    fields: Object.fromEntries(
      Object.entries(document.fields ?? {}).map(([key, value]) => [key, decodeValue(value)]),
    ),
  }));
}

function firestoreValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: value };
}

function assetFields(asset, averageCost, now) {
  const cashAmount = asset.assetType === 'cash' ? asset.currentPrice : averageCost;
  return {
    name: firestoreValue(asset.name),
    symbol: firestoreValue(asset.symbol),
    assetType: firestoreValue(asset.assetType),
    accountSource: firestoreValue('Crypto'),
    currency: firestoreValue('USD'),
    quantity: firestoreValue(asset.quantity),
    averageCost: firestoreValue(cashAmount),
    currentPrice: firestoreValue(asset.currentPrice),
    updatedAt: { timestampValue: now },
  };
}

function randomDocumentId() {
  return randomBytes(15).toString('base64url').slice(0, 20);
}

function makeUpdateWrite(document, asset, now) {
  const fields = assetFields(asset, document.fields.averageCost ?? 0, now);
  return {
    update: { name: document.documentName, fields },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { updateTime: document.updateTime },
  };
}

function makeArchiveWrite(document, now) {
  return {
    update: {
      name: document.documentName,
      fields: {
        archivedAt: { timestampValue: now },
        updatedAt: { timestampValue: now },
      },
    },
    updateMask: { fieldPaths: ['archivedAt', 'updatedAt'] },
    currentDocument: { updateTime: document.updateTime },
  };
}

function makeCreateWrites(asset, now) {
  const assetId = randomDocumentId();
  const transactionId = randomDocumentId();
  const averageCost = asset.assetType === 'cash' ? asset.currentPrice : 0;
  const fields = {
    ...assetFields(asset, averageCost, now),
    createdAt: { timestampValue: now },
  };
  const assetDocumentName = `${PORTFOLIO_PATH}/assets/${assetId}`;
  const transactionDocumentName = `${PORTFOLIO_PATH}/assetTransactions/${transactionId}`;

  return [
    {
      update: { name: assetDocumentName, fields },
      currentDocument: { exists: false },
    },
    {
      update: {
        name: transactionDocumentName,
        fields: {
          assetId: firestoreValue(assetId),
          assetName: firestoreValue(asset.name),
          symbol: firestoreValue(asset.symbol),
          assetType: firestoreValue(asset.assetType),
          accountSource: firestoreValue('Crypto'),
          transactionType: firestoreValue('buy'),
          recordType: firestoreValue('seed'),
          quantity: firestoreValue(asset.quantity),
          price: firestoreValue(averageCost),
          fees: firestoreValue(0),
          currency: firestoreValue('USD'),
          date: firestoreValue('2026-07-14'),
          realizedPnlHKD: firestoreValue(0),
          quantityAfter: firestoreValue(asset.quantity),
          averageCostAfter: firestoreValue(averageCost),
          note: firestoreValue('按 2026-07 快照新增資產'),
          createdAt: { timestampValue: now },
          updatedAt: { timestampValue: now },
        },
      },
      currentDocument: { exists: false },
    },
  ];
}

function findExistingAsset(asset, activeCryptoAssets) {
  if (asset.assetType === 'cash') {
    return activeCryptoAssets.find(
      (document) => document.fields.assetType === 'cash' && document.fields.currency === 'USD',
    );
  }

  return activeCryptoAssets.find((document) => document.fields.symbol === asset.symbol);
}

function summarize(activeCryptoAssets, updates, additions, removals) {
  console.log(`Current active Crypto assets: ${activeCryptoAssets.length}`);
  console.log(`Update: ${updates.join(', ') || 'none'}`);
  console.log(`Add: ${additions.join(', ') || 'none'}`);
  console.log(`Archive: ${removals.join(', ') || 'none'}`);
  console.log('USDT liability is intentionally excluded; USDT is stored as cash.');
}

async function main() {
  requireEnvironment();
  const accessToken = await getAccessToken();
  const beforeDocuments = decodeDocuments(await fetchJson(ASSETS_URL, accessToken));
  const untouchedBefore = new Map(
    beforeDocuments
      .filter((document) => document.fields.accountSource !== 'Crypto')
      .map((document) => [document.id, document.updateTime]),
  );
  const activeCryptoAssets = beforeDocuments.filter(
    (document) => document.fields.accountSource === 'Crypto' && !document.fields.archivedAt,
  );
  const now = new Date().toISOString();
  const writes = [];
  const matchedIds = new Set();
  const updates = [];
  const additions = [];

  for (const asset of julyAssets) {
    const existing = findExistingAsset(asset, activeCryptoAssets);
    if (existing) {
      matchedIds.add(existing.id);
      updates.push(asset.symbol);
      writes.push(makeUpdateWrite(existing, asset, now));
    } else {
      additions.push(asset.symbol);
      writes.push(...makeCreateWrites(asset, now));
    }
  }

  const assetsToArchive = activeCryptoAssets.filter((document) => !matchedIds.has(document.id));
  for (const document of assetsToArchive) {
    writes.push(makeArchiveWrite(document, now));
  }

  summarize(
    activeCryptoAssets,
    updates,
    additions,
    assetsToArchive.map((document) => document.fields.symbol),
  );

  if (!APPLY_CHANGES) {
    console.log('Dry run only. Pass --apply to commit the atomic Firebase update.');
    return;
  }

  await fetchJson(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    accessToken,
    { method: 'POST', body: JSON.stringify({ writes }) },
  );

  const afterDocuments = decodeDocuments(await fetchJson(ASSETS_URL, accessToken));
  const activeAfter = afterDocuments.filter(
    (document) => document.fields.accountSource === 'Crypto' && !document.fields.archivedAt,
  );
  const actualBySymbol = new Map(activeAfter.map((document) => [document.fields.symbol, document]));

  for (const expected of julyAssets) {
    const actual = actualBySymbol.get(expected.symbol);
    if (!actual) throw new Error(`Verification failed: missing ${expected.symbol}.`);
    const expectedQuantity = expected.assetType === 'cash' ? 1 : expected.quantity;
    if (
      actual.fields.assetType !== expected.assetType ||
      actual.fields.quantity !== expectedQuantity ||
      actual.fields.currentPrice !== expected.currentPrice
    ) {
      throw new Error(`Verification failed: ${expected.symbol} does not match the July snapshot.`);
    }
  }

  if (activeAfter.length !== julyAssets.length) {
    throw new Error(`Verification failed: expected ${julyAssets.length} active Crypto assets.`);
  }

  const changedOtherAccount = afterDocuments
    .filter((document) => document.fields.accountSource !== 'Crypto')
    .find((document) => untouchedBefore.get(document.id) !== document.updateTime);

  if (changedOtherAccount) {
    throw new Error(`Verification failed: non-Crypto asset ${changedOtherAccount.id} changed.`);
  }

  console.log(`Verified active Crypto assets: ${activeAfter.length}`);
  console.log(`Verified untouched non-Crypto assets: ${untouchedBefore.size}`);
  console.log('Firebase update completed successfully.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
