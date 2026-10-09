import { SYSTEM_ROLE_LABELS, hasPermission, type AccessAction, type RecordType } from '@xc8/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown } from 'react-bootstrap';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandLogo } from '../components/BrandLogo';
import { NotificationBell } from '../components/NotificationBell';
import { TopbarContext, type TopbarSlots } from '../components/topbar';
import { RunningTimerPill } from '../components/tracker/RunningTimerPill';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Not built yet in this milestone; shown disabled so the shell matches mockup v0.4. */
  soon?: boolean;
  /** Shown when the role has any of these permissions (doc 11; the API enforces them). */
  any?: [RecordType, AccessAction][];
}

const MAIN: NavItem[] = [
  { to: '/my-tasks', label: 'My tasks', icon: 'bx-check' },
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: 'bx-grid-alt',
    any: [['reports', 'view']],
  },
  { to: '/projects', label: 'Projects', icon: 'bx-briefcase', any: [['projects', 'view']] },
  { to: '/board', label: 'Task board', icon: 'bx-columns', any: [['tasks', 'view']] },
  { to: '/issues', label: 'All issues', icon: 'bx-flag', any: [['issues', 'view']] },
  { to: '/time', label: 'Time logging', icon: 'bx-time-five', any: [['time', 'view']] },
  {
    to: '/dar',
    label: 'Daily Accomplishment Report',
    icon: 'bx-envelope',
    any: [['activities', 'view']],
  },
  {
    to: '/dar/saved',
    label: 'My saved reports',
    icon: 'bx-archive',
    any: [['activities', 'view']],
  },
  { to: '/leave', label: 'Leave', icon: 'bx-sun', any: [['leave', 'view']] },
];

const SETUP: NavItem[] = [
  {
    to: '/templates',
    label: 'Templates',
    icon: 'bx-book-content',
    any: [['templates', 'view']],
  },
  { to: '/clients', label: 'Clients', icon: 'bx-buildings', any: [['clients', 'view']] },
  { to: '/workload', label: 'Team & workload', icon: 'bx-group', any: [['reports', 'view']] },
  { to: '/reports', label: 'Reports', icon: 'bx-bar-chart-alt-2', any: [['reports', 'view']] },
  {
    to: '/admin',
    label: 'Admin',
    icon: 'bx-cog',
    any: [
      ['users', 'view'],
      ['teams', 'view'],
      ['settings', 'view'],
    ],
  },
  {
    to: '/access-rules',
    label: 'Access rules',
    icon: 'bx-shield-quarter',
    any: [['accessRules', 'view']],
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function MenuItem({ item, active }: { item: NavItem; active: boolean }) {
  if (item.soon) {
    return (
      <li className="menu-item">
        <span
          className="menu-link disabled"
          aria-disabled="true"
          title="Coming in a later milestone"
        >
          <i className={`menu-icon bx ${item.icon}`} aria-hidden="true" />
          <div className="text-truncate">{item.label}</div>
          <span className="badge bg-label-secondary ms-auto menu-soon">Soon</span>
        </span>
      </li>
    );
  }
  return (
    <li className={`menu-item${active ? ' active' : ''}`}>
      <NavLink to={item.to} className="menu-link" aria-current={active ? 'page' : undefined}>
        <i className={`menu-icon bx ${item.icon}`} aria-hidden="true" />
        <div className="text-truncate">{item.label}</div>
      </NavLink>
    </li>
  );
}

/** Sneat vertical-menu layout implemented in React (no Sneat jQuery/menu.js). */
export function AppShell() {
  const { user, permissions, refresh, signOut } = useAuth();
  const location = useLocation();
  // Re-read permissions on every navigation so changes show up without signing out (FR-ACL-06).
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    refresh();
  }, [location.pathname, refresh]);
  // The off-canvas menu is open only on the page where it was opened, so navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  // DOM nodes in the top bar that pages portal their title and primary action into (DR-02).
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const slots = useMemo<TopbarSlots>(
    () => ({ title: titleSlot, actions: actionsSlot }),
    [titleSlot, actionsSlot],
  );
  const menuOpen = openedOn === location.pathname;
  const setMenuOpen = (open: boolean) => setOpenedOn(open ? location.pathname : null);

  // Sneat's CSS shows the off-canvas menu on small screens when <html> has this class.
  useEffect(() => {
    document.documentElement.classList.toggle('layout-menu-expanded', menuOpen);
    return () => document.documentElement.classList.remove('layout-menu-expanded');
  }, [menuOpen]);

  if (!user) return null;
  const visible = (items: NavItem[]) =>
    items.filter((i) => !i.any || i.any.some(([r, a]) => hasPermission(permissions, r, a)));
  const isActive = (to: string) =>
    location.pathname === to ||
    (location.pathname.startsWith(`${to}/`) &&
      // A more specific item (e.g. /dar/saved under /dar) wins.
      ![...MAIN, ...SETUP].some(
        (o) => o.to.startsWith(`${to}/`) && location.pathname.startsWith(o.to),
      ));

  return (
    <div className="layout-wrapper layout-content-navbar">
      <a
        href="#main-content"
        className="visually-hidden-focusable position-absolute top-0 start-0 m-2 btn btn-primary"
        style={{ zIndex: 2000 }}
      >
        Skip to content
      </a>
      <div className="layout-container">
        <aside
          id="layout-menu"
          className="layout-menu menu-vertical menu bg-menu-theme"
          aria-label="Main navigation"
        >
          <div className="app-brand demo">
            <NavLink to="/my-tasks" className="app-brand-link">
              <BrandLogo short />
            </NavLink>
            <button
              type="button"
              className="layout-menu-toggle menu-link text-large ms-auto d-xl-none btn btn-link p-0"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              <i className="bx bx-chevron-left" aria-hidden="true" />
            </button>
          </div>
          <div className="menu-divider mt-0" />
          <ul className="menu-inner py-1">
            {visible(MAIN).map((i) => (
              <MenuItem key={i.to} item={i} active={isActive(i.to)} />
            ))}
            <li className="menu-header small text-uppercase">
              <span className="menu-header-text">Setup</span>
            </li>
            {visible(SETUP).map((i) => (
              <MenuItem key={i.to} item={i} active={isActive(i.to)} />
            ))}
          </ul>
        </aside>

        <div className="layout-page">
          <nav
            className="layout-navbar container-xxl navbar-detached navbar navbar-expand-xl align-items-center bg-navbar-theme"
            aria-label="Top bar"
          >
            <div className="layout-menu-toggle navbar-nav align-items-xl-center me-4 me-xl-0 d-xl-none">
              <button
                type="button"
                className="nav-item nav-link px-0 btn btn-link"
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                aria-expanded={menuOpen}
                aria-controls="layout-menu"
              >
                <i className="bx bx-menu fs-4" aria-hidden="true" />
              </button>
            </div>
            <div className="navbar-nav-right d-flex align-items-center gap-3 w-100 min-w-0">
              <div ref={setTitleSlot} className="topbar-title flex-grow-1 min-w-0" />
              <div
                ref={setActionsSlot}
                className="topbar-actions d-flex align-items-center gap-2"
              />
              <ul className="navbar-nav flex-row align-items-center gap-3">
                <li className="nav-item">
                  <RunningTimerPill enabled={Boolean(permissions?.activities?.view)} />
                </li>
                <li className="nav-item">
                  <NotificationBell />
                </li>
                <li className="nav-item">
                  <Dropdown align="end">
                    <Dropdown.Toggle
                      as="button"
                      className="btn btn-link nav-link p-0 hide-arrow"
                      aria-label={`Account menu for ${user.name}`}
                    >
                      <span className="avatar avatar-sm">
                        <span className="avatar-initial rounded-circle bg-label-primary">
                          {initials(user.name)}
                        </span>
                      </span>
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.ItemText>
                        <div className="fw-semibold text-heading">{user.name}</div>
                        <small className="text-body-secondary">
                          {SYSTEM_ROLE_LABELS[user.systemRole]} · {user.email}
                        </small>
                      </Dropdown.ItemText>
                      <Dropdown.Divider />
                      <Dropdown.Item as="button" onClick={() => void signOut()}>
                        <i className="bx bx-power-off me-2" aria-hidden="true" />
                        Sign out
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </li>
              </ul>
            </div>
          </nav>

          <div className="content-wrapper">
            <main
              id="main-content"
              className="container-xxl flex-grow-1 container-p-y"
              tabIndex={-1}
            >
              <TopbarContext.Provider value={slots}>
                <Outlet />
              </TopbarContext.Provider>
            </main>
            <footer className="content-footer footer bg-footer-theme">
              <div className="container-xxl py-3 small text-body-secondary">
                Xceler8 Implementation Tracker · UI based on{' '}
                <a
                  href="https://themeselection.com/item/sneat-free-bootstrap-html-admin-template/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Sneat
                </a>{' '}
                by ThemeSelection (MIT)
              </div>
            </footer>
          </div>
        </div>
      </div>
      {/* Click-away overlay for the off-canvas menu on small screens */}
      <div
        className="layout-overlay layout-menu-toggle"
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
    </div>
  );
}
