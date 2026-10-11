import { useAuth } from '../auth/AuthContext';

export const LOCKED_TOOLTIP = 'Locked. Ask an Admin to reopen this day.';

/**
 * FR-ACT-24 (UIE): on a locked row non-Admins get a lock instead of Edit / Delete. The tooltip is
 * the native title (hover) and the accessible name (screen readers, keyboard focus).
 */
export function LockedIcon() {
  const { user } = useAuth();
  const text =
    user?.systemRole === 'ADMIN' ? 'Locked. Reopen this day to change it.' : LOCKED_TOOLTIP;
  return (
    <span
      role="img"
      tabIndex={0}
      className="text-body-secondary locked-icon"
      title={text}
      aria-label={text}
      data-testid="locked-icon"
    >
      <i className="bx bx-lock-alt" aria-hidden="true" />
    </span>
  );
}
