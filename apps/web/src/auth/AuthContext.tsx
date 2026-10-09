import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  effectivePermissions,
  type PermissionGrid,
  type SystemRole,
  type UserDto,
} from '@xc8/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, onForbidden, onUnauthorized } from '../api/client';

export interface Session {
  user: UserDto;
  /** The role's effective permissions from the API (doc 11). Used only to hide controls. */
  permissions: PermissionGrid;
}

interface AuthState {
  user: UserDto | null;
  permissions: PermissionGrid | null;
  loading: boolean;
  setSession: (s: { user: UserDto; permissions?: PermissionGrid } | null) => void;
  /** Re-reads the user and permissions (e.g. after a 403, so hidden controls catch up). */
  refresh: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
export const ME_KEY = ['auth', 'me'] as const;

function toSession(body: { user: UserDto; permissions?: PermissionGrid }): Session {
  // An API that predates access rules sends no permissions: fall back to the role's defaults.
  return {
    user: body.user,
    permissions: body.permissions ?? effectivePermissions(body.user.systemRole as SystemRole, null),
  };
}

async function fetchMe(): Promise<Session | null> {
  try {
    return toSession(
      await api<{ user: UserDto; permissions?: PermissionGrid }>('/auth/me', { quiet401: true }),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Permissions can change at any time (FR-ACL-06), so /auth/me is re-read whenever the user
  // navigates, refocuses the window, or gets a 403.
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const setSession = useCallback<AuthState['setSession']>(
    (s) => {
      qc.setQueryData(ME_KEY, s ? toSession(s) : null);
    },
    [qc],
  );

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ME_KEY });
  }, [qc]);

  // Session expired or revoked mid-use: drop cached data and go to sign-in (AC-01.5).
  useEffect(
    () =>
      onUnauthorized((err) => {
        const wasSignedIn = Boolean(qc.getQueryData(ME_KEY));
        qc.clear();
        qc.setQueryData(ME_KEY, null);
        if (wasSignedIn) {
          const next = window.location.pathname + window.location.search;
          const reason = err.code === 'SESSION_EXPIRED' ? 'expired' : 'signedout';
          navigate(`/login?reason=${reason}&next=${encodeURIComponent(next)}`, { replace: true });
        }
      }),
    [navigate, qc],
  );

  // A permission was removed while the page was open (EC-53): refresh what the UI shows.
  useEffect(() => onForbidden(refresh), [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', quiet401: true });
    } finally {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
      navigate('/login', { replace: true });
    }
  }, [navigate, qc]);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data?.user ?? null,
      permissions: me.data?.permissions ?? null,
      loading: me.isPending,
      setSession,
      refresh,
      signOut,
    }),
    [me.data, me.isPending, setSession, refresh, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook lives with its provider
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
