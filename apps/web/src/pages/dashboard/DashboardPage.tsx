import { useDocumentRequests } from '../../api/m3Hooks';
import { DocumentRequestList } from '../../components/DocumentRequestList';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';

/**
 * Dashboard (mockup v0.7.4). This milestone builds the "Waiting on client" card for document
 * requests from client contacts (FR-DASH-03, FR-DOC-26, AC-26.4); the KPI, project and milestone
 * cards follow in the Reports milestone.
 */
export function DashboardPage() {
  const waiting = useDocumentRequests('waiting-on-client');
  const items = waiting.data?.items ?? [];
  const overdue = waiting.data?.overdue ?? 0;
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="row g-6 mb-6">
        <div className="col-sm-6 col-xl-3">
          <div className="card h-100">
            <div className="card-body">
              <p className="mb-1">Waiting on client</p>
              <h3 className="mb-0">{items.length}</h3>
              <small className="text-body-secondary">open document requests</small>
            </div>
          </div>
        </div>
        <div className="col-sm-6 col-xl-3">
          <div className="card h-100">
            <div className="card-body">
              <p className="mb-1">Overdue client requests</p>
              <h3 className={`mb-0 ${overdue ? 'text-danger' : ''}`}>{overdue}</h3>
              <small className="text-body-secondary">past their due date</small>
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-body">
          <h2 className="h5 mb-4">Waiting on client</h2>
          <ErrorAlert error={waiting.error} />
          {waiting.isPending ? (
            <LoadingRows />
          ) : items.length === 0 ? (
            <EmptyState icon="bx-check-circle" title="Nothing waiting on clients">
              Documents requested from client contacts show here until they arrive.
            </EmptyState>
          ) : (
            <DocumentRequestList items={items} showContact />
          )}
        </div>
      </div>
    </>
  );
}
