import { NavLink, Outlet, useMatches } from 'react-router-dom';

import { BottomNav } from '../components/layout/BottomNav';
import { TopBar } from '../components/layout/TopBar';

const navItems = [
  { to: '/', label: '總覽', icon: 'O1' },
  { to: '/assets', label: '資產', icon: 'A2' },
  { to: '/trends', label: '走勢', icon: 'T6' },
  { to: '/transactions', label: '交易', icon: 'TR' },
  { to: '/import', label: '匯入', icon: 'I3' },
  { to: '/funds', label: '資金', icon: 'F4' },
  { to: '/analysis', label: '分析', icon: 'AI' },
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
          <Outlet />
        </main>
      </div>

      <BottomNav items={navItems} />
    </div>
  );
}
