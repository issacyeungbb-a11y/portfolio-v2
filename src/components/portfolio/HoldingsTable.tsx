import { useState } from 'react';

import {
  convertCurrency,
  getAccountSourceLabel,
  getAssetTypeLabel,
  formatCurrency,
  formatCurrencyRounded,
  formatPercent,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
} from '../../data/mockPortfolio';
import { hasValidHoldingPrice, isHoldingPriceStale } from '../../lib/portfolio/priceValidity';
import type { DisplayCurrency, Holding } from '../../types/portfolio';

interface HoldingsTableProps {
  holdings: Holding[];
  displayCurrency: DisplayCurrency;
  onUpdatePrice?: (holding: Holding) => Promise<void> | void;
  onEdit?: (holding: Holding) => void;
  onTrade?: (holding: Holding) => void;
  updatingAssetIds?: string[];
  pendingPriceUpdateReasons?: Record<string, string>;
}

type HoldingsSortKey =
  | 'name'
  | 'marketValue'
  | 'currentPrice'
  | 'unrealizedPnl'
  | 'allocation'
  | 'assetType'
  | 'accountSource';

type HoldingsSortDirection = 'asc' | 'desc';

export function HoldingsTable({
  holdings,
  displayCurrency,
  onUpdatePrice,
  onEdit,
  onTrade,
  updatingAssetIds = [],
  pendingPriceUpdateReasons = {},
}: HoldingsTableProps) {
  const [sortKey, setSortKey] = useState<HoldingsSortKey>('marketValue');
  const [sortDirection, setSortDirection] = useState<HoldingsSortDirection>('desc');

  function handleSort(nextKey: HoldingsSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === 'name' || nextKey === 'assetType' || nextKey === 'accountSource' ? 'asc' : 'desc');
  }

  function getSortIndicator(key: HoldingsSortKey) {
    if (sortKey !== key) {
      return '↕';
    }

    return sortDirection === 'desc' ? '↓' : '↑';
  }

  const sortedHoldings = [...holdings].sort((left, right) => {
    const leftMarketValue = getHoldingValueInCurrency(left, displayCurrency);
    const rightMarketValue = getHoldingValueInCurrency(right, displayCurrency);
    const leftCurrentPrice = convertCurrency(left.currentPrice, left.currency, displayCurrency);
    const rightCurrentPrice = convertCurrency(right.currentPrice, right.currency, displayCurrency);
    const leftCost = getHoldingCostInCurrency(left, displayCurrency);
    const rightCost = getHoldingCostInCurrency(right, displayCurrency);
    const leftPnl = leftMarketValue - leftCost;
    const rightPnl = rightMarketValue - rightCost;

    let comparison = 0;

    switch (sortKey) {
      case 'name':
        comparison = left.symbol.localeCompare(right.symbol, 'en', { sensitivity: 'base' });
        break;
      case 'marketValue':
        comparison = leftMarketValue - rightMarketValue;
        break;
      case 'currentPrice':
        comparison = leftCurrentPrice - rightCurrentPrice;
        break;
      case 'unrealizedPnl':
        comparison = leftPnl - rightPnl;
        break;
      case 'allocation':
        comparison = left.allocation - right.allocation;
        break;
      case 'assetType':
        comparison = getAssetTypeLabel(left.assetType).localeCompare(getAssetTypeLabel(right.assetType), 'zh-HK');
        break;
      case 'accountSource':
        comparison = getAccountSourceLabel(left.accountSource).localeCompare(
          getAccountSourceLabel(right.accountSource),
          'zh-HK',
        );
        break;
    }

    if (comparison === 0) {
      comparison = left.symbol.localeCompare(right.symbol, 'en', { sensitivity: 'base' });
    }

    return sortDirection === 'desc' ? -comparison : comparison;
  });

  function renderPnlMetric(
    marketValue: number,
    costValue: number,
    hasPendingPrice: boolean,
    pendingReason?: string,
  ) {
    const unrealizedPnl = marketValue - costValue;
    const unrealizedPct = costValue === 0 ? 0 : (unrealizedPnl / costValue) * 100;
    const pnlTone = unrealizedPnl >= 0 ? 'positive' : 'caution';

    if (hasPendingPrice) {
      return (
        <div className="table-metric table-metric-pending">
          <strong className="table-metric-primary">待更新</strong>
          <span className="table-metric-secondary table-metric-reason">
            {pendingReason || '價格過舊'}
          </span>
        </div>
      );
    }

    return (
      <div className="table-metric">
        <strong className="table-metric-primary" data-tone={pnlTone}>
          {formatCurrencyRounded(unrealizedPnl, displayCurrency)}
        </strong>
        <span className="table-metric-secondary">{formatPercent(unrealizedPct)}</span>
      </div>
    );
  }

  return (
    <div className="holdings-table-shell">
      <div className="table-scroll">
        <table className="holdings-table">
          <thead>
            <tr>
              <th>
                <button className="table-sort-button" type="button" onClick={() => handleSort('name')}>
                  資產
                  <span className="table-sort-indicator">{getSortIndicator('name')}</span>
                </button>
              </th>
              <th>
                <button className="table-sort-button" type="button" onClick={() => handleSort('marketValue')}>
                  市值 / 數量
                  <span className="table-sort-indicator">{getSortIndicator('marketValue')}</span>
                </button>
              </th>
              <th>
                <button className="table-sort-button" type="button" onClick={() => handleSort('currentPrice')}>
                  現價 / 成本
                  <span className="table-sort-indicator">{getSortIndicator('currentPrice')}</span>
                </button>
              </th>
              <th>
                <button className="table-sort-button" type="button" onClick={() => handleSort('unrealizedPnl')}>
                  損益
                  <span className="table-sort-indicator">{getSortIndicator('unrealizedPnl')}</span>
                </button>
              </th>
              <th>
                <button className="table-sort-button" type="button" onClick={() => handleSort('allocation')}>
                  比重
                  <span className="table-sort-indicator">{getSortIndicator('allocation')}</span>
                </button>
              </th>
              <th>
                <button className="table-sort-button" type="button" onClick={() => handleSort('assetType')}>
                  類型
                  <span className="table-sort-indicator">{getSortIndicator('assetType')}</span>
                </button>
              </th>
              <th>
                <button className="table-sort-button" type="button" onClick={() => handleSort('accountSource')}>
                  帳戶
                  <span className="table-sort-indicator">{getSortIndicator('accountSource')}</span>
                </button>
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={8}>
                  目前沒有符合條件的資產，你可以調整篩選或手動新增一筆資產。
                </td>
              </tr>
            ) : null}
            {sortedHoldings.map((holding) => {
              const isUpdating = updatingAssetIds.includes(holding.id);
              const hasPendingPrice = !hasValidHoldingPrice(holding);
              // isPriceStale: 價格偏舊（超過 DISPLAY 時窗）但系統已接受（未超過 QUOTE 時窗）
              const isPriceStale = !hasPendingPrice && isHoldingPriceStale(holding);
              const pendingReason = pendingPriceUpdateReasons[holding.id];
              const averageCost = convertCurrency(
                holding.averageCost,
                holding.currency,
                displayCurrency,
              );
              const currentPrice = convertCurrency(
                holding.currentPrice,
                holding.currency,
                displayCurrency,
              );
              const marketValue = getHoldingValueInCurrency(holding, displayCurrency);
              const costValue = getHoldingCostInCurrency(holding, displayCurrency);
              const isCashHolding = holding.assetType === 'cash';

              return (
                <tr key={holding.id}>
                  <td className="asset-cell asset-cell-sticky">
                    <div className="asset-primary">
                      <strong>{holding.name}</strong>
                      <span>{holding.symbol}</span>
                    </div>
                  </td>
                  <td>
                    <div className={hasPendingPrice ? 'table-metric table-metric-pending' : 'table-metric'}>
                      <strong className="table-metric-primary">
                        {hasPendingPrice ? '待更新' : formatCurrencyRounded(marketValue, displayCurrency)}
                      </strong>
                      <span className={hasPendingPrice ? 'table-metric-secondary table-metric-reason' : 'table-metric-secondary'}>
                        {hasPendingPrice
                          ? pendingReason || '價格過舊'
                          : isCashHolding
                            ? `${holding.currency} 現金`
                            : holding.quantity}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className={hasPendingPrice ? 'table-metric table-metric-pending' : 'table-metric'}>
                      <strong className="table-metric-primary">
                        {hasPendingPrice ? '待更新' : formatCurrency(currentPrice, displayCurrency)}
                      </strong>
                      <span className={hasPendingPrice ? 'table-metric-secondary table-metric-reason' : 'table-metric-secondary'}>
                        {hasPendingPrice
                          ? pendingReason || '價格過舊'
                          : isCashHolding
                            ? '現金金額'
                            : formatCurrency(averageCost, displayCurrency)}
                      </span>
                      {isPriceStale && (
                        <span className="table-metric-stale">價格偏舊</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {isCashHolding ? (
                      <div className="table-metric">
                        <strong className="table-metric-primary">--</strong>
                        <span className="table-metric-secondary">現金不計損益</span>
                      </div>
                    ) : (
                      renderPnlMetric(marketValue, costValue, hasPendingPrice, pendingReason)
                    )}
                  </td>
                  <td>{holding.allocation.toFixed(1)}%</td>
                  <td>
                    <span className="table-chip">{getAssetTypeLabel(holding.assetType)}</span>
                  </td>
                  <td>
                    <span className="table-chip table-chip-strong">
                      {getAccountSourceLabel(holding.accountSource)}
                    </span>
                  </td>
                  <td>
                    <div className="table-action-stack">
                      <button
                        className="button button-secondary table-action-button"
                        type="button"
                        onClick={() => onUpdatePrice?.(holding)}
                        disabled={!onUpdatePrice || isUpdating || isCashHolding}
                      >
                        {isUpdating ? '更新中...' : '更新價格'}
                      </button>
                      <button
                        className="button button-secondary table-action-button"
                        type="button"
                        onClick={() => onTrade?.(holding)}
                        disabled={!onTrade || isUpdating || isCashHolding}
                      >
                        交易
                      </button>
                      <button
                        className="button button-secondary table-action-button"
                        type="button"
                        onClick={() => onEdit?.(holding)}
                        disabled={!onEdit || isUpdating}
                      >
                        編輯
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
