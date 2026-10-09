import type { ReactNode } from 'react';

// eslint-disable-next-line react-refresh/only-export-components -- tiny helper shared by auth pages
export function safeNext(next: string | null): string {
  // Only allow same-app relative paths (no open redirects).
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="container-xxl">
      <div className="authentication-wrapper authentication-basic container-p-y">
        <div className="authentication-inner">
          <div className="card px-sm-6 px-0">
            <div className="card-body">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
