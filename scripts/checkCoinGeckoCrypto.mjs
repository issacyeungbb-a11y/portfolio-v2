import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';
const COINGECKO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COINGECKO_SEARCH_MIN_INTERVAL_MS = 2100;
const COINGECKO_ID_OVERRIDES = {
  ASTER: { coinId: 'aster-2' },
  ATONE: { coinId: 'atomone' },
  NIGHT: { coinId: 'night' },
};

let lastSearchAt = 0;

function normalizeTicker(ticker) {
  return ticker.trim().toUpperCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleSearch() {
  const elapsed = Date.now() - lastSearchAt;

  if (elapsed < COINGECKO_SEARCH_MIN_INTERVAL_MS) {
    await sleep(COINGECKO_SEARCH_MIN_INTERVAL_MS - elapsed);
  }

  lastSearchAt = Date.now();
}

function readServiceAccount() {
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim();

  if (raw) {
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON 不是有效的 JSON。');
    }
    const projectId =
      typeof parsed.project_id === 'string'
        ? parsed.project_id.trim()
        : typeof parsed.projectId === 'string'
          ? parsed.projectId.trim()
          : '';
    const clientEmail =
      typeof parsed.client_email === 'string'
        ? parsed.client_email.trim()
        : typeof parsed.clientEmail === 'string'
          ? parsed.clientEmail.trim()
          : '';
    const privateKey =
      typeof parsed.private_key === 'string'
        ? parsed.private_key.replace(/\\n/g, '\n').trim()
        : typeof parsed.privateKey === 'string'
          ? parsed.privateKey.replace(/\\n/g, '\n').trim()
          : '';

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON 缺少 project_id、client_email 或 private_key。');
    }

    return { projectId, clientEmail, privateKey };
  }

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    '';
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() || '';
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim();

  if (!projectId && !clientEmail && !privateKey) {
    return null;
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin 設定不完整。請補上 FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON，或 FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY。',
    );
  }

  return { projectId, clientEmail, privateKey };
}

function getDb() {
  if (getApps().length > 0) {
    return getFirestore();
  }

  const serviceAccount = readServiceAccount();

  if (!serviceAccount) {
    throw new Error(
      '未設定 Firebase Admin 憑證。請設定 FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON，或 FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY。',
    );
  }

  initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId,
  });

  return getFirestore();
}

function getCacheDocRef(db, ticker) {
  return db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection('coinIdCache').doc(normalizeTicker(ticker));
}

function parseDate(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFresh(entry) {
  const expiresAt = parseDate(entry.expiresAt);
  return expiresAt ? expiresAt.getTime() > Date.now() : false;
}

function serializeEntry(entry) {
  return {
    ticker: entry.ticker,
    coinId: entry.coinId,
    coinSymbol: entry.coinSymbol,
    coinName: entry.coinName,
    marketCapRank: entry.marketCapRank,
    source: entry.source,
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt,
  };
}

function createEntry({ ticker, coinId, coinSymbol, coinName, marketCapRank, source }) {
  const now = new Date();
  return {
    ticker: normalizeTicker(ticker),
    coinId,
    coinSymbol,
    coinName,
    marketCapRank: typeof marketCapRank === 'number' && Number.isFinite(marketCapRank) ? marketCapRank : null,
    source,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + COINGECKO_CACHE_TTL_MS).toISOString(),
  };
}

function pickBestCoin(coins, ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  const exactMatches = coins.filter((coin) => normalizeTicker(coin.symbol) === normalizedTicker);
  const candidates = exactMatches.length > 0 ? exactMatches : coins;

  return [...candidates].sort((left, right) => {
    const leftRank = typeof left.market_cap_rank === 'number' ? left.market_cap_rank : Number.POSITIVE_INFINITY;
    const rightRank = typeof right.market_cap_rank === 'number' ? right.market_cap_rank : Number.POSITIVE_INFINITY;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftExact = normalizeTicker(left.symbol) === normalizedTicker ? 0 : 1;
    const rightExact = normalizeTicker(right.symbol) === normalizedTicker ? 0 : 1;

    if (leftExact !== rightExact) {
      return leftExact - rightExact;
    }

    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

async function readCache(db, ticker) {
  const doc = await getCacheDocRef(db, ticker).get();

  if (!doc.exists) {
    return null;
  }

  const data = doc.data();
  const coinId = typeof data.coinId === 'string' ? data.coinId.trim() : '';
  const coinSymbol = typeof data.coinSymbol === 'string' ? data.coinSymbol.trim() : '';
  const coinName = typeof data.coinName === 'string' ? data.coinName.trim() : '';
  const source = data.source === 'override' || data.source === 'search' ? data.source : null;
  const updatedAt = parseDate(data.updatedAt);
  const expiresAt = parseDate(data.expiresAt);
  const marketCapRank =
    typeof data.marketCapRank === 'number' && Number.isFinite(data.marketCapRank)
      ? data.marketCapRank
      : null;

  if (!coinId || !coinSymbol || !coinName || !source || !updatedAt || !expiresAt) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    coinId,
    coinSymbol,
    coinName,
    marketCapRank,
    source,
    updatedAt: updatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

async function writeCache(db, entry) {
  await getCacheDocRef(db, entry.ticker).set(serializeEntry(entry), { merge: true });
}

async function resolveCoinId(db, ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  const override = COINGECKO_ID_OVERRIDES[normalizedTicker];

  if (override) {
    const entry = createEntry({
      ticker: normalizedTicker,
      coinId: override.coinId,
      coinSymbol: normalizedTicker,
      coinName: normalizedTicker,
      marketCapRank: null,
      source: 'override',
    });
    await writeCache(db, entry);
    return { entry, status: 'override' };
  }

  const cached = await readCache(db, normalizedTicker);
  if (cached && isFresh(cached)) {
    return { entry: cached, status: 'cache' };
  }

  try {
    await throttleSearch();
    const response = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(normalizedTicker)}`);

    if (!response.ok) {
      throw new Error(`CoinGecko search HTTP ${response.status}`);
    }

    const payload = await response.json();
    const bestCoin = pickBestCoin(Array.isArray(payload.coins) ? payload.coins : [], normalizedTicker);

    if (!bestCoin) {
      return cached ? { entry: cached, status: 'fallback_cache' } : { entry: null, status: 'missing' };
    }

    const entry = createEntry({
      ticker: normalizedTicker,
      coinId: bestCoin.id,
      coinSymbol: String(bestCoin.symbol ?? '').toUpperCase(),
      coinName: String(bestCoin.name ?? ''),
      marketCapRank: typeof bestCoin.market_cap_rank === 'number' ? bestCoin.market_cap_rank : null,
      source: 'search',
    });

    await writeCache(db, entry);
    return { entry, status: 'search' };
  } catch (error) {
    if (cached) {
      return { entry: cached, status: 'fallback_cache', error };
    }

    return { entry: null, status: 'lookup_failed', error };
  }
}

async function fetchCoinPriceById(coinId, apiKey) {
  const headers = {};
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd&include_last_updated_at=true`,
    { headers },
  );

  if (!response.ok) {
    throw new Error(`CoinGecko price HTTP ${response.status}`);
  }

  const payload = await response.json();
  return payload?.[coinId] ?? null;
}

function parseTickersArg() {
  const arg = process.argv.find((value) => value.startsWith('--tickers='));
  if (!arg) {
    return null;
  }

  const value = arg.slice('--tickers='.length).trim();
  if (!value) {
    return null;
  }

  return value.split(',').map((item) => normalizeTicker(item)).filter(Boolean);
}

async function readCryptoTickersFromFirestore(db) {
  const snapshot = await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('assets')
    .get();

  const tickers = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .filter((asset) => asset.assetType === 'crypto')
    .map((asset) => normalizeTicker(asset.symbol))
    .filter(Boolean);

  return [...new Set(tickers)];
}

async function main() {
  const db = getDb();
  const requestedTickers = parseTickersArg() ?? (await readCryptoTickersFromFirestore(db));

  if (requestedTickers.length === 0) {
    console.log('No crypto tickers found.');
    process.exit(0);
  }

  const apiKey = process.env.COINGECKO_API_KEY?.trim() || '';
  const resolutionResults = [];

  for (const ticker of requestedTickers) {
    const resolution = await resolveCoinId(db, ticker);
    let priceResult = null;

    if (resolution.entry) {
      try {
        priceResult = await fetchCoinPriceById(resolution.entry.coinId, apiKey);
      } catch (error) {
        resolutionResults.push({
          ticker,
          status: resolution.status,
          coinId: resolution.entry.coinId,
          priceStatus: 'lookup_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    resolutionResults.push({
      ticker,
      status: resolution.status,
      coinId: resolution.entry?.coinId ?? null,
      coinSymbol: resolution.entry?.coinSymbol ?? null,
      marketCapRank: resolution.entry?.marketCapRank ?? null,
      priceStatus: priceResult && typeof priceResult.usd === 'number' && priceResult.usd > 0 ? 'ok' : 'missing',
      price: priceResult?.usd ?? null,
      lastUpdatedAt: priceResult?.last_updated_at ? new Date(priceResult.last_updated_at * 1000).toISOString() : null,
    });
  }

  console.table(resolutionResults);
  const unresolved = resolutionResults.filter((result) => result.priceStatus !== 'ok');

  if (unresolved.length > 0) {
    console.error(`Found ${unresolved.length} unresolved crypto price lookup(s).`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
