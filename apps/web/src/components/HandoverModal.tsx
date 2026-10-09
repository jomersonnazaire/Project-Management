import { Button, Modal } from 'react-bootstrap';

/** Confirms a PM handing a project to another manager (doc 11 §12). */
export function HandoverModal({
  name,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal show onHide={onCancel} centered aria-labelledby="handover-title">
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5" id="handover-title">
          Hand over this project to {name}?
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        After this, only {name} and Admins can edit or archive it. You&apos;ll still be able to view
        it.
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={pending}>
          Hand over
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
