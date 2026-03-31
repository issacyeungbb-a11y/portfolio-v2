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
  updatingAssetIds?: string[];
}

export function HoldingsTable({
  holdings,
  displayCurrency,
  onUpdatePrice,
  updatingAssetIds = [],
}: HoldingsTableProps) {
  return (
    <div className="holdings-table-shell">
      <div className="table-scroll">
        <table className="holdings-table">
          <thead>
            <tr>
              <th>資產</th>
              <th>持倉</th>
              <th>平均成本</th>
              <th>現價</th>
              <th>市值</th>
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
                <td className="table-empty" colSpan={10}>
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
                      <strong>{holding.symbol}</strong>
                      <span>{holding.name}</span>
                    </div>
                  </td>
                  <td>{holding.quantity}</td>
                  <td>{formatCurrency(averageCost, displayCurrency)}</td>
                  <td>{hasPendingPrice ? '待更新' : formatCurrency(currentPrice, displayCurrency)}</td>
                  <td>{hasPendingPrice ? '待更新' : formatCurrency(marketValue, displayCurrency)}</td>
                  <td>
                    {hasPendingPrice ? (
                      <span className="table-subtext">待更新</span>
                    ) : (
                      <>
                        <strong data-tone={pnlTone}>
                          {formatCurrency(unrealizedPnl, displayCurrency)}
                        </strong>
                        <span className="table-subtext">{formatPercent(unrealizedPct)}</span>
                      </>
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
                    <button
                      className="button button-secondary table-action-button"
                      type="button"
                      onClick={() => onUpdatePrice?.(holding)}
                      disabled={!onUpdatePrice || isUpdating}
                    >
                      {isUpdating ? '更新中...' : '更新單一資產'}
                    </button>
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
