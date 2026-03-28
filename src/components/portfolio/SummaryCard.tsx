interface SummaryCardProps {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'positive' | 'caution';
}

export function SummaryCard({
  label,
  value,
  hint,
  tone = 'default',
}: SummaryCardProps) {
  return (
    <article className="summary-card" data-tone={tone}>
      <p className="summary-label">{label}</p>
      <strong className="summary-value">{value}</strong>
      <p className="summary-hint">{hint}</p>
    </article>
  );
}
