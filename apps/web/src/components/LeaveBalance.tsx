import { daysLabel } from '../lib/format';

/**
 * A leave balance as shown everywhere (My leave, Team on leave, Admin › Leave › Entitlements;
 * DR-38): a real minus sign, AA danger red when negative, and the red "Negative" badge.
 */
export function LeaveBalance({
  value,
  negative = value !== null && value < 0,
  noLimit = 'No limit',
}: {
  value: number | null;
  negative?: boolean;
  /** Text for an unpaid type with no balance (null). */
  noLimit?: string;
}) {
  if (value === null) return <span>{noLimit}</span>;
  return (
    <>
      <span className={negative ? 'text-negative fw-semibold' : undefined}>{daysLabel(value)}</span>
      {negative && <span className="badge badge-negative ms-1">Negative</span>}
    </>
  );
}
