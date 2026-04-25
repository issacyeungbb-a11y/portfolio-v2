import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  reason: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  reason,
  primaryAction,
  secondaryAction,
  className = '',
}: EmptyStateProps) {
  const emptyStateClassName = ['empty-state', className].filter(Boolean).join(' ');

  return (
    <article className={emptyStateClassName}>
      <div className="empty-state-copy">
        <p className="eyebrow">資料狀態</p>
        <h3>{title}</h3>
        <p>{reason}</p>
      </div>
      <div className="empty-state-actions">
        {primaryAction}
        {secondaryAction}
      </div>
    </article>
  );
}
