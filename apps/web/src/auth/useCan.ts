import { hasPermission, type AccessAction, type RecordType } from '@xc8/shared';
import { useAuth } from './AuthContext';

/**
 * True when the signed-in user's role may do `action` on `record` (doc 11). The API enforces the
 * same rules on every request; this only hides or disables controls (FR-ACL-08).
 */
export function useCan(record: RecordType, action: AccessAction): boolean {
  const { permissions } = useAuth();
  return hasPermission(permissions, record, action);
}
