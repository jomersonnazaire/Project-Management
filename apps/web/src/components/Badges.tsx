import { USER_STATUS_LABELS, type UserStatus } from '@xc8/shared';

const STATUS_VARIANT: Record<UserStatus, string> = {
  ACTIVE: 'success',
  INVITED: 'warning',
  DEACTIVATED: 'secondary',
};

/** Status badges always carry a text label; colour is never the only signal (NFR-15). */
export function UserStatusBadge({ status }: { status: UserStatus }) {
  return (
    <span className={`badge bg-label-${STATUS_VARIANT[status]} text-uppercase`}>
      {USER_STATUS_LABELS[status]}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`badge bg-label-${active ? 'success' : 'secondary'} text-uppercase`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export function PendingBadge({ pending, overdue }: { pending: number; overdue: number }) {
  const variant = overdue > 0 ? 'danger' : pending > 0 ? 'secondary' : 'success';
  return (
    <span className={`badge rounded-pill bg-label-${variant}`}>
      {pending}
      {overdue > 0 ? ` (${overdue} overdue)` : ''}
    </span>
  );
}
