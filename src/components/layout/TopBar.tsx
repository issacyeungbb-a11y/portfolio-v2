import type { ReactNode } from 'react';

import { StatusBadge } from '../ui/StatusBadge';
import type { TopBarConfig } from '../../layout/TopBarContext';

interface TopBarProps extends TopBarConfig {
  actions?: ReactNode;
}

export function TopBar({
  title,
  subtitle,
  metaItems = [],
  statusItems = [],
  actions,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-copy">
        <p className="eyebrow">專業財務管理系統</p>
        <div className="top-bar-title-group">
          <h1>{title}</h1>
          <p className="top-bar-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="top-bar-aside">
        {metaItems.length > 0 ? (
          <dl className="top-bar-meta-list">
            {metaItems.map((item) => (
              <div key={`${item.label}-${item.value}`} className="top-bar-meta-item">
                <dt className={item.compact ? 'visually-hidden' : undefined}>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {statusItems.length > 0 ? (
          <div className="top-bar-status-list" aria-label="資料狀態">
            {statusItems.map((item) => (
              <StatusBadge
                key={item.title ?? item.label}
                label={item.label}
                tone={item.tone}
                title={item.title}
              />
            ))}
          </div>
        ) : null}

        {actions ? <div className="top-bar-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
