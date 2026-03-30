import { useEffect, useState } from 'react';

import type { PendingPriceUpdateReview } from '../types/priceUpdates';
import {
  applyPriceUpdateReviews,
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

export function usePriceUpdateReviews() {
  const [state, setState] = useState<PriceReviewState>({
    status: 'loading',
    reviews: [],
    error: null,
  });

  useEffect(() => {
    setState((current) => ({
      status: 'loading',
      reviews: current.reviews,
      error: null,
    }));

    const unsubscribe = subscribeToPriceUpdateReviews(
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
  }, []);

  async function saveReviews(reviews: PendingPriceUpdateReview[]) {
    try {
      await savePendingPriceUpdateReviews(reviews);
    } catch (error) {
      const message = getPriceReviewsErrorMessage(error);
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
  }

  async function confirmReview(review: PendingPriceUpdateReview) {
    try {
      await confirmPriceUpdateReview(review);
    } catch (error) {
      const message = getPriceReviewsErrorMessage(error);
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
  }

  async function applyReviews(reviews: PendingPriceUpdateReview[]) {
    try {
      await applyPriceUpdateReviews(reviews);
    } catch (error) {
      const message = getPriceReviewsErrorMessage(error);
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
  }

  async function dismissReview(assetId: string) {
    try {
      await dismissPriceUpdateReview(assetId);
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
    applyReviews,
    confirmReview,
    dismissReview,
  };
}
