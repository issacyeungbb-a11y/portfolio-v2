import { collection, doc } from 'firebase/firestore';

import { firebaseDb, hasFirebaseConfig, missingFirebaseEnvKeys } from './client';

export const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
export const SHARED_PORTFOLIO_DOC_ID = 'app';

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

export function getRequiredFirebaseDb() {
  if (!hasFirebaseConfig || !firebaseDb) {
    throw createMissingConfigError();
  }

  return firebaseDb;
}

export function getSharedPortfolioDocRef() {
  const db = getRequiredFirebaseDb();
  return doc(db, SHARED_PORTFOLIO_COLLECTION, SHARED_PORTFOLIO_DOC_ID);
}

export function getSharedAssetsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(db, SHARED_PORTFOLIO_COLLECTION, SHARED_PORTFOLIO_DOC_ID, 'assets');
}

export function getSharedPriceReviewsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'priceUpdateReviews',
  );
}

export function getSharedAccountPrincipalsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'accountPrincipals',
  );
}

export function getSharedAccountCashFlowsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'accountCashFlows',
  );
}

export function getSharedAssetTransactionsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'assetTransactions',
  );
}

export function getSharedAnalysisCacheDocRef(snapshotHash: string) {
  const db = getRequiredFirebaseDb();
  return doc(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'analysisCache',
    snapshotHash,
  );
}

export function getSharedAnalysisSessionsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'analysisSessions',
  );
}

export function getSharedAnalysisThreadsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'analysisThreads',
  );
}

export function getSharedQuarterlyReportsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'quarterlyReports',
  );
}

export function getSharedAnalysisSettingsDocRef(settingId = 'prompts') {
  const db = getRequiredFirebaseDb();
  return doc(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'analysisSettings',
    settingId,
  );
}

export function getSharedPortfolioSnapshotsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'portfolioSnapshots',
  );
}

export function getSharedAnalysisThreadTurnsCollectionRef(threadId: string) {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'analysisThreads',
    threadId,
    'turns',
  );
}

export function getSharedAssetPriceHistoryCollectionRef(assetId: string) {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'assets',
    assetId,
    'priceHistory',
  );
}
