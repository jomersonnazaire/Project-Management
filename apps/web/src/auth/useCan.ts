import { can, type Permission } from '@xc8/shared';
import { useAuth } from './AuthContext';

export function useCan(permission: Permission): boolean {
  const { user } = useAuth();
  return can(user?.systemRole, permission);
}
