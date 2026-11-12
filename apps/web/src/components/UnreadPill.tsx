import { unreadLabel } from '@xc8/shared';

/**
 * CR-24 UIE §2: the Conversation unread pill (tab and project row). Hidden at 0; 99+ above 99
 * (Q-171). The number is the server's `conversationUnread`, never counted here (FR-CNV-15).
 */
export function UnreadPill({ count, srText = true }: { count?: number | null; srText?: boolean }) {
  if (!count) return null;
  return (
    <>
      <span className="unread-count" aria-hidden="true">
        {unreadLabel(count)}
      </span>
      {srText && <span className="visually-hidden">, {count} unread</span>}
    </>
  );
}
