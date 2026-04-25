import type { ReactNode } from 'react';

import { MetricCard } from '../ui/DesignSystem';

interface SummaryCardProps {
  label: string;
  value: ReactNode;
  hint: ReactNode;
  tone?: 'default' | 'positive' | 'caution';
}

export function SummaryCard({
  label,
  value,
  hint,
  tone = 'default',
}: SummaryCardProps) {
  return <MetricCard label={label} value={value} hint={hint} tone={tone} />;
}
