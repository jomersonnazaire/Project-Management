import type { ReactNode } from 'react';

/** White header card used at the top of every page in mockup v0.4. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card mb-6">
      <div className="card-body d-flex flex-wrap align-items-center gap-3 py-4">
        <h4 className="mb-0 me-auto">{title}</h4>
        {children}
      </div>
    </div>
  );
}
