import type { FollowUpDto } from '@xc8/shared';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { dateTime } from '../../lib/format';
import { avatarTone, followUpTime, initials, threadLayout } from '../../lib/followUps';

/**
 * CR-20 follow-ups as a chat thread: bubbles with avatars (mine on the right), runs by one author
 * grouped, day separators, a "New" divider above the first unseen one, and the composer pinned
 * under its own scroll area. Presentation only: what counts as new comes in as `newIds`.
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
  const rows = threadLayout(followUps);
  const firstNewId = rows.find((r) => newIds.has(r.item.id))?.item.id;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef('');

  // On open, show the first New one (or the newest); after posting, follow the newest.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const key = `${taskId}:${followUps.length}`;
    if (!box || scrolledFor.current === key) return;
    const opening = !scrolledFor.current.startsWith(`${taskId}:`);
    scrolledFor.current = key;
    const divider = box.querySelector<HTMLElement>('[data-testid="follow-ups-new-divider"]');
    box.scrollTop = opening && divider ? divider.offsetTop : box.scrollHeight;
  }, [taskId, followUps.length]);

  return (
    <div className="followups">
      {rows.length === 0 ? (
        <p className="small text-body-secondary mb-3">No follow-ups yet.</p>
      ) : (
        <div className="followups-scroll" ref={scrollRef}>
          <ul className="followups-thread list-unstyled mb-0" aria-label="Follow-up messages">
            {rows.map(({ item: f, day, groupStart }) => {
              const own = Boolean(meId) && f.author?.id === meId;
              const isNew = newIds.has(f.id);
              const name = f.author?.name ?? 'Unknown';
              return [
                day && (
                  <li key={`day-${f.id}`} className="followup-sep" data-testid="follow-ups-day">
                    <span>{day}</span>
                  </li>
                ),
                f.id === firstNewId && (
                  <li
                    key={`new-${f.id}`}
                    className="followup-sep followup-sep-new"
                    data-testid="follow-ups-new-divider"
                  >
                    <span>New</span>
                  </li>
                ),
                <li
                  key={f.id}
                  data-testid={`follow-up-${f.id}`}
                  data-own={own ? 'true' : 'false'}
                  className={[
                    'followup-msg',
                    own ? 'followup-own' : 'followup-other',
                    groupStart ? 'followup-group-start' : 'followup-grouped',
                    isNew ? 'followup-new' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="followup-avatar-col" aria-hidden="true">
                    {groupStart && (
                      <span className={`followup-avatar bg-label-${avatarTone(f.author?.id)}`}>
                        {initials(f.author?.name)}
                      </span>
                    )}
                  </div>
                  <div className="followup-body">
                    {groupStart ? (
                      <div className="followup-author">{name}</div>
                    ) : (
                      <span className="visually-hidden">{name}</span>
                    )}
                    <div className="followup-bubble">{f.note}</div>
                    <div className="followup-meta">
                      <time dateTime={f.at} title={dateTime(f.at)}>
                        <span aria-hidden="true">{followUpTime(f.at)}</span>
                        <span className="visually-hidden">{dateTime(f.at)}</span>
                      </time>
                      {isNew && <span className="visually-hidden">New</span>}
                      {f.emailedAt && (
                        <i
                          className="bx bx-envelope followup-emailed"
                          role="img"
                          aria-label="Emailed"
                          title="Emailed"
                        />
                      )}
                    </div>
                  </div>
                </li>,
              ];
            })}
          </ul>
        </div>
      )}
      {composer && <div className="followups-composer">{composer}</div>}
    </div>
  );
}
