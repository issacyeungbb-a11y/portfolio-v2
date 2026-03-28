import { useEffect, useState } from 'react';

import type { PendingPriceUpdateReview } from '../types/priceUpdates';
import {
  confirmPriceUpdateReview,
  dismissPriceUpdateReview,
  getPriceReviewsErrorMessage,
  savePendingPriceUpdateReviews,
  subscribeToPriceUpdateReviews,
} from '../lib/firebase/priceReviews';

type PriceReviewStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PriceReviewState {
  status: PriceReviewStatus;
  reviews: PendingPriceUpdateReview[];
  error: string | null;
}

export function usePriceUpdateReviews(uid: string | null) {
  const [state, setState] = useState<PriceReviewState>({
    status: uid ? 'loading' : 'idle',
    reviews: [],
    error: null,
  });

  useEffect(() => {
    if (!uid) {
      setState({
        status: 'idle',
        reviews: [],
        error: null,
      });
      return;
    }

    setState((current) => ({
      status: 'loading',
      reviews: current.reviews,
      error: null,
    }));

    const unsubscribe = subscribeToPriceUpdateReviews(
      uid,
      (reviews) => {
        setState({
          status: 'ready',
          reviews,
          error: null,
        });
      },
      (error) => {
        setState({
          status: 'error',
          reviews: [],
          error: getPriceReviewsErrorMessage(error),
        });
      },
    );

    return unsubscribe;
  }, [uid]);

  async function saveReviews(reviews: PendingPriceUpdateReview[]) {
    if (!uid) {
      throw new Error('匿名身份尚未完成，請稍後再試。');
    }

    try {
      await savePendingPriceUpdateReviews(uid, reviews);
    } catch (error) {
      const message = getPriceReviewsErrorMessage(error);
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
  }

  async function confirmReview(review: PendingPriceUpdateReview) {
    if (!uid) {
      throw new Error('匿名身份尚未完成，請稍後再試。');
    }

    try {
      await confirmPriceUpdateReview(uid, review);
    } catch (error) {
      const message = getPriceReviewsErrorMessage(error);
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
  }

  async function dismissReview(assetId: string) {
    if (!uid) {
      throw new Error('匿名身份尚未完成，請稍後再試。');
    }

    try {
      await dismissPriceUpdateReview(uid, assetId);
    } catch (error) {
      const message = getPriceReviewsErrorMessage(error);
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
  }

  return {
    ...state,
    hasPendingReviews: state.reviews.length > 0,
    saveReviews,
    confirmReview,
    dismissReview,
  };
}
