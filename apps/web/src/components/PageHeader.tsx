import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TopbarContext } from './topbar';

/**
 * Page title (and optional primary action), shown in the top bar as in mockup v0.4.2 (DR-02).
 * Outside the app shell (no top bar) it falls back to an inline heading.
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const slots = useContext(TopbarContext);
  const heading = <h1 className="h5 mb-0 text-truncate page-title">{title}</h1>;
  if (!slots.title) {
    return (
      <div className="d-flex flex-wrap align-items-center gap-3 mb-6">
        <div className="me-auto">{heading}</div>
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
  if (!actions) return <div className="d-flex justify-content-end gap-2 mb-4">{children}</div>;
  return createPortal(children, actions);
}
