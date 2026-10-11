import {
  EVIDENCE_ACCEPT,
  ISSUE_ARCHIVED_NOTE,
  ISSUE_AUTO_CLOSE_DAYS,
  ISSUE_CATEGORIES,
  ISSUE_CATEGORY_LABELS,
  ISSUE_COMPLETED_BANNER,
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STAGES,
  ISSUE_STAGE_LABELS,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  MAX_FILES_PER_UPLOAD,
  checkFileRules,
  formatBytes,
  issueDueLabel,
  issueTransition,
  shortName,
  transitionLabel,
  type IssueActivityDto,
  type IssueDto,
  type IssueStatus,
  type UpdateIssueInput,
} from '@xc8/shared';
import { useRef, useState } from 'react';
import { Alert, Button, Form, ProgressBar } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, saveErrorMessage } from '../../api/client';
import {
  issueTickets,
  useInvalidateIssues,
  useIssue,
  useIssueActivity,
  useIssueMutation,
  useIssueOptions,
} from '../../api/issueHooks';
import { completeUpload, openDownload, putFile } from '../../api/m3Hooks';
import { ErrorAlert, LoadingRows, LockNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { ReasonModal } from '../../components/ReasonModal';
import { dateTime, initials, shortDate } from '../../lib/format';
import { NotFoundPage } from '../ErrorPages';
import { FileChip } from '../projects/EvidenceSection';
import { useConfirm } from '../../components/ConfirmModal';

/** Issue detail (FR-ISS-04..11, mockup v7-issue). */
export function IssueDetailPage() {
  const { id = '' } = useParams();
  const issue = useIssue(id);
  if (issue.error instanceof ApiError && issue.error.status === 404) return <NotFoundPage />;
  const i = issue.data;
  if (!i) {
    return (
      <>
        <PageHeader title="Issue" />
        <ErrorAlert error={issue.error} />
        <LoadingRows rows={5} />
      </>
    );
  }
  return <IssueView issue={i} />;
}

type Pending = { to: IssueStatus; kind: 'resolution' | 'reason' } | null;

function IssueView({ issue: i }: { issue: IssueDto }) {
  const [confirm, confirmDialog] = useConfirm();
  const mutate = useIssueMutation(i.id);
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending>(null);
  const [editing, setEditing] = useState(false);
  const [dueAsk, setDueAsk] = useState<string | null>(null);

  const move = (to: IssueStatus) => {
    const rule = issueTransition(i.status, to);
    if (rule.resolution) return setPending({ to, kind: 'resolution' });
    if (rule.reason) return setPending({ to, kind: 'reason' });
    mutate.mutate({ kind: 'status', body: { version: i.version, status: to } });
  };
  const update = (body: Omit<UpdateIssueInput, 'version'>) =>
    mutate.mutate({ kind: 'update', body: { version: i.version, ...body } });

  // Primary action in the top bar: the forward step; the rest sit with the status pills.
  const transitions = i.can.transitions;
  const primary = transitions.find((t) => t === 'RESOLVED' || t === 'CLOSED') ?? transitions[0];

  return (
    <>
      {confirmDialog}
      <>
        <PageHeader title={`${i.key} ${i.title}`}>
          {i.can.edit && (
            <Button variant="outline-secondary" onClick={() => setEditing((x) => !x)}>
              {editing ? 'Done' : 'Edit'}
            </Button>
          )}
          {primary && (
            <Button onClick={() => move(primary)} disabled={mutate.isPending}>
              {transitionLabel(i.status, primary)}
            </Button>
          )}
        </PageHeader>
        <Link to={`/projects/${i.project.id}/issues`} className="d-inline-block mb-3 small">
          {i.project.name} › Issues
        </Link>
        {i.projectArchived ? (
          <LockNotice>{ISSUE_ARCHIVED_NOTE}</LockNotice>
        ) : (
          i.projectStatus === 'COMPLETED' && <Alert variant="info">{ISSUE_COMPLETED_BANNER}</Alert>
        )}
        <ErrorAlert error={mutate.error} action />

        <div className="d-flex flex-wrap gap-2 mb-4" aria-label="Status">
          {ISSUE_STATUSES.map((s) => (
            <span
              key={s}
              className={`badge ${s === i.status ? 'bg-label-info fw-bold' : 'bg-label-secondary'}`}
              aria-current={s === i.status ? 'step' : undefined}
            >
              {ISSUE_STATUS_LABELS[s]}
            </span>
          ))}
          {transitions.some((t) => t !== primary) && (
            // DR-19: other status moves are actions, set apart from the five steps.
            <span
              className="d-inline-flex flex-wrap gap-2 ms-2 ps-3 border-start"
              role="group"
              aria-label="Other status changes"
            >
              {transitions
                .filter((t) => t !== primary)
                .map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant="outline-secondary"
                    className="py-0"
                    onClick={() => move(t)}
                    disabled={mutate.isPending}
                  >
                    {transitionLabel(i.status, t)}
                  </Button>
                ))}
            </span>
          )}
        </div>

        <div className="row g-4">
          <div className="col-lg-8">
            <div className="card mb-4">
              <div className="card-body">
                {editing ? (
                  <EditText issue={i} onSave={update} pending={mutate.isPending} />
                ) : (
                  <>
                    <h2 className="h6">Description</h2>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{i.description}</p>
                  </>
                )}
                <Attachments issue={i} />
                <Links issue={i} />
              </div>
            </div>
            <Comments issue={i} />
          </div>
          <div className="col-lg-4">
            <SidePanel
              issue={i}
              onUpdate={update}
              onMove={move}
              onDue={(d) => setDueAsk(d)}
              disabled={mutate.isPending}
            />
            {(i.status === 'CLOSED' || i.status === 'RESOLVED') && <ClosedState issue={i} />}
            {i.can.delete && (
              <Button
                variant="outline-danger"
                size="sm"
                className="mt-3"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete ${i.key}?`,
                      body: 'Closing it as a duplicate is usually better. This cannot be undone.',
                      confirmLabel: 'Delete issue',
                      danger: true,
                    })
                  ) {
                    mutate.mutate(
                      { kind: 'delete' },
                      { onSuccess: () => navigate(`/projects/${i.project.id}/issues`) },
                    );
                  }
                }}
              >
                Delete issue
              </Button>
            )}
          </div>
        </div>

        {pending && (
          <ReasonModal
            title={
              pending.kind === 'resolution'
                ? 'Mark resolved'
                : transitionLabel(i.status, pending.to)
            }
            label={pending.kind === 'resolution' ? 'Resolution' : 'Reason'}
            confirmLabel={transitionLabel(i.status, pending.to)}
            intro={
              pending.kind === 'resolution'
                ? `Say what fixed it. The reporter or PM confirms; it closes automatically after ${ISSUE_AUTO_CLOSE_DAYS} days otherwise.`
                : undefined
            }
            error={mutate.error}
            pending={mutate.isPending}
            onClose={() => setPending(null)}
            onSubmit={(text) =>
              mutate.mutate(
                {
                  kind: 'status',
                  body: {
                    version: i.version,
                    status: pending.to,
                    ...(pending.kind === 'resolution' ? { resolution: text } : { reason: text }),
                  },
                },
                { onSuccess: () => setPending(null) },
              )
            }
          />
        )}
        {dueAsk !== null && (
          <ReasonModal
            title="Change due date"
            label="Why is the due date changing?"
            confirmLabel="Change due date"
            intro={`New due date: ${dueAsk ? shortDate(dueAsk, true) : 'back to the severity default'}.`}
            optional={!dueAsk}
            error={mutate.error}
            pending={mutate.isPending}
            onClose={() => setDueAsk(null)}
            onSubmit={(reason) =>
              mutate.mutate(
                {
                  kind: 'update',
                  body: {
                    version: i.version,
                    dueDate: dueAsk || null,
                    ...(reason ? { dueReason: reason } : {}),
                  },
                },
                { onSuccess: () => setDueAsk(null) },
              )
            }
          />
        )}
      </>
    </>
  );
}

function EditText({
  issue: i,
  onSave,
  pending,
}: {
  issue: IssueDto;
  onSave: (b: { title: string; description: string }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState(i.title);
  const [description, setDescription] = useState(i.description);
  return (
    <Form
      className="mb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && description.trim()) {
          onSave({ title: title.trim(), description: description.trim() });
        }
      }}
    >
      <Form.Group className="mb-3" controlId="edit-issue-title">
        <Form.Label>Title</Form.Label>
        <Form.Control value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
      </Form.Group>
      <Form.Group className="mb-3" controlId="edit-issue-description">
        <Form.Label>Description</Form.Label>
        <Form.Control
          as="textarea"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Form.Group>
      <Button type="submit" size="sm" disabled={pending || !title.trim() || !description.trim()}>
        Save
      </Button>
    </Form>
  );
}

function Attachments({ issue: i }: { issue: IssueDto }) {
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<{ name: string; pct: number }[]>([]);
  const refresh = useInvalidateIssues();
  const errorText = (e: unknown, name: string) =>
    e instanceof ApiError ? e.message : `${name} couldn't be uploaded. Try again.`;

  async function upload(list: File[]) {
    const problems: string[] = [];
    if (list.length > MAX_FILES_PER_UPLOAD) {
      problems.push(`Up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
      list = list.slice(0, MAX_FILES_PER_UPLOAD);
    }
    const ok = list.filter((f) => {
      const issue = checkFileRules({ name: f.name, size: f.size }, 'ISSUE');
      if (issue) problems.push(issue.message);
      return !issue;
    });
    setErrors(problems);
    if (!ok.length) return;
    try {
      const { uploads } = await issueTickets(i.id, ok);
      await Promise.all(
        uploads.map(async (t, n) => {
          const file = ok[n]!;
          setBusy((b) => [...b, { name: file.name, pct: 0 }]);
          try {
            await putFile(t, file, (pct) =>
              setBusy((b) => b.map((x) => (x.name === file.name ? { ...x, pct } : x))),
            );
            await completeUpload(t.id);
          } catch (e) {
            setErrors((x) => [...x, errorText(e, file.name)]);
          } finally {
            setBusy((b) => b.filter((x) => x.name !== file.name));
          }
        }),
      );
    } catch (e) {
      setErrors((x) => [...x, errorText(e, ok.map((f) => f.name).join(', '))]);
    }
    refresh();
  }

  return (
    <>
      <h2 className="h6">Attachments</h2>
      <ul className="list-unstyled small mb-2">
        {i.attachments.map((a) => (
          <li
            key={a.documentId}
            className="d-flex align-items-center gap-2 mb-2 border rounded p-2"
          >
            <FileChip name={a.name} />
            <div className="flex-grow-1 min-w-0">
              <strong className="text-heading text-break">{a.name}</strong>
              <div className="text-body-secondary">
                {formatBytes(a.size)} · {a.uploadedBy ? shortName(a.uploadedBy.name) : 'Unknown'} ·{' '}
                {shortDate(a.at)}
              </div>
            </div>
            <Button
              variant="link"
              size="sm"
              className="p-0"
              onClick={() =>
                openDownload(`/issues/${i.id}/attachments/${a.documentId}/download`).catch((e) =>
                  setErrors([errorText(e, a.name)]),
                )
              }
            >
              Download
            </Button>
          </li>
        ))}
        {busy.map((b) => (
          <li key={b.name} className="mb-2">
            <strong>{b.name}</strong>
            <ProgressBar now={b.pct} style={{ height: 6 }} aria-label={`Uploading ${b.name}`} />
          </li>
        ))}
      </ul>
      {i.attachments.length === 0 && busy.length === 0 && !i.can.attach && (
        <p className="small text-body-secondary">No attachments.</p>
      )}
      {i.can.attach && (
        <div
          className="drop-zone mb-3"
          role="button"
          tabIndex={0}
          aria-label="Attach files"
          onClick={() => input.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          <i className="bx bx-upload me-1" aria-hidden="true" />
          Attach PDF, Word or Excel · up to 25 MB
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={EVIDENCE_ACCEPT}
            data-testid="issue-attach-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void upload(files);
            }}
          />
        </div>
      )}
      {errors.map((m) => (
        <div key={m} className="small text-danger mb-1" role="alert">
          ⚠ {m}
        </div>
      ))}
    </>
  );
}

function Links({ issue: i }: { issue: IssueDto }) {
  const options = useIssueOptions(i.can.edit ? i.project.id : null);
  const mutate = useIssueMutation(i.id);
  const [adding, setAdding] = useState(false);
  const linked = new Set(i.links.tasks.map((t) => t.id));
  const has = i.links.tasks.length > 0 || i.links.messages.length > 0;
  return (
    <>
      <h2 className="h6 mt-3">Links</h2>
      <div className="d-flex flex-wrap gap-2 align-items-center small">
        {i.links.tasks.map((t) =>
          t.name ? (
            <Link
              key={t.id}
              to={`/projects/${i.project.id}?task=${t.id}`}
              className="badge bg-label-secondary text-wrap"
            >
              ☑ {t.name}
            </Link>
          ) : (
            <span key={t.id} className="badge bg-label-secondary">
              ☑ Task removed
            </span>
          ),
        )}
        {i.links.messages.map((m) => (
          <Link
            key={m.id}
            to={`/projects/${i.project.id}/conversation`}
            className="badge bg-label-secondary text-wrap"
          >
            💬 {m.excerpt ?? 'Message removed'}
            {m.at ? ` · ${dateTime(m.at)}` : ''}
          </Link>
        ))}
        {!has && !i.can.edit && <span className="text-body-secondary">No links.</span>}
        {i.can.edit && !adding && (
          <Button variant="link" size="sm" className="p-0" onClick={() => setAdding(true)}>
            + Link task
          </Button>
        )}
        {adding && (
          <Form.Select
            size="sm"
            aria-label="Link a task"
            style={{ maxWidth: 280 }}
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              mutate.mutate(
                {
                  kind: 'update',
                  body: { version: i.version, taskIds: [...linked, e.target.value] },
                },
                { onSettled: () => setAdding(false) },
              );
            }}
          >
            <option value="">Choose a task…</option>
            {(options.data?.tasks ?? [])
              .filter((t) => !linked.has(t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Form.Select>
        )}
      </div>
      {mutate.error instanceof ApiError && (
        <div className="small text-danger mt-1" role="alert">
          ⚠ {mutate.error.message}
        </div>
      )}
    </>
  );
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  severity: 'Severity',
  category: 'Category',
  stage: 'Stage',
  ownerId: 'Owner',
  dueDate: 'Due date',
  title: 'Title',
  description: 'Description',
  reportedByContactId: 'Reported by',
  taskIds: 'Linked tasks',
  messageIds: 'Linked messages',
  resolution: 'Resolution',
};
/** DR-20: never show raw field or event keys; "issue_comment_added" → "Issue comment added". */
function humanize(key: string): string {
  const words = key
    .replace(/Id(s)?$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function valueLabel(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (field === 'status') return ISSUE_STATUS_LABELS[v as IssueStatus] ?? String(v);
  if (field === 'severity') return ISSUE_SEVERITY_LABELS[v as never] ?? String(v);
  if (field === 'stage') return ISSUE_STAGE_LABELS[v as never] ?? String(v);
  if (field === 'category') return ISSUE_CATEGORY_LABELS[v as never] ?? String(v);
  if (field === 'dueDate') return shortDate(String(v));
  if (Array.isArray(v)) return `${v.length}`;
  return String(v);
}
const EVENT_TEXT: Record<string, string> = {
  issue_created: 'Raised the issue',
  issue_updated: 'Updated',
  issue_status_changed: 'Changed the status',
  issue_reopened: 'Reopened',
  issue_auto_closed: `Closed automatically after ${ISSUE_AUTO_CLOSE_DAYS} days resolved`,
  issue_attachment_added: 'Attachment added',
};

function ActivityItem({ a }: { a: IssueActivityDto }) {
  const who = a.actor?.name ?? 'System';
  const attachment = a.changes.find((c) => c.field === 'attachments')?.new as string | undefined;
  const visible = a.changes.filter(
    (c) => c.field !== 'description' && c.field !== 'title' && c.field !== 'attachments',
  );
  return (
    <li className="d-flex gap-3 py-3 border-bottom">
      <span className="avatar avatar-sm flex-none" aria-hidden="true">
        <span className="avatar-initial rounded-circle bg-label-primary">
          {a.actor ? initials(a.actor.name) : '⚙'}
        </span>
      </span>
      <div className="small flex-grow-1">
        <strong className="text-heading">{shortName(who)}</strong>{' '}
        <span className="text-body-secondary">{dateTime(a.at)}</span>
        {a.kind === 'EVENT' && (
          <div className="text-body-secondary">
            {a.action === 'issue_attachment_added' ? (
              // DR-20: "Attachment added: ok.pdf", not "attachments: – → ok.pdf".
              <>
                {EVENT_TEXT.issue_attachment_added}
                {attachment ? `: ${attachment}` : ''}
              </>
            ) : (
              (EVENT_TEXT[a.action ?? ''] ?? humanize(a.action ?? ''))
            )}
            {visible.map((c) => (
              <span key={c.field} className="d-block">
                {FIELD_LABELS[c.field] ?? humanize(c.field)}: {valueLabel(c.field, c.old)} →{' '}
                <strong>{valueLabel(c.field, c.new)}</strong>
              </span>
            ))}
            {a.reason && <span className="d-block">Reason: {a.reason}</span>}
          </div>
        )}
        {a.text && (
          <p className="mb-0 mt-1" style={{ whiteSpace: 'pre-wrap' }}>
            {a.text}
          </p>
        )}
      </div>
    </li>
  );
}

function Comments({ issue: i }: { issue: IssueDto }) {
  const activity = useIssueActivity(i.id);
  const mutate = useIssueMutation(i.id);
  const [text, setText] = useState('');
  return (
    <div className="card">
      <div className="card-body">
        <h2 className="h6">Comments &amp; history</h2>
        <ErrorAlert error={activity.error} />
        {activity.isPending ? (
          <LoadingRows rows={3} />
        ) : (
          <ul className="list-unstyled mb-3">
            {(activity.data ?? []).map((a) => (
              <ActivityItem key={a.id} a={a} />
            ))}
          </ul>
        )}
        {i.can.comment && (
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              mutate.mutate(
                { kind: 'comment', text: text.trim() },
                { onSuccess: () => setText('') },
              );
            }}
          >
            <Form.Control
              as="textarea"
              rows={3}
              aria-label="Add a comment"
              placeholder="Add a comment… (notifies owner, reporter and PM)"
              value={text}
              maxLength={5000}
              onChange={(e) => setText(e.target.value)}
            />
            {mutate.error && (
              <div className="small text-danger mt-1" role="alert">
                ⚠ {saveErrorMessage(mutate.error)}
              </div>
            )}
            <div className="text-end mt-2">
              <Button type="submit" size="sm" disabled={!text.trim() || mutate.isPending}>
                Comment
              </Button>
            </div>
          </Form>
        )}
      </div>
    </div>
  );
}

function SidePanel({
  issue: i,
  onUpdate,
  onMove,
  onDue,
  disabled,
}: {
  issue: IssueDto;
  onUpdate: (b: Omit<UpdateIssueInput, 'version'>) => void;
  onMove: (to: IssueStatus) => void;
  onDue: (date: string) => void;
  disabled: boolean;
}) {
  const options = useIssueOptions(i.can.edit ? i.project.id : null);
  const o = options.data;
  const edit = i.can.edit && !disabled;
  const users = o?.users ?? (i.owner ? [i.owner] : []);
  return (
    <div className="card">
      <div className="card-body">
        <Form.Group className="mb-3" controlId="side-status">
          <Form.Label className="small">Status</Form.Label>
          <Form.Select
            value={i.status}
            disabled={disabled || i.can.transitions.length === 0}
            onChange={(e) => onMove(e.target.value as IssueStatus)}
          >
            <option value={i.status}>{ISSUE_STATUS_LABELS[i.status]}</option>
            {i.can.transitions.map((t) => (
              <option key={t} value={t}>
                {ISSUE_STATUS_LABELS[t]}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-3" controlId="side-severity">
          <Form.Label className="small">Severity</Form.Label>
          <Form.Select
            value={i.severity}
            disabled={!edit}
            onChange={(e) => onUpdate({ severity: e.target.value as IssueDto['severity'] })}
          >
            {ISSUE_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {ISSUE_SEVERITY_LABELS[s]}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-3" controlId="side-category">
          <Form.Label className="small">Category</Form.Label>
          <Form.Select
            value={i.category}
            disabled={!edit}
            onChange={(e) => onUpdate({ category: e.target.value as IssueDto['category'] })}
          >
            {ISSUE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {ISSUE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-3" controlId="side-stage">
          <Form.Label className="small">Stage</Form.Label>
          <Form.Select
            value={i.stage}
            disabled={!edit}
            onChange={(e) => onUpdate({ stage: e.target.value as IssueDto['stage'] })}
          >
            {ISSUE_STAGES.map((s) => (
              <option key={s} value={s}>
                {ISSUE_STAGE_LABELS[s]}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-3" controlId="side-owner">
          <Form.Label className="small">Owner</Form.Label>
          <Form.Select
            value={i.owner?.id ?? ''}
            disabled={!edit}
            isInvalid={i.ownerNeeded}
            onChange={(e) => onUpdate({ ownerId: e.target.value || null })}
          >
            <option value="">No owner</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Form.Select>
          {i.ownerNeeded && (
            <Form.Control.Feedback type="invalid">Owner needed</Form.Control.Feedback>
          )}
        </Form.Group>
        <Form.Group className="mb-3" controlId="side-reported">
          <Form.Label className="small">Reported by</Form.Label>
          {edit && o ? (
            <Form.Select
              value={i.contact?.id ?? ''}
              onChange={(e) => onUpdate({ reportedByContactId: e.target.value || null })}
            >
              <option value="">
                {i.reportedBy ? shortName(i.reportedBy.name) : 'Internal'} (internal)
              </option>
              {o.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {i.reportedBy ? `${shortName(i.reportedBy.name)} · for ` : ''}
                  {c.name}
                </option>
              ))}
            </Form.Select>
          ) : (
            <div className="form-control bg-body-tertiary">
              {i.reportedBy ? shortName(i.reportedBy.name) : 'Unknown'}
              {i.contact && ` · for ${i.contact.name}${i.client ? ` (${i.client.name})` : ''}`}
            </div>
          )}
        </Form.Group>
        <Form.Group controlId="side-due">
          <Form.Label className="small">Due date</Form.Label>
          {edit ? (
            <>
              <Form.Control
                type="date"
                value={i.dueDate ?? ''}
                className={i.overdue ? 'text-danger' : undefined}
                onChange={(e) => {
                  if (e.target.value && e.target.value !== i.dueDate) onDue(e.target.value);
                }}
              />
              <Form.Text className={i.overdue ? 'text-danger' : undefined}>
                {issueDueLabel(i.dueDate, i.overdue)}
                {i.dueManual ? ' · set by hand' : ' · from severity'}
              </Form.Text>
            </>
          ) : (
            <div className={`form-control bg-body-tertiary ${i.overdue ? 'text-danger' : ''}`}>
              {issueDueLabel(i.dueDate, i.overdue)}
            </div>
          )}
        </Form.Group>
      </div>
    </div>
  );
}

function ClosedState({ issue: i }: { issue: IssueDto }) {
  return (
    <div className="card mt-4">
      <div className="card-body">
        <h2 className="h6">{i.status === 'CLOSED' ? 'Closed state' : 'Resolved'}</h2>
        <div className="alert alert-success small mb-2">
          {i.status === 'CLOSED' ? (
            <>
              ✓ Closed {i.closedAt ? shortDate(i.closedAt) : ''}
              {i.closedBy ? ` by ${i.closedBy.name}` : ' automatically'}.
            </>
          ) : (
            <>✓ Resolved {i.resolvedAt ? shortDate(i.resolvedAt) : ''}.</>
          )}
          {i.resolution && <span className="d-block">Resolution: “{i.resolution}”</span>}
          {i.closedReason && <span className="d-block">Reason: {i.closedReason}</span>}
        </div>
        <p className="small text-body-secondary mb-0">
          {i.status === 'RESOLVED'
            ? `Closes automatically after ${ISSUE_AUTO_CLOSE_DAYS} days unless reopened.`
            : 'PMs and Admins see "Reopen", which asks for a reason. Only Admins see Delete.'}
        </p>
      </div>
    </div>
  );
}
