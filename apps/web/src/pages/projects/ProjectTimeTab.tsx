import { TIME_TYPES, TIME_TYPE_SHORT, type ProjectDto } from '@xc8/shared';
import { useState } from 'react';
import { Button } from 'react-bootstrap';
import { useProjectTime } from '../../api/m3Hooks';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { LogTimeModal } from '../../components/LogTimeModal';
import { hoursLabel, shortDate } from '../../lib/format';
import { TIME_TYPE_BADGE } from '../../lib/m3ui';

/** Project Time tab (FR-TIME-05/07): PMs and Admins see everyone's entries, others their own. */
export function ProjectTimeTab({ project }: { project: ProjectDto }) {
  const time = useProjectTime(project.id);
  const [logging, setLogging] = useState(false);
  const d = time.data;
  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
          <div className="me-auto">
            <h2 className="h6 mb-0">
              {d?.scope === 'OWN' ? 'My time on this project' : 'Time logged'}
            </h2>
            {d && (
              <small className="text-body-secondary">
                {hoursLabel(d.total)} total ·{' '}
                {TIME_TYPES.map((t) => `${TIME_TYPE_SHORT[t]} ${hoursLabel(d.byType[t])}`).join(
                  ' · ',
                )}
              </small>
            )}
          </div>
          {!project.archived && (
            <Button size="sm" onClick={() => setLogging(true)}>
              Log time
            </Button>
          )}
        </div>
        <ErrorAlert error={time.error} />
        {time.isPending ? (
          <LoadingRows />
        ) : !d || d.items.length === 0 ? (
          <EmptyState icon="bx-time-five" title="No time logged yet">
            Time logged on this project's tasks shows here.
          </EmptyState>
        ) : (
          <div className="table-responsive">
            <table className="table table-stack-md">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Person</th>
                  <th scope="col">Task</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Type</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-primary text-nowrap">{shortDate(e.workDate)}</td>
                    <td data-label="Person">{e.user.name}</td>
                    <td data-label="Task">{e.task.name}</td>
                    <td data-label="Hours">{hoursLabel(e.hours)}</td>
                    <td data-label="Type">
                      <span className={`badge ${TIME_TYPE_BADGE[e.type]}`}>
                        {TIME_TYPE_SHORT[e.type]}
                      </span>
                    </td>
                    <td data-label="Notes">{e.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {logging && (
        <LogTimeModal preset={{ projectId: project.id }} onClose={() => setLogging(false)} />
      )}
    </div>
  );
}
