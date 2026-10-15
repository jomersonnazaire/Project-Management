import type { ReactNode } from 'react';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { BrandLogo } from './BrandLogo';

// eslint-disable-next-line react-refresh/only-export-components -- tiny helper shared by auth pages
export function safeNext(next: string | null): string {
  // Only allow same-app relative paths (no open redirects).
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/** Sign-in, invite and reset screens: the brand on top, the page name in the browser tab. */
export function AuthCard({ title, children }: { title?: string; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="container-xxl">
      <div className="authentication-wrapper authentication-basic container-p-y">
        <div className="authentication-inner">
          <div className="card px-sm-6 px-0">
            <div className="card-body">
              <div className="app-brand justify-content-center mb-4">
                <BrandLogo />
              </div>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
