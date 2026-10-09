import type { InviteResultDto } from '@xc8/shared';
import { useState } from 'react';
import { Button, Form, InputGroup, Modal } from 'react-bootstrap';

/**
 * Shows the one-time setup link after an invite or reset. Email delivery isn't configured
 * in Phase 1 (Q-02), so the Admin shares the link with the person directly.
 */
export function InviteLinkModal({
  result,
  onClose,
}: {
  result: InviteResultDto | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  const expires = new Date(result.inviteExpiresAt).toLocaleString();
  const reset = result.user.status === 'ACTIVE';
  const copy = async () => {
    await navigator.clipboard.writeText(result.inviteUrl);
    setCopied(true);
  };
  return (
    <Modal show onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title as="h5">{reset ? 'Password reset link' : 'Invite created'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          Send this one-time link to <strong>{result.user.name}</strong> ({result.user.email}). They
          will {reset ? 'choose a new password' : 'set their own password on first sign-in'}.
        </p>
        <Form.Label htmlFor="invite-link">Setup link</Form.Label>
        <InputGroup>
          <Form.Control
            id="invite-link"
            readOnly
            value={result.inviteUrl}
            onFocus={(e) => e.target.select()}
          />
          <Button variant="outline-primary" onClick={() => void copy()}>
            <i className="bx bx-copy me-1" aria-hidden="true" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </InputGroup>
        <p className="form-text mt-2 mb-0">Expires {expires}. It can be used once.</p>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={onClose}>Done</Button>
      </Modal.Footer>
    </Modal>
  );
}
