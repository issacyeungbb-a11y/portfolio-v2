import type { ReactNode } from 'react';

import { StatusBadge } from '../ui/StatusBadge';
import type { TopBarConfig } from '../../layout/TopBarContext';

interface TopBarProps extends TopBarConfig {
  actions?: ReactNode;
}

export function TopBar({
  title,
  subtitle,
  primaryStatus,
  metaItems = [],
  statusItems = [],
  showMeta = false,
  compact = false,
  actions,
}: TopBarProps) {
  const resolvedStatus = primaryStatus ?? statusItems[0] ?? null;

  return (
    <header className={compact ? 'top-bar top-bar-compact' : 'top-bar'}>
      <div className="top-bar-copy">
        <div className="top-bar-title-group">
          <h1>{title}</h1>
          <p className="top-bar-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="top-bar-aside">
        {showMeta && metaItems.length > 0 ? (
          <dl className="top-bar-meta-list">
            {metaItems.map((item) => (
              <div key={`${item.label}-${item.value}`} className="top-bar-meta-item">
                <dt className={item.compact ? 'visually-hidden' : undefined}>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {resolvedStatus ? (
          <div className="top-bar-status-list" aria-label="資料狀態">
            <StatusBadge
              label={resolvedStatus.label}
              tone={resolvedStatus.tone}
              title={resolvedStatus.title}
            />
          </div>
        ) : null}

        {actions ? <div className="top-bar-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
