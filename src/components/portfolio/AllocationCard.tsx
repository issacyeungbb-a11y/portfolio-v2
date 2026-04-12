import {
  formatCurrency,
  getHoldingValueInCurrency,
} from '../../data/mockPortfolio';
import type {
  AllocationBucketKey,
  AllocationSlice,
  DisplayCurrency,
} from '../../types/portfolio';

interface AllocationCardProps {
  title: string;
  slices: AllocationSlice[];
  selectedKey: AllocationBucketKey;
  displayCurrency: DisplayCurrency;
  onSelect: (key: AllocationBucketKey) => void;
}

function buildDonutGradient(slices: AllocationSlice[]) {
  let currentPercent = 0;

  const segments = slices.map((slice) => {
    const start = currentPercent;
    currentPercent += slice.value;
    return `${slice.color} ${start}% ${currentPercent}%`;
  });

  return `conic-gradient(${segments.join(', ')})`;
}

export function AllocationCard({
  title,
  slices,
  selectedKey,
  displayCurrency,
  onSelect,
}: AllocationCardProps) {
  const selectedSlice = slices.find((slice) => slice.key === selectedKey) ?? slices[0];

  if (!selectedSlice) {
    return null;
  }

  return (
    <article className="card allocation-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">分布</p>
          <h2>{title}</h2>
        </div>
      </div>

      <div className="allocation-visual-layout">
        <div className="allocation-donut-wrap">
          <div
            className="allocation-donut"
            style={{ backgroundImage: buildDonutGradient(slices) }}
            aria-hidden="true"
          >
            <div className="allocation-donut-center">
              <strong>{selectedSlice.label}</strong>
              <small>{selectedSlice.value.toFixed(1)}%</small>
            </div>
          </div>
        </div>

        <div className="allocation-list">
          {slices.map((slice) => (
            <button
              key={slice.key}
              className={slice.key === selectedSlice.key ? 'allocation-row active' : 'allocation-row'}
              type="button"
              onClick={() => onSelect(slice.key)}
            >
              <div className="allocation-label-group">
                <span
                  className="allocation-dot"
                  style={{ backgroundColor: slice.color }}
                  aria-hidden="true"
                />
                <span>{slice.label}</span>
              </div>
              <div className="allocation-value-group">
                <strong>
                  {formatCurrency(
                    displayCurrency === 'HKD' ? slice.totalValueHKD : slice.totalValueUSD,
                    displayCurrency,
                  )}
                </strong>
                <span>{slice.value.toFixed(1)}%</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="allocation-detail-panel">
        <div className="allocation-detail-header">
          <div>
            <p className="eyebrow">明細</p>
            <h3>{selectedSlice.label}</h3>
          </div>
          <div className="allocation-detail-total">
            <strong>
              {formatCurrency(
                displayCurrency === 'HKD' ? selectedSlice.totalValueHKD : selectedSlice.totalValueUSD,
                displayCurrency,
              )}
            </strong>
            <span>{selectedSlice.holdings.length} 項資產</span>
          </div>
        </div>

        <div className="allocation-breakdown-list">
          {selectedSlice.holdings.map((holding) => (
            <div key={holding.id} className="allocation-holding-row">
              <div>
                <strong>{holding.symbol}</strong>
                <span>{holding.name}</span>
              </div>
              <div className="allocation-holding-values">
                <strong>
                  {formatCurrency(
                    getHoldingValueInCurrency(holding, displayCurrency),
                    displayCurrency,
                  )}
                </strong>
                <span>{holding.allocation.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
