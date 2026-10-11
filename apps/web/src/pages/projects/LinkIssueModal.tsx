import { ISSUE_SEVERITY_LABELS, type MessageDto } from '@xc8/shared';
import { useState } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { saveErrorMessage } from '../../api/client';
import { useLinkMessageToIssue, useProjectIssues } from '../../api/issueHooks';
import { LoadingRows } from '../../components/Feedback';

/** Conversation › "Link to issue": attach this message to one of the project's open issues. */
export function LinkIssueModal({
  projectId,
  message,
  onClose,
}: {
  projectId: string;
  message: MessageDto;
  onClose: () => void;
}) {
  const issues = useProjectIssues(projectId);
  const link = useLinkMessageToIssue();
  const [issueId, setIssueId] = useState('');
  const items = issues.data?.items ?? [];
  const excerpt = (message.text ?? '').slice(0, 140);
  return (
    <Modal show onHide={onClose} centered aria-labelledby="link-issue-title">
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          if (issueId) link.mutate({ issueId, messageId: message.id });
        }}
      >
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5" id="link-issue-title">
            Link to issue
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-body-secondary">
            “{excerpt}
            {(message.text ?? '').length > 140 ? '…' : ''}”
          </p>
          {link.isSuccess ? (
            <div className="alert alert-success mb-0" role="status">
              Linked to{' '}
              <Link to={`/issues/${link.data.id}`} onClick={onClose}>
                {link.data.key}
              </Link>
              .
            </div>
          ) : issues.isPending ? (
            <LoadingRows rows={2} />
          ) : items.length === 0 ? (
            <p className="mb-0">This project has no open issues.</p>
          ) : (
            <Form.Group controlId="link-issue">
              <Form.Label>Open issue</Form.Label>
              <Form.Select value={issueId} onChange={(e) => setIssueId(e.target.value)}>
                <option value="">Choose an issue…</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.key} · {i.title} ({ISSUE_SEVERITY_LABELS[i.severity]})
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}
          {link.error ? (
            <div className="alert alert-danger mt-3 mb-0 py-2 small" role="alert">
              {saveErrorMessage(link.error)}
            </div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            {link.isSuccess ? 'Close' : 'Cancel'}
          </Button>
          {!link.isSuccess && (
            <Button type="submit" disabled={!issueId || link.isPending}>
              Link
            </Button>
          )}
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
