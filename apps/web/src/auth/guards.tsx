import type { AccessAction, RecordType } from '@xc8/shared';
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

/**
 * UI-side permission gate: shows the 403 page unless the role has at least one of `any`.
 * The API enforces the same rules; this only avoids dead ends.
 */
export function RequirePermission({
  any,
  children,
}: {
  any: [RecordType, AccessAction][];
  children: ReactNode;
}) {
  const { permissions } = useAuth();
  if (!any.some(([r, a]) => permissions?.[r]?.[a])) return <ForbiddenPage />;
  return <>{children}</>;
}
