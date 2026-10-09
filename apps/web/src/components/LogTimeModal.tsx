import { Modal } from 'react-bootstrap';
import { TimeEntryForm, type TimePreset } from './TimeEntryForm';

/** "Log time" from a My tasks row or a task panel (FR-TIME-01). */
export function LogTimeModal({
  preset,
  today,
  onClose,
}: {
  preset?: TimePreset;
  today?: string;
  onClose: () => void;
}) {
  return (
    <Modal show onHide={onClose} centered aria-labelledby="logtime-title">
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5" id="logtime-title">
          Log time
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <TimeEntryForm
          preset={preset}
          today={today}
          onSaved={onClose}
          onCancel={onClose}
          idPrefix="logtime"
        />
      </Modal.Body>
    </Modal>
  );
}
