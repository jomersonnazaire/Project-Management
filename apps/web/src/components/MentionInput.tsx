import { matchMentions, type MentionCandidate } from '@xc8/shared';
import {
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { initials } from '../lib/format';
import {
  atMentionLimit,
  findTrigger,
  highlightRuns,
  prunePicked,
  type PickedMention,
} from '../lib/mentions';

export const MENTION_LIMIT_PICKER =
  'You can mention up to 10 people. Remove one to mention someone else.';

/** The typed part of the name in bold (UIE §4.2). */
function nameWithMatch(name: string, query: string): ReactNode {
  const q = query.toLowerCase();
  if (!q) return name;
  const lower = name.toLowerCase();
  let at = lower.startsWith(q) ? 0 : -1;
  for (let i = 1; at < 0 && i < lower.length; i++) {
    if (/\s/.test(lower[i - 1]!) && lower.startsWith(q, i)) at = i;
  }
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <b>{name.slice(at, at + q.length)}</b>
      {name.slice(at + q.length)}
    </>
  );
}

/**
 * CR-24 FR-CNV-13 (UIE §4): the Conversation textarea with @mention picking. Typing `@` opens the
 * project-member list above the box; picking inserts `@Full Name ` and records the id. A highlight
 * layer behind the transparent textarea shows picked mentions as chips; the native textarea
 * (undo, IME, paste) is kept. Text and picks are the parent's state, so a refresh never resets
 * them (FR-ARF-06).
 */
export function MentionInput({
  value,
  picked,
  people,
  onChange,
  error,
  label,
  placeholder,
  maxLength,
}: {
  value: string;
  picked: PickedMention[];
  people: MentionCandidate[];
  onChange: (text: string, picked: PickedMention[]) => void;
  error: string | null;
  label: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const errId = `${uid}-err`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Esc closes the list for that `@` until a new one is typed.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  // After a pick, the caret goes right after the inserted name (set once the value is rendered).
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const trigger = findTrigger(value, caret);
  const limit = atMentionLimit(picked);
  const matches = trigger ? matchMentions(trigger.query, people) : [];
  const hasSpace = Boolean(trigger?.query.includes(' '));
  const open =
    Boolean(trigger) &&
    trigger!.start !== dismissed &&
    (limit || matches.length > 0 || !hasSpace) &&
    people.length > 0;
  const showRows = open && !limit && matches.length > 0;
  const sel = Math.min(active, Math.max(0, matches.length - 1));

  // UIE 96c3915: the box grows with its text up to about 8 lines (192px), then scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = el.scrollHeight;
    el.style.height = h ? `${Math.min(h, 192)}px` : '';
  }, [value]);

  const change = (text: string, nextCaret: number, nextPicked = picked) => {
    const t = findTrigger(text, nextCaret);
    if (dismissed !== null && t?.start !== dismissed) setDismissed(null);
    setCaret(nextCaret);
    setActive(0);
    onChange(text, prunePicked(text, nextPicked));
  };

  const pick = (c: MentionCandidate) => {
    if (!trigger || limit) return;
    const insert = `@${c.name} `;
    const text = value.slice(0, trigger.start) + insert + value.slice(caret);
    const at = trigger.start + insert.length;
    change(text, at, [...picked, { id: c.id, name: c.name }]);
    setStatus(`${c.name} mentioned.`);
    pendingCaret.current = at;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(trigger!.start);
      return;
    }
    if (limit) {
      if (e.key === 'Enter' || e.key === 'Tab') e.preventDefault();
      return;
    }
    if (!matches.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = matches.length;
      setActive((sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(matches[sel]!);
    }
  };

  const announce = !open
    ? status
    : limit
      ? 'You can mention up to 10 people.'
      : matches.length
        ? `${matches.length} project member${matches.length === 1 ? '' : 's'} match${matches.length === 1 ? 'es' : ''}. ${matches[sel]!.name}, ${matches[sel]!.role}.`
        : `No project member matches @${trigger!.query}.`;

  return (
    <div className="mention-box">
      {open && (
        <div className="mention-picker" data-testid="mention-picker">
          <div className="mention-picker-head">Project members</div>
          {limit ? (
            <p className="mention-picker-empty mb-0">
              <i className="bx bx-info-circle me-1" aria-hidden="true" />
              {MENTION_LIMIT_PICKER}
            </p>
          ) : showRows ? (
            <ul
              className="list-unstyled mb-0"
              role="listbox"
              id={listId}
              aria-label="Project members"
            >
              {matches.map((c, i) => (
                <li
                  key={c.id}
                  id={`${listId}-${c.id}`}
                  role="option"
                  aria-selected={i === sel}
                  className={`mention-option ${i === sel ? 'is-active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                >
                  <span className="avatar avatar-xs flex-none" aria-hidden="true">
                    <span className="avatar-initial rounded-circle bg-label-primary">
                      {initials(c.name)}
                    </span>
                  </span>
                  <span className="flex-grow-1 text-truncate">
                    {nameWithMatch(c.name, trigger!.query)}
                  </span>
                  <small className="text-body-secondary">{c.role}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mention-picker-empty mb-0">
              No project member matches <b>@{trigger!.query}</b>. Only people on this project&apos;s
              team can be mentioned.
            </p>
          )}
          {showRows && (
            <div className="mention-picker-foot" aria-hidden="true">
              ↑↓ move · Enter or Tab pick · Esc close
            </div>
          )}
        </div>
      )}
      <div className="mention-field">
        <div className="mention-mirror form-control" ref={mirror} aria-hidden="true">
          {highlightRuns(value, picked).map((r, i) =>
            r.mention ? (
              <mark key={i} className="mention-hl">
                {r.text}
              </mark>
            ) : (
              <span key={i}>{r.text}</span>
            ),
          )}
          {'\u200b'}
        </div>
        <textarea
          ref={ref}
          className={`form-control mention-input ${error ? 'is-invalid' : ''}`}
          rows={3}
          placeholder={placeholder}
          aria-label={label}
          maxLength={maxLength}
          value={value}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showRows}
          aria-controls={showRows ? listId : undefined}
          aria-activedescendant={showRows ? `${listId}-${matches[sel]!.id}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errId : undefined}
          onChange={(e) => change(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>
      {error && (
        <div className="invalid-feedback d-block" id={errId} role="alert">
          {error}
        </div>
      )}
      <div className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
