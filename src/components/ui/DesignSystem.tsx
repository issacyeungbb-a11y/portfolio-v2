import type { HTMLAttributes, ReactNode } from 'react';

type PanelTone = 'default' | 'neutral' | 'positive' | 'caution' | 'danger';

function joinClassNames(...values: Array<string | undefined | false | null>) {
  return values.filter(Boolean).join(' ');
}

export interface PageSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tone?: PanelTone;
  bodyClassName?: string;
}

export function PageSection({
  eyebrow,
  title,
  subtitle,
  actions,
  tone = 'default',
  bodyClassName,
  className,
  children,
  ...props
}: PageSectionProps) {
  return (
    <section className={joinClassNames('page-section', className)} data-tone={tone} {...props}>
      <div className="section-heading page-section-heading">
        <div className="page-section-copy">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {subtitle ? <p className="table-hint">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-section-actions">{actions}</div> : null}
      </div>
      <div className={joinClassNames('page-section-body', bodyClassName)}>{children}</div>
    </section>
  );
}

export interface DataCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: PanelTone;
}

export function DataCard({
  eyebrow,
  title,
  description,
  actions,
  tone = 'default',
  className,
  children,
  ...props
}: DataCardProps) {
  return (
    <article className={joinClassNames('data-card', 'card', className)} data-tone={tone} {...props}>
      {title || eyebrow || actions || description ? (
        <div className="section-heading data-card-heading">
          <div className="data-card-copy">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2>{title}</h2> : null}
            {description ? <p className="table-hint">{description}</p> : null}
          </div>
          {actions ? <div className="data-card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}

export interface MetricCardProps extends Omit<DataCardProps, 'title' | 'description'> {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}

export function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
  className,
  children,
  ...props
}: MetricCardProps) {
  return (
    <article className={joinClassNames('metric-card', 'summary-card', className)} data-tone={tone} {...props}>
      <p className="summary-label">{label}</p>
      <strong className="summary-value">{value}</strong>
      {hint ? <p className="summary-hint">{hint}</p> : null}
      {children}
    </article>
  );
}

export interface ActionPanelProps extends DataCardProps {}

export function ActionPanel({
  eyebrow,
  title,
  description,
  actions,
  tone = 'default',
  className,
  children,
  ...props
}: ActionPanelProps) {
  return (
    <article className={joinClassNames('action-panel', 'data-card', 'card', className)} data-tone={tone} {...props}>
      <div className="section-heading action-panel-heading">
        <div className="data-card-copy">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          {title ? <h2>{title}</h2> : null}
          {description ? <p className="table-hint">{description}</p> : null}
        </div>
        {actions ? <div className="data-card-actions">{actions}</div> : null}
      </div>
      {children}
    </article>
  );
}

export interface WarningPanelProps extends DataCardProps {}

export function WarningPanel({
  eyebrow = '注意',
  title,
  description,
  actions,
  tone = 'caution',
  className,
  children,
  ...props
}: WarningPanelProps) {
  return (
    <article className={joinClassNames('warning-panel', 'data-card', 'card', className)} data-tone={tone} {...props}>
      <div className="section-heading warning-panel-heading">
        <div className="data-card-copy">
          <p className="eyebrow">{eyebrow}</p>
          {title ? <h2>{title}</h2> : null}
          {description ? <p className="table-hint">{description}</p> : null}
        </div>
        {actions ? <div className="data-card-actions">{actions}</div> : null}
      </div>
      {children}
    </article>
  );
}

export interface EmptyStateCardProps extends HTMLAttributes<HTMLElement> {
  title: string;
  reason: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  tone?: PanelTone;
}

export function EmptyStateCard({
  title,
  reason,
  primaryAction,
  secondaryAction,
  className = '',
  tone = 'neutral',
  ...props
}: EmptyStateCardProps) {
  const emptyStateClassName = joinClassNames('empty-state', 'empty-state-card', className);

  return (
    <article className={emptyStateClassName} data-tone={tone} {...props}>
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
