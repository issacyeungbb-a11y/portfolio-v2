import {
  convertCurrency,
  getAccountSourceLabel,
  getAssetTypeLabel,
  getHoldingValueInCurrency,
} from '../../data/mockPortfolio';
import { MoneyValue, PercentValue, QuantityValue } from '../ui/FinanceValue';
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
          <span className="chip chip-soft">{holding.allocation.toFixed(1)}%</span>
          <span className="chip chip-soft">{getAssetTypeLabel(holding.assetType)}</span>
          <span className="chip chip-strong">{getAccountSourceLabel(holding.accountSource)}</span>
        </div>
      </div>

      <div className="holding-grid">
        <div>
          <p className="muted-label">市值</p>
          <strong>
            <MoneyValue value={marketValue} currency={activeCurrency} />
          </strong>
        </div>
        <div>
          <p className="muted-label">持倉</p>
          <strong>
            <QuantityValue value={holding.quantity} /> @{' '}
            <MoneyValue value={currentPrice} currency={activeCurrency} />
          </strong>
        </div>
        <div>
          <p className="muted-label">未實現損益</p>
          <strong data-tone={pnlTone}>
            <MoneyValue value={unrealizedPnl} currency={activeCurrency} tone={pnlTone} /> (
            <PercentValue value={holding.unrealizedPct} tone={pnlTone} />
            )
          </strong>
        </div>
      </div>

      <div className="holding-footer">
        <span>
          平均成本 <MoneyValue value={averageCost} currency={activeCurrency} />
        </span>
      </div>
    </article>
  );
}
