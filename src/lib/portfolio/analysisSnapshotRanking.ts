import { convertToHKDValue } from '../currency.js';

export function sortAnalysisHoldingsByHKD<T extends { marketValue: number; currency: string }>(
  holdings: T[],
) {
  return [...holdings].sort(
    (left, right) =>
      convertToHKDValue(right.marketValue, right.currency) -
      convertToHKDValue(left.marketValue, left.currency),
  );
}
