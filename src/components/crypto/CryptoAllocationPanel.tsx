import { memo } from 'react';

import type { CryptoMonthlySnapshot } from '../../types/cryptoHistory';

interface CryptoAllocationPanelProps {
  snapshot: CryptoMonthlySnapshot;
}

const allocationConfig = [
  { key: 'BTC', label: 'BTC', className: 'allocation-btc' },
  { key: 'ETH', label: 'ETH', className: 'allocation-eth' },
  { key: 'ADA', label: 'ADA', className: 'allocation-ada' },
  { key: 'USDT', label: 'USDT', className: 'allocation-usdt' },
  { key: 'OTHER', label: '其他', className: 'allocation-other' },
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

  return (
    <div className="crypto-allocation-panel">
      <div className="crypto-allocation-track" aria-label={`${snapshot.month} 資產分佈`}>
        {allocations.map((item) => (
          <span
            key={item.key}
            className={item.className}
            style={{ width: `${item.value * 100}%` }}
            title={`${item.label} ${percent(item.value)}`}
          />
        ))}
      </div>
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
