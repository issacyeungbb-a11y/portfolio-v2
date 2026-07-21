import { useMemo, useState } from 'react';

import { formatCurrencyRounded } from '../../lib/currency';
import {
  buildAccountAllocationSlices,
  buildAllocationSlices,
  getAccountSourceLabel,
  getAssetTypeLabel,
  getHoldingValueInCurrency,
  getPortfolioTotalValue,
} from '../../lib/holdings';
import type {
  AccountAllocationSlice,
  AllocationHolding,
  AllocationSlice,
  DisplayCurrency,
  Holding,
} from '../../types/portfolio';

interface PortfolioAllocationChartProps {
  holdings: Holding[];
  displayCurrency: DisplayCurrency;
}

type AllocationMode = 'assetType' | 'account';
type PortfolioAllocationSlice = AllocationSlice | AccountAllocationSlice;

const CHART_SIZE = 240;
const CHART_RADIUS = 90;
const CHART_CIRCUMFERENCE = 2 * Math.PI * CHART_RADIUS;

function formatAllocationPercent(value: number) {
  const fractionDigits = Math.abs(value) < 10 ? 1 : 0;
  return `${value.toFixed(fractionDigits)}%`;
}

function getSliceValue(slice: PortfolioAllocationSlice, displayCurrency: DisplayCurrency) {
  return getPortfolioTotalValue(slice.holdings, displayCurrency);
}

function getHoldingContext(holding: AllocationHolding, mode: AllocationMode) {
  if (mode === 'account') {
    return `${getAssetTypeLabel(holding.assetType)} · ${holding.currency}`;
  }

  if (holding.accountSources.length > 1) {
    return `來自 ${holding.accountSources.map(getAccountSourceLabel).join('、')}（${holding.accountSources.length} 個帳戶）`;
  }

  return getAccountSourceLabel(holding.accountSources[0] ?? holding.accountSource);
}

export function PortfolioAllocationChart({
  holdings,
  displayCurrency,
}: PortfolioAllocationChartProps) {
  const [mode, setMode] = useState<AllocationMode>('assetType');
  const [selectedKeys, setSelectedKeys] = useState<Partial<Record<AllocationMode, string>>>({});

  const slices = useMemo<PortfolioAllocationSlice[]>(
    () =>
      mode === 'assetType'
        ? buildAllocationSlices(holdings)
        : buildAccountAllocationSlices(holdings),
    [holdings, mode],
  );
  const totalValue = useMemo(
    () => getPortfolioTotalValue(holdings, displayCurrency),
    [displayCurrency, holdings],
  );
  const requestedKey = selectedKeys[mode];
  const selectedSlice =
    slices.find((slice) => String(slice.key) === requestedKey) ?? slices[0];
  const selectedValue = selectedSlice
    ? getSliceValue(selectedSlice, displayCurrency)
    : 0;
  const largestSlice = slices[0];

  let cumulativePercentage = 0;
  const chartSegments = slices.map((slice) => {
    const segmentLength = (slice.value / 100) * CHART_CIRCUMFERENCE;
    const gap = slices.length > 1 ? Math.min(4, segmentLength * 0.22) : 0;
    const segment = {
      ...slice,
      dashArray: `${Math.max(segmentLength - gap, 0.8)} ${CHART_CIRCUMFERENCE}`,
      dashOffset: -((cumulativePercentage / 100) * CHART_CIRCUMFERENCE),
    };

    cumulativePercentage += slice.value;
    return segment;
  });

  function selectSlice(slice: PortfolioAllocationSlice) {
    setSelectedKeys((current) => ({
      ...current,
      [mode]: String(slice.key),
    }));
  }

  return (
    <article className="card portfolio-allocation-card" aria-labelledby="portfolio-allocation-title">
      <div className="portfolio-allocation-heading">
        <div>
          <p className="eyebrow">Portfolio allocation</p>
          <h2 id="portfolio-allocation-title">資產配置全景</h2>
          <p className="table-hint">
            以即時市值顯示完整組合；選擇分類後可逐項查看資產、帳戶來源及整體佔比。
          </p>
        </div>
        <div className="allocation-mode-toggle" role="tablist" aria-label="資產配置分類方式">
          <button
            className={mode === 'assetType' ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={mode === 'assetType'}
            onClick={() => setMode('assetType')}
          >
            按資產種類
          </button>
          <button
            className={mode === 'account' ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={mode === 'account'}
            onClick={() => setMode('account')}
          >
            按帳戶
          </button>
        </div>
      </div>

      {selectedSlice ? (
        <>
          <div className="portfolio-allocation-overview">
            <div className="portfolio-allocation-donut-column">
              <div
                className="portfolio-allocation-donut"
                role="img"
                aria-label={`${mode === 'assetType' ? '按資產種類' : '按帳戶'}配置：${slices
                  .map((slice) => `${slice.label} ${formatAllocationPercent(slice.value)}`)
                  .join('，')}`}
              >
                <svg viewBox={`0 0 ${CHART_SIZE} ${CHART_SIZE}`} aria-hidden="true">
                  <circle
                    className="portfolio-allocation-track"
                    cx={CHART_SIZE / 2}
                    cy={CHART_SIZE / 2}
                    r={CHART_RADIUS}
                  />
                  {chartSegments.map((segment) => {
                    const isSelected = segment.key === selectedSlice.key;
                    return (
                      <circle
                        key={segment.key}
                        className={
                          isSelected
                            ? 'portfolio-allocation-segment selected'
                            : 'portfolio-allocation-segment'
                        }
                        cx={CHART_SIZE / 2}
                        cy={CHART_SIZE / 2}
                        r={CHART_RADIUS}
                        stroke={segment.color}
                        strokeDasharray={segment.dashArray}
                        strokeDashoffset={segment.dashOffset}
                      />
                    );
                  })}
                </svg>
                <div className="portfolio-allocation-center" aria-live="polite">
                  <span>{mode === 'assetType' ? '所選類別' : '所選帳戶'}</span>
                  <strong>{selectedSlice.label}</strong>
                  <b>{formatAllocationPercent(selectedSlice.value)}</b>
                  <small>{formatCurrencyRounded(selectedValue, displayCurrency)}</small>
                </div>
              </div>

              <div className="portfolio-allocation-stats" aria-label="資產配置摘要">
                <span>
                  組合總值
                  <strong>{formatCurrencyRounded(totalValue, displayCurrency)}</strong>
                </span>
                <span>
                  最大配置
                  <strong>
                    {largestSlice.label} · {formatAllocationPercent(largestSlice.value)}
                  </strong>
                </span>
              </div>
            </div>

            <div className="portfolio-allocation-legend">
              {slices.map((slice) => {
                const isSelected = slice.key === selectedSlice.key;
                return (
                  <button
                    key={slice.key}
                    className={isSelected ? 'portfolio-allocation-legend-row active' : 'portfolio-allocation-legend-row'}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => selectSlice(slice)}
                  >
                    <span
                      className="portfolio-allocation-swatch"
                      style={{ backgroundColor: slice.color }}
                      aria-hidden="true"
                    />
                    <span className="portfolio-allocation-legend-copy">
                      <strong>{slice.label}</strong>
                      <small>{slice.holdings.length} 項資產</small>
                    </span>
                    <span className="portfolio-allocation-legend-value">
                      <strong>{formatCurrencyRounded(getSliceValue(slice, displayCurrency), displayCurrency)}</strong>
                      <small>{formatAllocationPercent(slice.value)}</small>
                    </span>
                    <span className="portfolio-allocation-bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(slice.value, 1.5)}%`, backgroundColor: slice.color }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <section className="portfolio-allocation-detail" aria-labelledby="portfolio-allocation-detail-title">
            <div className="portfolio-allocation-detail-heading">
              <div>
                <p className="eyebrow">逐項明細</p>
                <h3 id="portfolio-allocation-detail-title">{selectedSlice.label}</h3>
                <p className="table-hint">
                  {selectedSlice.holdings.length} 項資產 · 分類市值 {formatCurrencyRounded(selectedValue, displayCurrency)}
                </p>
              </div>
              <span className="chip chip-soft">
                佔整體 {formatAllocationPercent(selectedSlice.value)}
              </span>
            </div>

            <div className="portfolio-allocation-holdings">
              {selectedSlice.holdings.map((holding) => {
                const holdingValue = getHoldingValueInCurrency(holding, displayCurrency);
                const portfolioShare = totalValue === 0 ? 0 : (holdingValue / totalValue) * 100;
                const selectedShare = selectedValue === 0 ? 0 : (holdingValue / selectedValue) * 100;

                return (
                  <div key={holding.id} className="portfolio-allocation-holding-row">
                    <span className="portfolio-allocation-holding-symbol">{holding.symbol}</span>
                    <span className="portfolio-allocation-holding-copy">
                      <strong>{holding.name}</strong>
                      <small>{getHoldingContext(holding, mode)}</small>
                    </span>
                    <span className="portfolio-allocation-holding-value">
                      <strong>{formatCurrencyRounded(holdingValue, displayCurrency)}</strong>
                      <small>整體 {formatAllocationPercent(portfolioShare)}</small>
                    </span>
                    <span className="portfolio-allocation-holding-bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(selectedShare, 1.5)}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <p className="status-message">加入資產後，這裡會自動建立資產種類及帳戶分佈圖。</p>
      )}
    </article>
  );
}
