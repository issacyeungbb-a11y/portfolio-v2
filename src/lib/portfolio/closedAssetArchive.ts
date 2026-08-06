import type { AssetTransactionEntry, Holding } from '../../types/portfolio';

const CLOSED_QUANTITY_EPSILON = 1e-8;

export interface ClosedAssetArchiveEntry {
  assetId: string;
  assetName: string;
  symbol: string;
  assetType: AssetTransactionEntry['assetType'];
  accountSource: AssetTransactionEntry['accountSource'];
  currency: string;
  totalSoldQuantity: number;
  totalSaleProceeds: number;
  totalFees: number;
  realizedPnlHKD: number;
  lastExitDate: string;
  lastExitCreatedAt?: string;
  averageExitPrice: number;
  transactions: AssetTransactionEntry[];
}

export function buildClosedAssetArchiveEntries(
  transactions: AssetTransactionEntry[],
  holdings: Holding[] = [],
) {
  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]));
  const groupedTransactions = transactions.reduce<Record<string, AssetTransactionEntry[]>>(
    (accumulator, entry) => {
      if (!entry.assetId || entry.assetType === 'cash') {
        return accumulator;
      }

      accumulator[entry.assetId] = [...(accumulator[entry.assetId] ?? []), entry];
      return accumulator;
    },
    {},
  );

  return Object.entries(groupedTransactions)
    .flatMap<ClosedAssetArchiveEntry>(([assetId, assetTransactionsForAsset]) => {
      const sortedTransactions = [...assetTransactionsForAsset].sort((left, right) => {
        const dateDiff = left.date.localeCompare(right.date);
        if (dateDiff !== 0) return dateDiff;

        const createdDiff = (left.createdAt ?? '').localeCompare(right.createdAt ?? '');
        if (createdDiff !== 0) return createdDiff;

        return left.id.localeCompare(right.id);
      });
      const latestTransaction = sortedTransactions[sortedTransactions.length - 1];
      const holding = holdingById.get(assetId);
      const isClosed = holding
        ? Boolean(holding.archivedAt) || holding.quantity <= CLOSED_QUANTITY_EPSILON
        : (latestTransaction?.quantityAfter ?? 0) <= CLOSED_QUANTITY_EPSILON;

      if (!latestTransaction || !isClosed) {
        return [];
      }

      const sellTransactions = sortedTransactions.filter(
        (entry) => (entry.recordType ?? 'trade') === 'trade' && entry.transactionType === 'sell',
      );

      if (sellTransactions.length === 0) {
        return [];
      }

      const totalSoldQuantity = sellTransactions.reduce((sum, entry) => sum + entry.quantity, 0);
      const totalSaleProceeds = sellTransactions.reduce(
        (sum, entry) => sum + (entry.quantity * entry.price - entry.fees),
        0,
      );
      const totalFees = sellTransactions.reduce((sum, entry) => sum + entry.fees, 0);
      const realizedPnlHKD = sortedTransactions.reduce(
        (sum, entry) => sum + (entry.realizedPnlHKD || 0),
        0,
      );

      return [{
        assetId,
        assetName: latestTransaction.assetName,
        symbol: latestTransaction.symbol,
        assetType: latestTransaction.assetType,
        accountSource: latestTransaction.accountSource,
        currency: latestTransaction.currency,
        totalSoldQuantity,
        totalSaleProceeds,
        totalFees,
        realizedPnlHKD,
        lastExitDate: latestTransaction.date,
        lastExitCreatedAt: latestTransaction.createdAt,
        averageExitPrice: totalSoldQuantity === 0 ? 0 : totalSaleProceeds / totalSoldQuantity,
        transactions: sortedTransactions,
      }];
    })
    .sort((left, right) => {
      const dateDiff = right.lastExitDate.localeCompare(left.lastExitDate);
      if (dateDiff !== 0) return dateDiff;

      return (right.lastExitCreatedAt ?? '').localeCompare(left.lastExitCreatedAt ?? '');
    });
}
