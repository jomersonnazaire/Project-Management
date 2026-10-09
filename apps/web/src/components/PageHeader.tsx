import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TopbarContext } from './topbar';
import { useIsCompact } from '../lib/useMediaQuery';

/**
 * Page title (and optional primary action), shown in the top bar as in mockup v0.4.2 (DR-02).
 * Outside the app shell (no top bar) it falls back to an inline heading.
 */
export function PageHeader({
  title,
  badge,
  children,
}: {
  title: string;
  /** Optional status badge shown after the title (e.g. a client's Active badge). */
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const slots = useContext(TopbarContext);
  // DR-40: on phones (and small tablets, below 768px) the top bar has no room for the title, so it
  // becomes the page's heading with the page's actions next to it; the top bar keeps the menu,
  // timer, bell and avatar.
  const phone = useIsCompact();
  const heading = (
    <h1 className={phone ? 'h4 mb-0 page-title' : 'h5 mb-0 text-truncate page-title'}>
      {title}
      {badge && <span className="ms-2 align-middle">{badge}</span>}
    </h1>
  );
  if (!slots.title || phone) {
    return (
      <div
        className={`d-flex flex-wrap align-items-center gap-3 ${phone ? 'mb-4 page-heading-phone' : 'mb-6'}`}
      >
        <div className="me-auto min-w-0">{heading}</div>
        {children}
      </div>
    );
  }
  return (
    <>
      {createPortal(heading, slots.title)}
      {children && <TopbarActions>{children}</TopbarActions>}
    </>
  );
}

/** Puts a page's primary action (e.g. "+ Invite user") in the top bar next to the title. */
export function TopbarActions({ children }: { children: ReactNode }) {
  const { actions } = useContext(TopbarContext);
  const phone = useIsCompact();
  if (!actions || phone)
    return <div className="d-flex justify-content-end gap-2 mb-4">{children}</div>;
  return createPortal(children, actions);
}
