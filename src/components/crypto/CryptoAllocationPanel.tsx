import { memo } from 'react';

import type { CryptoMonthlySnapshot } from '../../types/cryptoHistory';

interface CryptoAllocationPanelProps {
  snapshot: CryptoMonthlySnapshot;
}

const allocationConfig = [
  { key: 'BTC', label: 'BTC', className: 'allocation-btc', color: 'var(--crypto-btc)' },
  { key: 'ETH', label: 'ETH', className: 'allocation-eth', color: 'var(--crypto-eth)' },
  { key: 'ADA', label: 'ADA', className: 'allocation-ada', color: 'var(--crypto-ada)' },
  { key: 'USDT', label: 'USDT', className: 'allocation-usdt', color: 'var(--crypto-usdt)' },
  { key: 'OTHER', label: '其他', className: 'allocation-other', color: 'var(--crypto-other)' },
] as const;

function percent(value: number) {
  return new Intl.NumberFormat('zh-HK', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

export const CryptoAllocationPanel = memo(function CryptoAllocationPanel({
  snapshot,
}: CryptoAllocationPanelProps) {
  const allocations = allocationConfig.flatMap((item) => {
    const value = snapshot.allocations[item.key];

    return typeof value === 'number' ? [{ ...item, value }] : [];
  });
  const complete = allocations.length === allocationConfig.length;
  let covered = 0;
  const gradientStops = allocations.flatMap((item) => {
    const start = covered;
    covered = Math.min(1, covered + Math.max(0, item.value));

    return covered > start
      ? [`${item.color} ${start * 100}% ${covered * 100}%`]
      : [];
  });

  if (covered < 1) {
    gradientStops.push(`var(--surface-muted) ${covered * 100}% 100%`);
  }

  const pieGradient = `conic-gradient(${gradientStops.join(', ') || 'var(--surface-muted) 0% 100%'})`;
  const accessibleSummary = allocations
    .map((item) => `${item.label} ${percent(item.value)}`)
    .join('、');

  return (
    <div className="crypto-allocation-panel">
      <div
        className="crypto-allocation-pie"
        role="img"
        aria-label={`${snapshot.month} 資產分佈：${accessibleSummary || '沒有可用比例'}`}
        title={accessibleSummary}
        style={{ background: pieGradient }}
      />
      <div className="crypto-allocation-legend">
        {allocationConfig.map((item) => {
          const value = snapshot.allocations[item.key];
          return (
            <span key={item.key}>
              <i className={item.className} aria-hidden="true" />
              {item.label}
              <strong>{typeof value === 'number' ? percent(value) : '—'}</strong>
            </span>
          );
        })}
      </div>
      {!complete ? (
        <p className="compact-warning-note">
          部分資料：原始月結沒有完整五項分佈，空白項目不作推算。
        </p>
      ) : null}
    </div>
  );
});
