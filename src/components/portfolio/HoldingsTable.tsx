import {
  getAccountSourceLabel,
  getAssetTypeLabel,
  formatCurrency,
  formatPercent,
  getHoldingValueLabel,
} from '../../data/mockPortfolio';
import type { Holding } from '../../types/portfolio';

interface HoldingsTableProps {
  holdings: Holding[];
  onUpdatePrice?: (holding: Holding) => Promise<void> | void;
  updatingAssetIds?: string[];
}

export function HoldingsTable({
  holdings,
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
              const pnlTone = holding.unrealizedPnl >= 0 ? 'positive' : 'caution';
              const isUpdating = updatingAssetIds.includes(holding.id);
              const hasPendingPrice = holding.assetType !== 'cash' && holding.currentPrice <= 0;

              return (
                <tr key={holding.id}>
                  <td className="asset-cell asset-cell-sticky">
                    <div className="asset-primary">
                      <strong>{holding.symbol}</strong>
                      <span>{holding.name}</span>
                    </div>
                  </td>
                  <td>{holding.quantity}</td>
                  <td>{formatCurrency(holding.averageCost, holding.currency)}</td>
                  <td>{hasPendingPrice ? '待更新' : formatCurrency(holding.currentPrice, holding.currency)}</td>
                  <td>{hasPendingPrice ? '待更新' : getHoldingValueLabel(holding)}</td>
                  <td>
                    {hasPendingPrice ? (
                      <span className="table-subtext">待更新</span>
                    ) : (
                      <>
                        <strong data-tone={pnlTone}>
                          {formatCurrency(holding.unrealizedPnl, holding.currency)}
                        </strong>
                        <span className="table-subtext">{formatPercent(holding.unrealizedPct)}</span>
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
