import type {
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from './firebaseAdmin';

function serializeFirestoreValue(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeFirestoreValue(entry));
  }

  if (typeof value === 'object') {
    const candidate = value as {
      toDate?: () => Date;
      [key: string]: unknown;
    };

    if (typeof candidate.toDate === 'function') {
      return candidate.toDate().toISOString();
    }

    return Object.fromEntries(
      Object.entries(candidate).map(([key, entry]) => [
        key,
        serializeFirestoreValue(entry),
      ]),
    );
  }

  return value;
}

function serializeDocument(
  document: QueryDocumentSnapshot<DocumentData>,
) {
  return {
    id: document.id,
    ...(serializeFirestoreValue(document.data()) as Record<string, unknown>),
  };
}

export async function readCryptoHistory() {
  const portfolioRef = getFirebaseAdminDb().collection('portfolio').doc('app');
  const [snapshots, imports, syncRuns] = await Promise.all([
    portfolioRef.collection('cryptoMonthlySnapshots').orderBy('month', 'asc').get(),
    portfolioRef
      .collection('cryptoHistoricalImports')
      .orderBy('importedAt', 'desc')
      .limit(1)
      .get(),
    portfolioRef
      .collection('cryptoSyncRuns')
      .orderBy('finishedAt', 'desc')
      .limit(1)
      .get(),
  ]);

  return {
    snapshots: snapshots.docs.map(serializeDocument),
    latestImport: imports.docs[0] ? serializeDocument(imports.docs[0]) : null,
    latestSync: syncRuns.docs[0] ? serializeDocument(syncRuns.docs[0]) : null,
  };
}
