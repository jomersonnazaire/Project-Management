import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@xc8/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, onUnauthorized } from '../api/client';

interface AuthState {
  user: UserDto | null;
  loading: boolean;
  setUser: (u: UserDto | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
export const ME_KEY = ['auth', 'me'] as const;

async function fetchMe(): Promise<UserDto | null> {
  try {
    return (await api<{ user: UserDto }>('/auth/me', { quiet401: true })).user;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 60_000, retry: false });

  const setUser = useCallback(
    (u: UserDto | null) => {
      qc.setQueryData(ME_KEY, u);
    },
    [qc],
  );

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
    () => ({ user: me.data ?? null, loading: me.isPending, setUser, signOut }),
    [me.data, me.isPending, setUser, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook lives with its provider
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
