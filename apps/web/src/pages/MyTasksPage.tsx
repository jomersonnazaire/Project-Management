import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';

/**
 * Placeholder for FR-TSK-13 / AC-17.1. Projects and tasks arrive in a later milestone,
 * so every count is genuinely zero for now.
 */
export function MyTasksPage() {
  const { user } = useAuth();
  const kpis = [
    { label: 'Overdue', value: '0' },
    { label: 'Due this week', value: '0' },
    { label: 'Waiting for my review', value: '0' },
    {
      label: 'Logged this week',
      value: '0h',
      sub: `of ${user?.weeklyCapacityHours ?? 40}h available`,
    },
  ];
  return (
    <>
      <PageHeader title="My tasks" />
      <div className="row g-6 mb-6">
        {kpis.map((k) => (
          <div className="col-sm-6 col-xl-3" key={k.label}>
            <div className="card h-100">
              <div className="card-body">
                <p className="mb-1">{k.label}</p>
                <h3 className="mb-0">{k.value}</h3>
                {k.sub && <small className="text-body-secondary">{k.sub}</small>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-body">
          <EmptyState icon="bx-check" title="You're all caught up">
            No tasks are assigned to you right now. Tasks will appear here once projects are created
            from templates.
          </EmptyState>
        </div>
      </div>
    </>
  );
}
