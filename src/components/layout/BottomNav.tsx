import { NavLink } from 'react-router-dom';

import { NavIcon } from './NavIcon';

interface NavItem {
  to: string;
  label: string;
  icon: 'dashboard' | 'assets' | 'trends' | 'transactions' | 'funds' | 'analysis';
}

interface BottomNavProps {
  items: NavItem[];
}

export function BottomNav({ items }: BottomNavProps) {
  return (
    <nav
      className="bottom-nav"
      aria-label="主要導覽"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            isActive ? 'bottom-nav-link active' : 'bottom-nav-link'
          }
        >
          <span className="nav-icon" aria-hidden="true">
            <NavIcon name={item.icon} />
          </span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
