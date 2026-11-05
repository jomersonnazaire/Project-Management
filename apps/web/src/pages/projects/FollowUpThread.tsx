import type { FollowUpDto } from '@xc8/shared';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { dateTime } from '../../lib/format';
import { followUpTime, threadLayout } from '../../lib/followUps';

/**
 * CR-20 follow-ups as a chat thread (UI spec v0.9.19, docs/design/FOLLOWUPS_CONVERSATION_UI.md):
 * bubbles with avatars (mine on the right, named "You"), runs sharing one avatar and name, day
 * chips, a "New" divider above the first unseen one, and the composer pinned under the scrolling
 * thread. Presentation only: what counts as new comes in as `newIds`.
 */
export function FollowUpThread({
  taskId,
  followUps,
  meId,
  newIds,
  composer,
}: {
  taskId: string;
  followUps: FollowUpDto[];
  meId: string | undefined;
  /** FR-NTF-12: the follow-ups that were unseen when the panel opened. */
  newIds: ReadonlySet<string>;
  composer?: ReactNode;
}) {
  const rows = threadLayout(followUps, newIds);
  const threadRef = useRef<HTMLDivElement>(null);
  const count = followUps.length;

  // Opens scrolled to the newest message (spec §1), and follows the newest after a post.
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [taskId, count]);

  return (
    <div className="fu">
      {rows.length === 0 ? (
        <div className="fu-empty">
          <span className="fu-empty-ic" aria-hidden="true">
            <i className="bx bx-message-rounded-dots" />
          </span>
          <strong className="fu-empty-title">No follow-ups yet</strong>
          <span className="small">Post the first note below. The team will see it here.</span>
        </div>
      ) : (
        <div className="fu-thread" ref={threadRef} tabIndex={0} aria-label="Follow-ups thread">
          <ul className="list-unstyled mb-0 fu-list" aria-label="Follow-up messages">
            {rows.map(({ item: f, day, newDivider, runStart }) => {
              const own = Boolean(meId) && f.author?.id === meId;
              const name = own ? 'You' : (f.author?.name ?? 'Unknown');
              return [
                day && (
                  <li key={`day-${f.id}`} className="fu-day" data-testid="follow-ups-day">
                    {day}
                  </li>
                ),
                newDivider && (
                  <li
                    key={`new-${f.id}`}
                    className="fu-new"
                    data-testid="follow-ups-new-divider"
                    aria-label="New follow-ups"
                  >
                    New
                  </li>
                ),
                <li
                  key={f.id}
                  data-testid={`follow-up-${f.id}`}
                  data-own={own ? 'true' : 'false'}
                  data-run-start={runStart ? 'true' : 'false'}
                  className={['fu-msg', own ? 'own' : '', runStart ? 'first' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {runStart ? (
                    <Avatar
                      className="fu-av"
                      userId={f.author?.id}
                      name={f.author?.name}
                      photo={f.author?.avatarUpdatedAt}
                    />
                  ) : (
                    <span className="fu-av sp" aria-hidden="true" />
                  )}
                  <div className="fu-col">
                    {runStart ? (
                      <span className="fu-name">{name}</span>
                    ) : (
                      <span className="visually-hidden">{name}</span>
                    )}
                    <div className="fu-b">{f.note}</div>
                    <span className="fu-t">
                      <time dateTime={f.at} title={dateTime(f.at)}>
                        {followUpTime(f.at)}
                      </time>
                      {f.emailedAt && (
                        <span className="fu-mail" title="Emailed" data-testid="follow-up-emailed">
                          <i className="bx bx-envelope" aria-hidden="true" />
                          <span className="visually-hidden">Emailed</span>
                        </span>
                      )}
                    </span>
                  </div>
                </li>,
              ];
            })}
          </ul>
        </div>
      )}
      {composer && <div className="fu-comp">{composer}</div>}
    </div>
  );
}
