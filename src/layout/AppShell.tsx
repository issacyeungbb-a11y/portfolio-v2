import { NavLink, Outlet, useLocation, useMatches } from 'react-router-dom';

import { ErrorBoundary } from '../components/ErrorBoundary';
import { BottomNav } from '../components/layout/BottomNav';
import { TopBar } from '../components/layout/TopBar';
import { NavIcon } from '../components/layout/NavIcon';
import { TopBarProvider, useTopBarState } from './TopBarContext';

const navItems = [
  { to: '/', label: '總覽', icon: 'dashboard' as const },
  { to: '/assets', label: '資產', icon: 'assets' as const },
  { to: '/trends', label: '走勢', icon: 'trends' as const },
  { to: '/crypto-history', label: 'Crypto', sideLabel: '持倉管理中心', icon: 'crypto' as const },
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
  const location = useLocation();
  const matches = useMatches();
  const currentHandle = matches[matches.length - 1]?.handle as RouteHandle | undefined;
  const { config: topBarConfig } = useTopBarState();
  const resolvedTopBar = topBarConfig ?? {
    title: currentHandle?.title ?? '財務管理系統',
    metaItems: [],
    statusItems: [],
  };

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-block">
          <h2>Portfolio V2</h2>
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
              <span>{item.sideLabel ?? item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <TopBar {...resolvedTopBar} />
        <main className="page-content">
          {/* key 令換頁時自動重置錯誤狀態 */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav items={navItems} />
    </div>
  );
}
