import {
  convertCurrency,
  formatCurrency,
  formatCurrencyRounded,
  formatPercent,
  getAssetTypeLabel,
  getHoldingValueInCurrency,
} from '../../data/mockPortfolio';
import type { DisplayCurrency, Holding } from '../../types/portfolio';

interface HoldingCardProps {
  holding: Holding;
  displayCurrency?: DisplayCurrency;
}

export function HoldingCard({ holding, displayCurrency }: HoldingCardProps) {
  const pnlTone = holding.unrealizedPnl >= 0 ? 'positive' : 'caution';
  const activeCurrency = displayCurrency ?? holding.currency;
  const marketValue = getHoldingValueInCurrency(holding, activeCurrency);
  const averageCost = convertCurrency(holding.averageCost, holding.currency, activeCurrency);
  const currentPrice = convertCurrency(holding.currentPrice, holding.currency, activeCurrency);
  const unrealizedPnl = convertCurrency(holding.unrealizedPnl, holding.currency, activeCurrency);

  return (
    <article className="holding-card">
      <div className="holding-header">
        <div>
          <p className="holding-symbol">{holding.symbol}</p>
          <h3>{holding.name}</h3>
        </div>
        <div className="button-row">
          <span className="chip chip-soft">{getAssetTypeLabel(holding.assetType)}</span>
          <span className="chip chip-strong">{getAccountSourceLabel(holding.accountSource)}</span>
        </div>
      </div>

      <div className="holding-grid">
        <div>
          <p className="muted-label">市值</p>
          <strong>{formatCurrencyRounded(marketValue, activeCurrency)}</strong>
        </div>
        <div>
          <p className="muted-label">持倉</p>
          <strong>
            {holding.quantity} @ {formatCurrency(currentPrice, activeCurrency)}
          </strong>
        </div>
        <div>
          <p className="muted-label">未實現損益</p>
          <strong data-tone={pnlTone}>
            {formatCurrencyRounded(unrealizedPnl, activeCurrency)} ({formatPercent(holding.unrealizedPct)})
          </strong>
        </div>
        <div>
          <p className="muted-label">配置比重</p>
          <strong>{holding.allocation.toFixed(1)}%</strong>
        </div>
      </div>

      <div className="holding-footer">
        <span>平均成本 {formatCurrency(averageCost, activeCurrency)}</span>
      </div>
    </article>
  );
}
