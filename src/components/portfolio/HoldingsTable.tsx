import {
  convertCurrency,
  getAccountSourceLabel,
  getAssetTypeLabel,
  formatCurrency,
  formatPercent,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
} from '../../data/mockPortfolio';
import { hasValidHoldingPrice } from '../../lib/portfolio/priceValidity';
import type { DisplayCurrency, Holding } from '../../types/portfolio';

interface HoldingsTableProps {
  holdings: Holding[];
  displayCurrency: DisplayCurrency;
  onUpdatePrice?: (holding: Holding) => Promise<void> | void;
  onEdit?: (holding: Holding) => void;
  updatingAssetIds?: string[];
}

export function HoldingsTable({
  holdings,
  displayCurrency,
  onUpdatePrice,
  onEdit,
  updatingAssetIds = [],
}: HoldingsTableProps) {
  return (
    <div className="holdings-table-shell">
      <div className="table-scroll">
        <table className="holdings-table">
          <thead>
            <tr>
              <th>資產</th>
              <th>市值 / 數量</th>
              <th>現價 / 成本</th>
              <th>損益</th>
              <th>比重</th>
              <th>類型</th>
              <th>帳戶</th>
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
            {holdings.map((holding) => {
              const isUpdating = updatingAssetIds.includes(holding.id);
              const hasPendingPrice = !hasValidHoldingPrice(holding);
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
              const unrealizedPnl = marketValue - costValue;
              const unrealizedPct = costValue === 0 ? 0 : (unrealizedPnl / costValue) * 100;
              const pnlTone = unrealizedPnl >= 0 ? 'positive' : 'caution';

              return (
                <tr key={holding.id}>
                  <td className="asset-cell asset-cell-sticky">
                    <div className="asset-primary">
                      <strong>{holding.name}</strong>
                      <span>{holding.symbol}</span>
                    </div>
                  </td>
                  <td>
                    <div className="table-metric">
                      <strong className="table-metric-primary">
                        {hasPendingPrice ? '待更新' : formatCurrency(marketValue, displayCurrency)}
                      </strong>
                      <span className="table-metric-secondary">{holding.quantity}</span>
                    </div>
                  </td>
                  <td>
                    <div className="table-metric">
                      <strong className="table-metric-primary">
                        {hasPendingPrice ? '待更新' : formatCurrency(currentPrice, displayCurrency)}
                      </strong>
                      <span className="table-metric-secondary">
                        {formatCurrency(averageCost, displayCurrency)}
                      </span>
                    </div>
                  </td>
                  <td>
                    {hasPendingPrice ? (
                      <div className="table-metric">
                        <strong className="table-metric-primary">待更新</strong>
                        <span className="table-metric-secondary">--</span>
                      </div>
                    ) : (
                      <div className="table-metric">
                        <strong className="table-metric-primary" data-tone={pnlTone}>
                          {formatCurrency(unrealizedPnl, displayCurrency)}
                        </strong>
                        <span className="table-metric-secondary">{formatPercent(unrealizedPct)}</span>
                      </div>
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
                        disabled={!onUpdatePrice || isUpdating}
                      >
                        {isUpdating ? '更新中...' : '更新單一資產'}
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
