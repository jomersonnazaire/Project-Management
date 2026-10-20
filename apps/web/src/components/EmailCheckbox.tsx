import { ACTION_EMAIL_NOT_LINKED } from '@xc8/shared';
import { Form } from 'react-bootstrap';
import { useEmailStatus } from '../api/emailHooks';

/**
 * "Email {name}" under an action (follow-up, task assigned, added to project). Ticked by default
 * for Microsoft-linked users; disabled with a hint for everyone else. Hidden while the feature
 * flag is off or there's nobody to email. The action and its in-app notification never depend
 * on it.
 */
export function EmailCheckbox({
  id,
  names,
  checked,
  onChange,
}: {
  id: string;
  /** Who would get it, already joined for display (e.g. "Maria P. and Juan D."). */
  names: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const status = useEmailStatus().data;
  if (!status?.enabled || !names) return null;
  return (
    <div className="mb-2">
      <Form.Check
        type="checkbox"
        id={id}
        label={`Email ${names}`}
        checked={status.linked && checked}
        disabled={!status.linked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {!status.linked && <Form.Text className="d-block">{ACTION_EMAIL_NOT_LINKED}</Form.Text>}
    </div>
  );
}
