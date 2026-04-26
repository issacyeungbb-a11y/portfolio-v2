import { NavLink, Outlet, useMatches } from 'react-router-dom';

import { ErrorBoundary } from '../components/ErrorBoundary';
import { BottomNav } from '../components/layout/BottomNav';
import { TopBar } from '../components/layout/TopBar';
import { NavIcon } from '../components/layout/NavIcon';
import { TopBarProvider, useTopBarState } from './TopBarContext';

const navItems = [
  { to: '/', label: '總覽', icon: 'dashboard' as const },
  { to: '/assets', label: '資產', icon: 'assets' as const },
  { to: '/trends', label: '走勢', icon: 'trends' as const },
  { to: '/transactions', label: '交易', icon: 'transactions' as const },
  { to: '/funds', label: '資金', icon: 'funds' as const },
  { to: '/analysis', label: '分析', icon: 'analysis' as const },
];

interface RouteHandle {
  title?: string;
}

export function AppShell() {
  return (
    <TopBarProvider>
      <AppShellContent />
    </TopBarProvider>
  );
}

function AppShellContent() {
  const matches = useMatches();
  const currentHandle = matches[matches.length - 1]?.handle as RouteHandle | undefined;
  const { config: topBarConfig } = useTopBarState();
  const resolvedTopBar = topBarConfig ?? {
    title: currentHandle?.title ?? '財務管理系統',
    subtitle: '集中管理資產、交易、資金與報告。',
    metaItems: [],
    statusItems: [],
  };

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-block">
          <p className="eyebrow">專業財務管理系統</p>
          <h2>Portfolio V2</h2>
          <p>追蹤資產、現金流、分析與報告，集中管理所有財務資訊。</p>
        </div>

        <nav className="side-nav-links" aria-label="桌面導覽">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                isActive ? 'side-nav-link active' : 'side-nav-link'
              }
            >
              <span className="nav-icon" aria-hidden="true">
                <NavIcon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <TopBar {...resolvedTopBar} />
        <main className="page-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav items={navItems} />
    </div>
  );
}
