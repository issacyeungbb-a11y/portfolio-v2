import { NavLink, Outlet, useMatches } from 'react-router-dom';

import { BottomNav } from '../components/layout/BottomNav';
import { TopBar } from '../components/layout/TopBar';

const navItems = [
  { to: '/', label: '總覽', icon: 'O1' },
  { to: '/assets', label: '資產', icon: 'A2' },
  { to: '/import', label: '匯入', icon: 'I3' },
  { to: '/analysis', label: '分析', icon: 'AI' },
  { to: '/settings', label: '設定', icon: 'S5' },
];

interface RouteHandle {
  title?: string;
  subtitle?: string;
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
          <p>先用假資料打好資訊架構，再慢慢接上 Firebase、Gemini 與真實流程。</p>
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

        <section className="side-note card">
          <p className="eyebrow">Roadmap</p>
          <h3>下一輪可接的功能</h3>
          <p>匿名登入、Firestore 資料、截圖上傳、Gemini 分析與每日價格同步。</p>
        </section>
      </aside>

      <div className="shell-main">
        <TopBar
          title={currentHandle?.title ?? 'Portfolio V2'}
          subtitle={currentHandle?.subtitle ?? '投資組合追蹤介面雛形'}
        />
        <main className="page-content">
          <Outlet />
        </main>
      </div>

      <BottomNav items={navItems} />
    </div>
  );
}
