export type StatusBadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

interface StatusBadgeProps {
  label: string;
  tone?: StatusBadgeTone;
  title?: string;
  className?: string;
}

export function StatusBadge({
  label,
  tone = 'neutral',
  title,
  className = '',
}: StatusBadgeProps) {
  const badgeClassName = ['status-badge', `status-badge-${tone}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={badgeClassName} title={title}>
      {label}
    </span>
  );
}
