import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Train', end: true },
  { to: '/routines', label: 'Routines', end: false },
  { to: '/history', label: 'History', end: false },
  { to: '/plans', label: 'Plans', end: false },
];

export default function Layout() {
  return (
    <>
      <Outlet />
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto flex max-w-lg">
          {TABS.map((tab) => (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `flex min-h-14 items-center justify-center text-xs font-medium transition-colors ${
                    isActive ? 'text-accent' : 'text-muted'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
