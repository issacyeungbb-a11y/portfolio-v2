import { useMemo, useState } from 'react';

import { formatCurrencyRounded } from '../../data/mockPortfolio';
import {
  buildAssetChangeOverview,
  buildAssetMovers,
  calculateAssetChangeSummary,
  formatAssetChangePeriod,
  formatAssetChangeRangeLabel,
  formatAssetChangeValue,
  formatAssetMoverChangePct,
  findAssetChangeComparisonPoint,
} from '../../lib/portfolio/assetChange';
import type {
  AccountCashFlowEntry,
  AssetChangeRange,
  DisplayCurrency,
  PortfolioPerformancePoint,
} from '../../types/portfolio';

interface AssetChangePanelProps {
  displayCurrency: DisplayCurrency;
  history: PortfolioPerformancePoint[];
  currentPoint: PortfolioPerformancePoint;
  cashFlows: AccountCashFlowEntry[];
}

const ranges: AssetChangeRange[] = ['1d', '7d', '30d'];

export function AssetChangePanel({
  displayCurrency,
  history,
  currentPoint,
  cashFlows,
}: AssetChangePanelProps) {
  const [selectedRange, setSelectedRange] = useState<AssetChangeRange>('7d');

  const overview = useMemo(
    () => buildAssetChangeOverview(history, currentPoint, cashFlows),
    [cashFlows, currentPoint, history],
  );
  const selectedSummary = useMemo(
    () => calculateAssetChangeSummary(history, currentPoint, cashFlows, selectedRange),
    [cashFlows, currentPoint, history, selectedRange],
  );
  const comparisonPoint = useMemo(() => {
    return findAssetChangeComparisonPoint(history, currentPoint, selectedRange);
  }, [currentPoint, history, selectedRange]);
  const movers = useMemo(
    () => buildAssetMovers(currentPoint, comparisonPoint),
    [comparisonPoint, currentPoint],
  );

  return (
    <article className="card asset-change-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Portfolio Change</p>
          <h2>資產變動</h2>
        </div>
        <div className="performance-range-row" role="tablist" aria-label="資產變動期間">
          {ranges.map((range) => (
            <button
              key={range}
              className={selectedRange === range ? 'performance-range active' : 'performance-range'}
              type="button"
              onClick={() => setSelectedRange(range)}
            >
              {formatAssetChangeRangeLabel(range)}
            </button>
          ))}
        </div>
      </div>

      <div className="asset-change-layout">
        <section className="asset-change-block">
          <div className="asset-change-block-heading">
            <h3>總資產變動</h3>
            <span>每日 6:30 快照 + 即時持倉</span>
          </div>
          <div className="asset-change-overview-grid">
            {overview.length > 0 ? (
              overview.map((summary) => {
                const totalChange = formatAssetChangeValue(summary.totalChange, displayCurrency);
                return (
                  <div
                    key={summary.range}
                    className="asset-change-stat"
                    data-tone={summary.totalChange >= 0 ? 'positive' : 'caution'}
                  >
                    <span>{summary.label}</span>
                    <strong>{formatCurrencyRounded(totalChange, displayCurrency)}</strong>
                    <small>{formatAssetMoverChangePct(summary.returnPct)}</small>
                  </div>
                );
              })
            ) : (
              <p className="status-message">未有足夠快照資料。</p>
            )}
          </div>
        </section>

        <section className="asset-change-block">
          <div className="asset-change-block-heading">
            <h3>變動來源</h3>
            <span>{selectedSummary ? formatAssetChangePeriod(selectedSummary) : '等待歷史資料'}</span>
          </div>
          {selectedSummary ? (
            <div className="asset-change-source-grid">
              <div className="asset-change-stat">
                <span>期初總值</span>
                <strong>
                  {formatCurrencyRounded(
                    formatAssetChangeValue(selectedSummary.startValue, displayCurrency),
                    displayCurrency,
                  )}
                </strong>
              </div>
              <div className="asset-change-stat">
                <span>期末總值</span>
                <strong>
                  {formatCurrencyRounded(
                    formatAssetChangeValue(selectedSummary.endValue, displayCurrency),
                    displayCurrency,
                  )}
                </strong>
              </div>
              <div
                className="asset-change-stat"
                data-tone={selectedSummary.marketChange >= 0 ? 'positive' : 'caution'}
              >
                <span>市場變動</span>
                <strong>
                  {formatCurrencyRounded(
                    formatAssetChangeValue(selectedSummary.marketChange, displayCurrency),
                    displayCurrency,
                  )}
                </strong>
              </div>
              <div
                className="asset-change-stat"
                data-tone={selectedSummary.netExternalFlow >= 0 ? 'positive' : 'caution'}
              >
                <span>淨入金 / 提款</span>
                <strong>
                  {formatCurrencyRounded(
                    formatAssetChangeValue(selectedSummary.netExternalFlow, displayCurrency),
                    displayCurrency,
                  )}
                </strong>
              </div>
            </div>
          ) : (
            <p className="status-message">未有足夠快照資料。</p>
          )}
        </section>

        <section className="asset-change-block">
          <div className="asset-change-block-heading">
            <h3>各資產變動榜</h3>
            <span>{formatAssetChangeRangeLabel(selectedRange)} 比較</span>
          </div>
          {movers.gainers.length === 0 && movers.losers.length === 0 ? (
            <p className="status-message">未有足夠資產快照資料。</p>
          ) : (
            <div className="asset-movers-grid">
              <div className="asset-movers-column">
                <strong className="asset-movers-title">升幅最大</strong>
                {movers.gainers.map((mover) => (
                  <div key={mover.assetId} className="asset-mover-row">
                    <div>
                      <strong>{mover.symbol}</strong>
                      <p>{mover.name}</p>
                    </div>
                    <div className="asset-mover-value positive">
                      <strong>
                        {formatCurrencyRounded(
                          formatAssetChangeValue(mover.changeAmount, displayCurrency),
                          displayCurrency,
                        )}
                      </strong>
                      <span>{formatAssetMoverChangePct(mover.changePct)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="asset-movers-column">
                <strong className="asset-movers-title">跌幅最大</strong>
                {movers.losers.map((mover) => (
                  <div key={mover.assetId} className="asset-mover-row">
                    <div>
                      <strong>{mover.symbol}</strong>
                      <p>{mover.name}</p>
                    </div>
                    <div className="asset-mover-value caution">
                      <strong>
                        {formatCurrencyRounded(
                          formatAssetChangeValue(mover.changeAmount, displayCurrency),
                          displayCurrency,
                        )}
                      </strong>
                      <span>{formatAssetMoverChangePct(mover.changePct)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </article>
  );
}
