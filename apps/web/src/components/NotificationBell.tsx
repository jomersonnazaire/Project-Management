import { NOTIFICATION_LIST_NOTE, NOTIFICATION_VERBS, shortName } from '@xc8/shared';
import { useState } from 'react';
import { Dropdown } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useMarkRead, useNotifications, useUnreadCount } from '../api/m3Hooks';
import { relativeTime } from '../lib/format';
import { badgeCount } from '../lib/m3ui';
import { ErrorAlert, LoadingRows } from './Feedback';

/**
 * In-app notifications (FR-NTF-01..06): the bell polls the unread count every 60 s and on focus.
 * Clicking a notification opens its task and marks it read. No email in this milestone.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useNotifications(open);
  const mark = useMarkRead();
  const navigate = useNavigate();
  const count = unread.data ?? 0;
  const items = list.data?.items ?? [];

  return (
    <Dropdown align="end" show={open} onToggle={(next) => setOpen(next)} autoClose="outside">
      <Dropdown.Toggle
        as="button"
        className="btn btn-link nav-link p-0 hide-arrow position-relative"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
      >
        <i className="bx bx-bell fs-4" aria-hidden="true" />
        {count > 0 && (
          <span
            className="badge rounded-pill bg-danger position-absolute top-0 start-100 translate-middle notif-count"
            aria-hidden="true"
          >
            {badgeCount(count)}
          </span>
        )}
      </Dropdown.Toggle>
      <Dropdown.Menu className="notif-menu p-0" style={{ width: 360 }}>
        <div className="d-flex align-items-center px-4 py-3 border-bottom">
          <h6 className="mb-0 me-auto">Notifications</h6>
          {count > 0 && (
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              onClick={() => mark.mutate('all')}
              disabled={mark.isPending}
            >
              Mark all as read
            </button>
          )}
        </div>
        <ErrorAlert error={list.error} className="m-3" />
        {list.isPending ? (
          <div className="p-3">
            <LoadingRows rows={3} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center p-5">
            <i className="bx bx-bell fs-2 text-body-secondary" aria-hidden="true" />
            <div className="fw-semibold text-heading mt-2">You're all caught up</div>
            <small className="text-body-secondary">
              Follow-ups on your tasks and issues will show here.
            </small>
          </div>
        ) : (
          <ul className="list-unstyled mb-0" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`dropdown-item d-flex gap-3 py-3 text-wrap ${n.read ? '' : 'notif-unread'}`}
                  onClick={() => {
                    if (!n.read) mark.mutate(n.id);
                    setOpen(false);
                    navigate(
                      n.link
                        ? n.link
                        : n.issue
                          ? `/issues/${n.issue.id}`
                          : n.task && n.project
                            ? `/projects/${n.project.id}?task=${n.task.id}`
                            : `/projects/${n.project?.id ?? ''}`,
                    );
                  }}
                >
                  <span
                    className={`notif-dot mt-2 ${n.read ? 'invisible' : ''}`}
                    aria-label={n.read ? undefined : 'Unread'}
                  />
                  <span className="flex-grow-1 small">
                    {n.message ? (
                      // Personal notices (tracker, leave) carry their own sentence.
                      <>{n.message}</>
                    ) : n.issue && !n.actor ? (
                      // System reminders (overdue, owner needed) have no actor.
                      <>
                        {NOTIFICATION_VERBS[n.type]}{' '}
                        <strong>
                          {n.issue.key} {n.issue.title}
                        </strong>
                      </>
                    ) : (
                      <>
                        <strong>{n.actor ? shortName(n.actor.name) : 'Someone'}</strong>{' '}
                        {NOTIFICATION_VERBS[n.type]}{' '}
                        <strong>
                          {n.issue ? `${n.issue.key} ${n.issue.title}` : (n.task?.name ?? 'a task')}
                        </strong>
                      </>
                    )}
                    {n.project && ` · ${n.project.name}`}
                    <span className="d-block text-body-secondary">{relativeTime(n.at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <p className="small text-body-secondary text-center my-2">{NOTIFICATION_LIST_NOTE}</p>
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
}
