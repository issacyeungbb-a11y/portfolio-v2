import { NavLink, Outlet, useMatches } from 'react-router-dom';

import { ErrorBoundary } from '../components/ErrorBoundary';
import { BottomNav } from '../components/layout/BottomNav';
import { TopBar } from '../components/layout/TopBar';

const navItems = [
  { to: '/', label: '總覽', icon: '📊' },
  { to: '/assets', label: '資產', icon: '💰' },
  { to: '/trends', label: '走勢', icon: '📈' },
  { to: '/transactions', label: '交易', icon: '🔄' },
  { to: '/funds', label: '資金', icon: '🏦' },
  { to: '/analysis', label: '分析', icon: '🤖' },
];

interface RouteHandle {
  title?: string;
}

export function AppShell() {
  const matches = useMatches();
  const currentHandle = matches[matches.length - 1]?.handle as RouteHandle | undefined;

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-block">
          <p className="eyebrow">Personal Tracker</p>
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
                {item.icon}
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

      </aside>

      <div className="shell-main">
        <TopBar title={currentHandle?.title ?? 'Portfolio V2'} />
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
