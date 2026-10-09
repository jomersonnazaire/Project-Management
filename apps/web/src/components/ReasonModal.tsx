import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { ErrorAlert } from './Feedback';

/** Asks for a short reason (blocker, cancel, reopen, override, rejection, re-baseline). */
export function ReasonModal({
  title,
  label,
  confirmLabel,
  optional = false,
  intro,
  error,
  pending,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  confirmLabel: string;
  optional?: boolean;
  intro?: ReactNode;
  error?: unknown;
  pending?: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!optional && !reason.trim()) return setMissing(true);
    onSubmit(reason.trim());
  };
  return (
    <Modal show onHide={onClose} centered>
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5">
            {title}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={error} action />
          {intro && <p>{intro}</p>}
          <Form.Group controlId="reason-text">
            <Form.Label>{label}</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={reason}
              autoFocus
              isInvalid={missing}
              onChange={(e) => {
                setReason(e.target.value);
                setMissing(false);
              }}
            />
            <Form.Control.Feedback type="invalid">{label} is required.</Form.Control.Feedback>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {confirmLabel}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
