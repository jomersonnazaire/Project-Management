import { Button, Modal } from 'react-bootstrap';

/** Confirms a PM handing a project to another manager (doc 11 §12). */
export function HandoverModal({
  name,
  pending,
  staysOnTeam,
  creating = false,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending?: boolean;
  /** CR-22: whether I stay on the project team ("Stay on the project team", edit or create). */
  staysOnTeam: boolean;
  /** Creating a project for another manager (vs handing over an existing one). */
  creating?: boolean;
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
        After this, only {name} and Admins can edit or archive it.{' '}
        {staysOnTeam
          ? "You'll stay on the project team, so you can still view it and plan its tasks."
          : creating
            ? "You won't have access to this project after you create it."
            : "You'll be taken off the project team and lose access to it."}
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
