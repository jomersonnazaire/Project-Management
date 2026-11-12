import {
  MAX_MESSAGE_LENGTH,
  MESSAGE_TYPES,
  MESSAGE_TYPE_LABELS,
  MESSAGE_TYPE_PLURALS,
  MESSAGE_TYPE_VARIANTS,
  linkify,
  shortName,
  splitMentions,
  UNKNOWN_USER,
  type MessageDto,
  type MessageType,
  type ProjectDto,
  type TaskDto,
} from '@xc8/shared';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Form } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { joinNames } from '../../api/emailHooks';
import {
  useHideMessage,
  useMarkConversationSeen,
  useMessages,
  usePostMessage,
} from '../../api/m3Hooks';
import { useAuth } from '../../auth/AuthContext';
import { MentionInput } from '../../components/MentionInput';
import { mentionCandidates, withTokens, type PickedMention } from '../../lib/mentions';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { ReasonModal } from '../../components/ReasonModal';
import { useCan } from '../../auth/useCan';
import { LinkIssueModal } from './LinkIssueModal';
import { dayLabel, initials, shortDate, timeOfDay } from '../../lib/format';

/** Plain text with links as anchors; nothing is ever rendered as HTML (FR-CNV-04). */
function Linked({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * CR-24 L-3 (Lean a-e): a `<@id>` token shows the person's CURRENT name. A saved mention (or the
 * author's own) is a chip: you are solid with "(you)", a deactivated person is muted and read as
 * "{name} (deactivated)". Anyone else named is plain "@Name". An id with no user is a grey
 * "Unknown user" chip. Chips are never links and never focusable.
 */
function MentionChip({
  person,
  meId,
}: {
  person: { id: string; name: string; active: boolean; chip?: boolean } | undefined;
  meId?: string;
}) {
  if (!person) return <span className="mention off">{UNKNOWN_USER}</span>;
  if (person.chip === false) return <span>@{person.name}</span>;
  if (!person.active) {
    return (
      <span className="mention off" title={`${person.name} (deactivated)`}>
        <span aria-hidden="true">@{person.name}</span>
        <span className="visually-hidden">{person.name} (deactivated)</span>
      </span>
    );
  }
  const me = person.id === meId;
  return (
    <span className={`mention ${me ? 'me' : ''}`}>
      @{person.name}
      {me && <span className="visually-hidden"> (you)</span>}
    </span>
  );
}

function MessageText({ m, meId }: { m: MessageDto; meId?: string }) {
  const people = new Map((m.mentions ?? []).map((p) => [p.id, p]));
  return (
    <div className="msg-text">
      {splitMentions(m.text ?? '').map((part, i) =>
        'mention' in part ? (
          <MentionChip key={i} person={people.get(part.mention)} meId={meId} />
        ) : (
          <Linked key={i} text={part.text} />
        ),
      )}
    </div>
  );
}

/** UIE §4.3: "Notifies Test PM and Dev Two in the bell." (two names and "N others" past 3). */
function notifiesLine(names: string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} others`] : names;
  return `Notifies ${joinNames(shown)} in the bell.`;
}

/** True while the browser tab is visible (L-1: only a watched Conversation moves last-read). */
function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

const below = (el: Element | null) =>
  Boolean(el && el.getBoundingClientRect().top > window.innerHeight);

function Message({
  m,
  meId,
  target,
  canHide,
  onHide,
  onOpenTask,
  onLinkIssue,
}: {
  m: MessageDto;
  meId?: string;
  target: boolean;
  canHide: boolean;
  onHide: () => void;
  onOpenTask: (id: string) => void;
  onLinkIssue?: () => void;
}) {
  if (m.hidden) {
    return (
      <div className="d-flex gap-3 mb-3" data-testid="hidden-message" id={`msg-${m.id}`}>
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
  const mentionsMe = Boolean(meId && m.mentions?.some((p) => p.id === meId));
  return (
    <div
      className={`cnv-msg d-flex gap-3 mb-3 ${mentionsMe ? 'mentions-me' : ''} ${target ? 'is-target' : ''}`}
      id={`msg-${m.id}`}
    >
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
          {onLinkIssue && (
            <Button
              variant="link"
              size="sm"
              className={`p-0 text-body-secondary ${canHide ? 'ms-auto me-2' : 'ms-auto'}`}
              onClick={onLinkIssue}
            >
              <i className="bx bx-flag me-1" aria-hidden="true" />
              Link to issue
            </Button>
          )}
          {canHide && (
            <Button
              variant="link"
              size="sm"
              className={`p-0 text-body-secondary ${onLinkIssue ? '' : 'ms-auto'}`}
              onClick={onHide}
            >
              Hide
            </Button>
          )}
        </div>
        <MessageText m={m} meId={meId} />
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
  const empty = {
    text: '',
    type: 'NOTE' as MessageType,
    taskId: '',
    contactId: '',
    mentions: [] as PickedMention[],
  };
  const [draft, setDraft] = useState(empty);
  const [missing, setMissing] = useState(false);
  // L-4 (UIE 96c3915): the server's 10-mention refusal shows inline; the draft is kept.
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);
  const { user } = useAuth();
  const meId = user?.id;
  const people = mentionCandidates(project.manager, project.members, meId);
  const visible = useDocumentVisible();
  const [params] = useSearchParams();
  const targetMessage = params.get('message');
  const [target, setTarget] = useState<string | null>(targetMessage);
  const [linking, setLinking] = useState<MessageDto | null>(null);
  const canLink = useCan('issues', 'edit') && !project.archived;
  const items = list.data?.items ?? [];
  const can = list.data?.can;
  const contacts = project.activeContacts.filter((c) => c.active);

  const filtered = Boolean(filters.type || filters.taskId || filters.q);

  // FR-CNV-10 / UIE §3: the last-read point as it was when the tab opened, kept for the visit, so
  // the "New messages" divider doesn't move when last-read is written or a check brings more.
  const [visitReadAt, setVisitReadAt] = useState<string | null | undefined>(undefined);
  const loaded = list.data !== undefined;
  if (loaded && visitReadAt === undefined) setVisitReadAt(list.data!.lastReadAt ?? null);
  const firstNew =
    visitReadAt === undefined
      ? -1
      : items.findIndex(
          (m) => m.author?.id !== meId && !m.hidden && (visitReadAt === null || m.at > visitReadAt),
        );

  // FR-CNV-10 + L-1: opening the tab reads the thread; while it stays open and visible, each check
  // that brings newer messages moves last-read forward too (a hidden tab never does).
  const { mutate: markSeen } = useMarkConversationSeen(project.id);
  const seenUpTo = useRef<string | null>(null);
  const newest = items.at(-1)?.at ?? '';
  useEffect(() => {
    if (!loaded || !visible || visitReadAt === undefined || filtered) return;
    if (seenUpTo.current !== null && seenUpTo.current >= newest) return;
    seenUpTo.current = newest;
    markSeen(newest || undefined);
  }, [loaded, visible, visitReadAt, filtered, newest, markSeen]);

  // UIE §3 / §5: on open, go to the bell's message, or to the divider (140px below the top bar).
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    if (scrolled.current || visitReadAt === undefined) return;
    scrolled.current = true;
    const el = targetMessage
      ? document.getElementById(`msg-${targetMessage}`)
      : firstNew >= 0
        ? document.getElementById('cnv-new')
        : null;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 140;
    if (typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top });
      } catch {
        /* jsdom */
      }
    }
  }, [visitReadAt, firstNew, targetMessage]);
  // The bell's target keeps its tint until the next click.
  useEffect(() => {
    if (!target) return;
    const off = () => setTarget(null);
    document.addEventListener('click', off, { once: true });
    return () => document.removeEventListener('click', off);
  }, [target]);

  // UIE §4.4: a check that adds other people's messages below the fold shows "↓ N new messages".
  const known = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<string[]>([]);
  const ids = items.map((m) => m.id).join(',');
  useEffect(() => {
    if (!loaded) return;
    const prev = known.current;
    known.current = new Set(items.map((m) => m.id));
    if (!prev) return;
    const fresh = items.filter((m) => !prev.has(m.id) && m.author?.id !== meId);
    if (fresh.length && below(document.getElementById(`msg-${fresh.at(-1)!.id}`))) {
      setArrived((a) => [...a, ...fresh.map((m) => m.id)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, loaded]);
  useEffect(() => {
    if (!arrived.length) return;
    const check = () => {
      if (!below(document.getElementById(`msg-${arrived.at(-1)}`))) setArrived([]);
    };
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [arrived]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.text.trim()) return setMissing(true);
    const names = [...new Map(draft.mentions.map((m) => [m.id, m.name])).values()];
    post.mutate(
      {
        // L-3: each picked "@Full Name" goes out as a <@userId> token.
        text: withTokens(draft.text.trim(), draft.mentions),
        type: draft.type,
        taskId: draft.taskId || null,
        contactIds: draft.contactId ? [draft.contactId] : [],
      },
      {
        onSuccess: () => {
          setDraft(empty);
          setPosted(
            names.length
              ? `Posted. ${joinNames(names)} ${names.length === 1 ? 'gets' : 'get'} a bell notification.`
              : null,
          );
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'MENTION_LIMIT') {
            setMentionError(err.message);
          }
        },
      },
    );
  };
  const postError =
    post.error instanceof ApiError && post.error.code === 'MENTION_LIMIT' ? null : post.error;
  const notifyNames = [...new Map(draft.mentions.map((m) => [m.id, m.name])).values()];

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
              <div aria-live="polite" className="cnv-thread">
                {items.map((m, i) => {
                  const day = dayLabel(m.at);
                  const sep = i === 0 || dayLabel(items[i - 1]!.at) !== day;
                  return (
                    <div key={m.id}>
                      {sep && <div className="day-sep">{day}</div>}
                      {i === firstNew && (
                        <div
                          className="cnv-new"
                          id="cnv-new"
                          role="separator"
                          aria-label="New messages since you last opened this Conversation"
                        >
                          New messages
                        </div>
                      )}
                      <Message
                        m={m}
                        meId={meId}
                        target={m.id === target}
                        canHide={Boolean(can?.hide)}
                        onHide={() => setHiding(m)}
                        onOpenTask={onOpenTask}
                        onLinkIssue={canLink ? () => setLinking(m) : undefined}
                      />
                    </div>
                  );
                })}
                {arrived.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm rounded-pill cnv-jump"
                    onClick={() => {
                      document
                        .getElementById(`msg-${arrived[0]}`)
                        ?.scrollIntoView?.({ block: 'center' });
                      setArrived([]);
                    }}
                  >
                    ↓ {arrived.length} new message{arrived.length === 1 ? '' : 's'}
                  </button>
                )}
              </div>
            )}

            {can?.post && !project.archived ? (
              <Form onSubmit={submit} noValidate className="border-top pt-4 mt-4">
                <ErrorAlert error={postError} action />
                {posted && (
                  <div className="alert alert-success py-2" role="status">
                    {posted}
                  </div>
                )}
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
                    <option value="">Tag a contact</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {project.clientName}
                      </option>
                    ))}
                  </Form.Select>
                </div>
                <MentionInput
                  label="Message"
                  placeholder="Write a message for the project team…"
                  maxLength={MAX_MESSAGE_LENGTH}
                  value={draft.text}
                  picked={draft.mentions}
                  people={people}
                  error={missing ? 'Write a message first.' : mentionError}
                  onChange={(text, mentions) => {
                    setDraft((d) => ({ ...d, text, mentions }));
                    setMissing(false);
                    setMentionError(null);
                    setPosted(null);
                  }}
                />
                <p className="small text-body-secondary mt-1 mb-0" data-testid="mention-hint">
                  {notifyNames.length ? (
                    <>
                      <span aria-hidden="true">🔔 </span>
                      {notifiesLine(notifyNames)}
                    </>
                  ) : (
                    'Type @ to mention a project member. Only people you mention get a bell notification.'
                  )}
                </p>
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
      {linking && (
        <LinkIssueModal projectId={project.id} message={linking} onClose={() => setLinking(null)} />
      )}
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
