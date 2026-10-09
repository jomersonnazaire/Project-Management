import {
  MAX_MESSAGE_LENGTH,
  MESSAGE_TYPES,
  MESSAGE_TYPE_LABELS,
  MESSAGE_TYPE_PLURALS,
  MESSAGE_TYPE_VARIANTS,
  linkify,
  shortName,
  type MessageDto,
  type MessageType,
  type ProjectDto,
  type TaskDto,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form } from 'react-bootstrap';
import { useHideMessage, useMessages, usePostMessage } from '../../api/m3Hooks';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { ReasonModal } from '../../components/ReasonModal';
import { dayLabel, initials, shortDate, timeOfDay } from '../../lib/format';

/** Message text as plain text: links become anchors, nothing is ever rendered as HTML (FR-CNV-04). */
function MessageText({ text }: { text: string }) {
  return (
    <div className="msg-text">
      {linkify(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}

function Message({
  m,
  canHide,
  onHide,
  onOpenTask,
}: {
  m: MessageDto;
  canHide: boolean;
  onHide: () => void;
  onOpenTask: (id: string) => void;
}) {
  if (m.hidden) {
    return (
      <div className="d-flex gap-3 mb-3" data-testid="hidden-message">
        <span className="avatar avatar-sm">
          <span className="avatar-initial rounded-circle bg-label-secondary">?</span>
        </span>
        <div className="small text-body-secondary fst-italic">
          Message hidden by {m.hidden.by?.name ?? 'an Admin'} on {shortDate(m.hidden.at)}. Reason:{' '}
          {m.hidden.reason}
        </div>
      </div>
    );
  }
  return (
    <div className="d-flex gap-3 mb-3">
      <span className="avatar avatar-sm flex-none">
        <span className="avatar-initial rounded-circle bg-label-primary">
          {initials(m.author?.name ?? '?')}
        </span>
      </span>
      <div className="flex-grow-1 min-w-0">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <strong className="text-heading">
            {m.author ? shortName(m.author.name) : 'Unknown user'}
          </strong>
          <span className={`badge bg-label-${MESSAGE_TYPE_VARIANTS[m.type]}`}>
            {MESSAGE_TYPE_LABELS[m.type]}
          </span>
          <small className="text-body-secondary">{timeOfDay(m.at)}</small>
          {canHide && (
            <Button
              variant="link"
              size="sm"
              className="p-0 ms-auto text-body-secondary"
              onClick={onHide}
            >
              Hide
            </Button>
          )}
        </div>
        <MessageText text={m.text ?? ''} />
        {(m.task || m.contacts.length > 0) && (
          <div className="d-flex flex-wrap gap-2 mt-1">
            {m.task && (
              <button
                type="button"
                className="badge bg-label-secondary border-0"
                onClick={() => onOpenTask(m.task!.id)}
              >
                <i className="bx bx-check-square me-1" aria-hidden="true" />
                {m.task.name}
              </button>
            )}
            {m.contacts.map((c) => (
              <span key={c.id} className="badge bg-label-info">
                <i className="bx bx-phone me-1" aria-hidden="true" />
                {c.name}
                {!c.active && ' (Inactive)'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The Project Conversation (FR-CNV-01..08): one permanent, plain-text thread per project for
 * notes, calls, meetings and decisions. Messages can't be edited or deleted; Admins may hide one.
 */
export function ConversationTab({
  project,
  tasks,
  onOpenTask,
}: {
  project: ProjectDto;
  tasks: TaskDto[];
  onOpenTask: (id: string) => void;
}) {
  const [filters, setFilters] = useState<{ type?: string; taskId?: string; q?: string }>({});
  const [q, setQ] = useState('');
  const list = useMessages(project.id, filters);
  const post = usePostMessage(project.id);
  const hide = useHideMessage(project.id);
  const [hiding, setHiding] = useState<MessageDto | null>(null);
  const [draft, setDraft] = useState({
    text: '',
    type: 'NOTE' as MessageType,
    taskId: '',
    contactId: '',
  });
  const [missing, setMissing] = useState(false);
  const items = list.data?.items ?? [];
  const can = list.data?.can;
  const contacts = project.activeContacts.filter((c) => c.active);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.text.trim()) return setMissing(true);
    post.mutate(
      {
        text: draft.text.trim(),
        type: draft.type,
        taskId: draft.taskId || null,
        contactIds: draft.contactId ? [draft.contactId] : [],
      },
      { onSuccess: () => setDraft({ text: '', type: 'NOTE', taskId: '', contactId: '' }) },
    );
  };

  const filtered = Boolean(filters.type || filters.taskId || filters.q);

  return (
    <div className="row g-6">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-body">
            <div className="d-flex flex-wrap gap-2 mb-4">
              <Form
                className="flex-grow-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  setFilters((f) => ({ ...f, q: q.trim() || undefined }));
                }}
              >
                <Form.Control
                  type="search"
                  placeholder="Search conversation…"
                  aria-label="Search conversation"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    if (!e.target.value) setFilters((f) => ({ ...f, q: undefined }));
                  }}
                />
              </Form>
              <Form.Select
                aria-label="Filter by type"
                style={{ maxWidth: 160 }}
                value={filters.type ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value || undefined }))}
              >
                <option value="">All types</option>
                {MESSAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MESSAGE_TYPE_PLURALS[t]}
                  </option>
                ))}
              </Form.Select>
              <Form.Select
                aria-label="Filter by task"
                style={{ maxWidth: 220 }}
                value={filters.taskId ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, taskId: e.target.value || undefined }))}
              >
                <option value="">All tasks</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.order} {t.name}
                  </option>
                ))}
              </Form.Select>
            </div>
            <ErrorAlert error={list.error} />
            <ErrorAlert error={hide.error} action />
            {list.isPending ? (
              <LoadingRows rows={4} />
            ) : items.length === 0 ? (
              filtered ? (
                <p className="text-body-secondary">No messages match these filters.</p>
              ) : (
                <EmptyState icon="bx-message-square-dots" title="No messages yet">
                  Record calls, meetings and decisions here so the whole team knows what was agreed.
                </EmptyState>
              )
            ) : (
              <div aria-live="polite">
                {items.map((m, i) => {
                  const day = dayLabel(m.at);
                  const sep = i === 0 || dayLabel(items[i - 1]!.at) !== day;
                  return (
                    <div key={m.id}>
                      {sep && <div className="day-sep">{day}</div>}
                      <Message
                        m={m}
                        canHide={Boolean(can?.hide)}
                        onHide={() => setHiding(m)}
                        onOpenTask={onOpenTask}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {can?.post && !project.archived ? (
              <Form onSubmit={submit} noValidate className="border-top pt-4 mt-4">
                <ErrorAlert error={post.error} action />
                <div className="d-flex flex-wrap gap-2 mb-2">
                  <Form.Select
                    aria-label="Message type"
                    style={{ maxWidth: 140 }}
                    value={draft.type}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value as MessageType })}
                  >
                    {MESSAGE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {MESSAGE_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Select
                    aria-label="Tag a task"
                    style={{ maxWidth: 240 }}
                    value={draft.taskId}
                    onChange={(e) => setDraft({ ...draft, taskId: e.target.value })}
                  >
                    <option value="">Tag a task (optional)</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        #{t.order} {t.name}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Select
                    aria-label="Tag a client contact"
                    style={{ maxWidth: 240 }}
                    value={draft.contactId}
                    onChange={(e) => setDraft({ ...draft, contactId: e.target.value })}
                  >
                    <option value="">Tag a client contact (optional)</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {project.clientName}
                      </option>
                    ))}
                  </Form.Select>
                </div>
                <Form.Control
                  as="textarea"
                  rows={3}
                  placeholder="Write a message for the project team…"
                  aria-label="Message"
                  maxLength={MAX_MESSAGE_LENGTH}
                  value={draft.text}
                  isInvalid={missing}
                  onChange={(e) => {
                    setDraft({ ...draft, text: e.target.value });
                    setMissing(false);
                  }}
                />
                <Form.Control.Feedback type="invalid">Write a message first.</Form.Control.Feedback>
                <div className="d-flex align-items-center gap-2 mt-2">
                  <small className="text-body-secondary me-auto">
                    Messages are permanent and can't be edited or deleted.
                  </small>
                  <Button type="submit" disabled={post.isPending}>
                    Post
                  </Button>
                </div>
              </Form>
            ) : (
              can && (
                <p className="small text-body-secondary border-top pt-3 mt-4 mb-0">
                  You can read this conversation but not post.
                </p>
              )
            )}
          </div>
        </div>
      </div>
      <div className="col-lg-4">
        <div className="card">
          <div className="card-body">
            <h2 className="h6">Who sees this</h2>
            <p className="small text-body-secondary mb-0">
              Everyone who can see the project. Messages are plain text, links open in a new tab,
              and an Admin can hide a message that breaks the conduct policy.
            </p>
          </div>
        </div>
      </div>
      {hiding && (
        <ReasonModal
          title="Hide message"
          label="Reason"
          confirmLabel="Hide message"
          intro="The text is hidden from everyone. The hide is recorded in the audit log."
          pending={hide.isPending}
          error={hide.error}
          onClose={() => setHiding(null)}
          onSubmit={(reason) =>
            hide.mutate({ id: hiding.id, reason }, { onSuccess: () => setHiding(null) })
          }
        />
      )}
    </div>
  );
}
