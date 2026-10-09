import type { ReactNode } from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { ApiError } from '../api/client';

export function FullPageSpinner() {
  return (
    <div
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh' }}
    >
      <Spinner animation="border" variant="primary" role="status">
        <span className="visually-hidden">Loading…</span>
      </Spinner>
    </div>
  );
}

/** Skeleton rows shown while lists load (mockup "Loading state"). */
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  const widths = ['60%', '100%', '80%', '90%', '70%'];
  return (
    <div aria-busy="true" aria-live="polite" className="py-2">
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ inlineSize: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = 'bx-check', title, children, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <i className={`bx ${icon} empty-icon mb-2`} aria-hidden="true" />
      <h5 className="mb-1">{title}</h5>
      {children && <p className="mb-3">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorAlert({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.status === 403
        ? "You don't have permission to do this."
        : error.message
      : 'Something went wrong. Please try again.';
  return (
    <Alert variant="danger" className={className} role="alert">
      {message}
    </Alert>
  );
}

export function LockNotice({ children }: { children: ReactNode }) {
  return (
    <div className="lock-notice" role="note">
      <span aria-hidden="true">🔒 </span>
      {children}
    </div>
  );
}
