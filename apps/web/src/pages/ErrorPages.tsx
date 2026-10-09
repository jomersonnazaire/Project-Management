import { Link } from 'react-router-dom';

export function ForbiddenPage({ message }: { message?: string }) {
  return (
    <div className="card">
      <div className="card-body empty-state">
        <p className="big mb-3">403</p>
        <h5 className="mb-1">You don&apos;t have access to this page</h5>
        <p className="mb-4">{message ?? 'Ask an administrator if you need access.'}</p>
        <Link to="/my-tasks" className="btn btn-outline-secondary">
          Go to My tasks
        </Link>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="card">
      <div className="card-body empty-state">
        <p className="big mb-3">404</p>
        <h5 className="mb-1">We couldn&apos;t find that page</h5>
        <p className="mb-4">It may have been moved or archived.</p>
        <Link to="/my-tasks" className="btn btn-outline-secondary">
          Back to My tasks
        </Link>
      </div>
    </div>
  );
}
