import type { SystemRole } from '@xc8/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '../components/Feedback';
import { ForbiddenPage } from '../pages/ErrorPages';
import { useAuth } from './AuthContext';

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) {
    const next = location.pathname + location.search;
    return (
      <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    );
  }
  return <Outlet />;
}

/** UI-side role gate. The API enforces the same rules; this only avoids dead ends. */
export function RequireRole({ roles, children }: { roles: SystemRole[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.systemRole)) return <ForbiddenPage />;
  return <>{children}</>;
}
