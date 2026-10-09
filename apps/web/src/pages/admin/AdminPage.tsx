import type { AccessAction, RecordType } from '@xc8/shared';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { ForbiddenPage, NotFoundPage } from '../ErrorPages';
import { SettingsPanel } from './SettingsPanel';
import { TeamsPanel } from './TeamsPanel';
import { UsersPanel } from './UsersPanel';

const TABS: { path: string; label: string; need: [RecordType, AccessAction] }[] = [
  { path: 'users', label: 'Users', need: ['users', 'view'] },
  { path: 'teams', label: 'Teams', need: ['teams', 'view'] },
  { path: 'settings', label: 'Settings', need: ['settings', 'view'] },
];

const PANELS = { users: <UsersPanel />, teams: <TeamsPanel />, settings: <SettingsPanel /> };

/** Admin area. Tabs follow the access rules (default: Admin only); the API enforces the same. */
export function AdminPage() {
  const { permissions } = useAuth();
  const tabs = TABS.filter(({ need: [r, a] }) => permissions?.[r]?.[a]);
  return (
    <>
      <PageHeader title="Admin" />
      {/* Scrolls sideways instead of clipping "Settings" on phones (DR-05). */}
      <ul className="nav nav-tabs nav-scrollable mb-6">
        {tabs.map((t) => (
          <li className="nav-item" key={t.path}>
            <NavLink
              to={`/admin/${t.path}`}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <Routes>
        <Route
          index
          element={tabs[0] ? <Navigate to={tabs[0].path} replace /> : <ForbiddenPage />}
        />
        {TABS.map((t) => (
          <Route
            key={t.path}
            path={t.path}
            element={tabs.includes(t) ? PANELS[t.path as keyof typeof PANELS] : <ForbiddenPage />}
          />
        ))}
        {/* Clients moved to their own page with Details / Contacts / Projects tabs (FR-CLI-09). */}
        <Route path="clients" element={<Navigate to="/clients" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
