import { plural, type InviteResultDto } from '@xc8/shared';
import { Button, Modal } from 'react-bootstrap';
import { CopyLinkField } from './CopyLinkField';
import { hoursUntil } from './linkExpiry';

/**
 * Shows a freshly generated single-use link ("Copy reset link" / "New invite link").
 * Email delivery is deferred (FR-AUTH-05), so the Admin shares the link themselves.
 */
export function InviteLinkModal({
  result,
  autoCopied = false,
  onClose,
}: {
  result: InviteResultDto | null;
  autoCopied?: boolean;
  onClose: () => void;
}) {
  if (!result) return null;
  const reset = result.purpose === 'RESET';
  const hours = hoursUntil(result.inviteExpiresAt);
  const expires = new Date(result.inviteExpiresAt).toLocaleString();
  return (
    <Modal show onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title as="h5">{reset ? 'Reset link' : 'New invite link'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          Share this link with <strong>{result.user.name}</strong> ({result.user.email}) yourself.
          They will {reset ? 'choose a new password' : 'set their own password'}.
        </p>
        {autoCopied && (
          <p className="text-success small" role="status">
            <i className="bx bx-check me-1" aria-hidden="true" />
            Link copied to clipboard.
          </p>
        )}
        <CopyLinkField
          id="invite-link"
          label={`${reset ? 'Reset' : 'Invite'} link (single use, expires in ${plural(hours, 'hour')})`}
          url={result.inviteUrl}
        />
        <p className="form-text mt-2 mb-0">
          Expires {expires}. Creating a new link cancels any earlier unused one.
          {result.replacedPrevious && ' The previous unused link no longer works.'}
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={onClose}>Done</Button>
      </Modal.Footer>
    </Modal>
  );
}
