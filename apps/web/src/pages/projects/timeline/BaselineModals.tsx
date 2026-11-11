import {
  BASELINE_HISTORY_FOOTER,
  baselineSavedToast,
  saveBaselineIntro,
  saveBaselineReplaces,
  saveBaselineUnscheduled,
  type TimelineBaselineDto,
  type TimelineDto,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form, Modal, Table } from 'react-bootstrap';
import { useSaveBaseline } from '../../../api/timelineHooks';
import { ErrorAlert } from '../../../components/Feedback';
import { savedOn } from './format';

const savedAtLong = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });

/** UIE §2.7 "Save baseline?" (FR-TL-08, Q-133): copies every task's planned dates. */
export function SaveBaselineModal({
  timeline,
  unscheduled,
  onClose,
  onSaved,
}: {
  timeline: TimelineDto;
  unscheduled: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const save = useSaveBaseline(timeline.project.id);
  const [reason, setReason] = useState('');
  const current = timeline.baselines[0];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { reason: reason.trim() || null },
      {
        onSuccess: (r) => {
          onSaved(baselineSavedToast(r.baseline.taskCount));
          onClose();
        },
      },
    );
  };
  return (
    <Modal show onHide={onClose} centered aria-labelledby="tlx-baseline-title">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title id="tlx-baseline-title" as="h5">
            Save baseline?
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {save.error && <ErrorAlert error={save.error} />}
          <p className="mb-2">{saveBaselineIntro(timeline.tasks.length)}</p>
          {current && (
            <p className="mb-2">
              {saveBaselineReplaces(
                savedOn(current.savedAt),
                current.savedBy?.name ?? 'Unknown user',
              )}
            </p>
          )}
          {unscheduled > 0 && <p className="mb-2">{saveBaselineUnscheduled(unscheduled)}</p>}
          <Form.Group controlId="tlx-baseline-reason">
            <Form.Label>Reason (optional)</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Save baseline
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/** UIE §2.7 Baseline history: newest first, "Current" on the newest. */
export function BaselineHistoryModal({
  baselines,
  onClose,
}: {
  baselines: TimelineBaselineDto[];
  onClose: () => void;
}) {
  return (
    <Modal show onHide={onClose} centered size="lg" aria-labelledby="tlx-history-title">
      <Modal.Header closeButton>
        <Modal.Title id="tlx-history-title" as="h5">
          Baseline history
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Table size="sm" responsive className="mb-2" data-testid="baseline-history">
          <thead>
            <tr>
              <th scope="col">Saved</th>
              <th scope="col">By</th>
              <th scope="col">Tasks</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {baselines.map((b, i) => (
              <tr key={b.id}>
                <td className="text-nowrap">
                  {savedAtLong(b.savedAt)}
                  {i === 0 && <span className="badge bg-label-primary ms-2">Current</span>}
                </td>
                <td>{b.savedBy?.name ?? 'Unknown user'}</td>
                <td>{b.taskCount}</td>
                <td>{b.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="small text-body-secondary mb-0">{BASELINE_HISTORY_FOOTER}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
