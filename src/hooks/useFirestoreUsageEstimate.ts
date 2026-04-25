import { useCallback, useEffect, useState } from 'react';
import { getCountFromServer, query, where } from 'firebase/firestore';

import { hasFirebaseConfig, missingFirebaseEnvKeys } from '../lib/firebase/client';
import {
  getSharedAccountCashFlowsCollectionRef,
  getSharedAssetsCollectionRef,
  getSharedAssetTransactionsCollectionRef,
  getSharedPortfolioSnapshotsCollectionRef,
  getSharedPriceReviewsCollectionRef,
} from '../lib/firebase/sharedPortfolio';

const TRANSACTION_READ_LIMIT = 300;
const SNAPSHOT_READ_LIMIT = 365;

export interface FirestoreUsageEstimateRow {
  label: string;
  documentCount: number;
  estimatedReadCount: number;
  note: string;
}

export interface FirestoreUsageEstimateResult {
  rows: FirestoreUsageEstimateRow[];
  totalDocuments: number;
  estimatedReads: number;
  estimatedWrites: number;
  readQuotaPct: number;
  writeQuotaPct: number;
  refreshedAt: string | null;
}

type FirestoreUsageEstimateStatus = 'idle' | 'loading' | 'ready' | 'error';

interface FirestoreUsageEstimateState {
  status: FirestoreUsageEstimateStatus;
  result: FirestoreUsageEstimateResult | null;
  error: string | null;
}

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

async function readCollectionCount(
  collectionQuery: Parameters<typeof getCountFromServer>[0],
) {
  const snapshot = await getCountFromServer(collectionQuery);
  return snapshot.data().count;
}

function buildEstimateResult(rows: FirestoreUsageEstimateRow[]): FirestoreUsageEstimateResult {
  const totalDocuments = rows.reduce((sum, row) => sum + row.documentCount, 0);
  const estimatedReads = rows.reduce((sum, row) => sum + row.estimatedReadCount, 0);
  const estimatedWrites = 0;

  return {
    rows,
    totalDocuments,
    estimatedReads,
    estimatedWrites,
    readQuotaPct: (estimatedReads / 50000) * 100,
    writeQuotaPct: (estimatedWrites / 20000) * 100,
    refreshedAt: new Date().toISOString(),
  };
}

export function useFirestoreUsageEstimate(enabled: boolean) {
  const [state, setState] = useState<FirestoreUsageEstimateState>({
    status: 'idle',
    result: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    if (!hasFirebaseConfig) {
      setState({
        status: 'error',
        result: null,
        error: `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`,
      });
      return;
    }

    setState((current) => ({
      status: 'loading',
      result: current.result,
      error: null,
    }));

    try {
      const [
        assetsCount,
        assetTransactionsCount,
        portfolioSnapshotsCount,
        pendingReviewsCount,
        accountCashFlowsCount,
      ] = await Promise.all([
        readCollectionCount(query(getSharedAssetsCollectionRef())),
        readCollectionCount(query(getSharedAssetTransactionsCollectionRef())),
        readCollectionCount(query(getSharedPortfolioSnapshotsCollectionRef())),
        readCollectionCount(
          query(getSharedPriceReviewsCollectionRef(), where('status', '==', 'pending')),
        ),
        readCollectionCount(query(getSharedAccountCashFlowsCollectionRef())),
      ]);

      setState({
        status: 'ready',
        result: buildEstimateResult([
          {
            label: 'assets',
            documentCount: assetsCount,
            estimatedReadCount: assetsCount,
            note: '全量讀取',
          },
          {
            label: 'assetTransactions',
            documentCount: assetTransactionsCount,
            estimatedReadCount: Math.min(assetTransactionsCount, TRANSACTION_READ_LIMIT),
            note: `只計最近 ${TRANSACTION_READ_LIMIT} 筆`,
          },
          {
            label: 'portfolioSnapshots',
            documentCount: portfolioSnapshotsCount,
            estimatedReadCount: Math.min(portfolioSnapshotsCount, SNAPSHOT_READ_LIMIT),
            note: `只計最近 ${SNAPSHOT_READ_LIMIT} 筆`,
          },
          {
            label: 'priceUpdateReviews',
            documentCount: pendingReviewsCount,
            estimatedReadCount: pendingReviewsCount,
            note: '只計 status = pending',
          },
          {
            label: 'accountCashFlows',
            documentCount: accountCashFlowsCount,
            estimatedReadCount: accountCashFlowsCount,
            note: '全量讀取',
          },
        ]),
        error: null,
      });
    } catch (error) {
      setState({
        status: 'error',
        result: null,
        error: error instanceof Error ? error.message : 'Firestore 用量估算失敗。',
      });
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}
