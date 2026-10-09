import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { NotFoundPage } from '../ErrorPages';
import { ClientsPanel } from './ClientsPanel';
import { SettingsPanel } from './SettingsPanel';
import { TeamsPanel } from './TeamsPanel';
import { UsersPanel } from './UsersPanel';

const TABS = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/teams', label: 'Teams' },
  { to: '/admin/clients', label: 'Clients' },
  { to: '/admin/settings', label: 'Settings' },
];

/** Admin area (Admin only; the API enforces the same rule). */
export function AdminPage() {
  return (
    <>
      <PageHeader title="Admin" />
      <ul className="nav nav-tabs mb-6">
        {TABS.map((t) => (
          <li className="nav-item" key={t.to}>
            <NavLink to={t.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <Routes>
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<UsersPanel />} />
        <Route path="teams" element={<TeamsPanel />} />
        <Route path="clients" element={<ClientsPanel />} />
        <Route path="settings" element={<SettingsPanel />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
