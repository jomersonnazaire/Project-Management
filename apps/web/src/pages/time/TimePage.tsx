import { TIME_TYPE_SHORT, toDateOnly } from '@xc8/shared';
import { useState } from 'react';
import { Button, ButtonGroup } from 'react-bootstrap';
import { useTimeMutation, useTimeWeek } from '../../api/m3Hooks';
import { useCan } from '../../auth/useCan';
import { ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { TimeEntryForm } from '../../components/TimeEntryForm';
import { hoursLabel, shortDate } from '../../lib/format';
import { TIME_TYPE_BADGE } from '../../lib/m3ui';
import { useConfirm } from '../../components/ConfirmModal';

const shift = (date: string, days: number) =>
  toDateOnly(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000));

/** Time logging (FR-TIME-01..06): my entries for one week, with the Log time form beside them. */
export function TimePage() {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const data = useTimeWeek(week);
  const remove = useTimeMutation();
  // Members delete their own entries (doc 11 §6 v0.6.8); the API returns 404 for anyone else's.
  const canDelete = useCan('time', 'delete');
  const [confirm, confirmDialog] = useConfirm();
  const w = data.data;
  const pct = w && w.capacity ? Math.round((w.total / w.capacity) * 100) : 0;

  return (
    <>
      <PageHeader title="Time logging">
        <ButtonGroup aria-label="Week">
          <Button
            variant="outline-secondary"
            aria-label="Previous week"
            disabled={!w}
            onClick={() => w && setWeek(shift(w.weekStart, -7))}
          >
            <i className="bx bx-chevron-left" aria-hidden="true" />
          </Button>
          <Button variant="outline-secondary" disabled>
            Week of {w ? shortDate(w.weekStart) : '…'}
          </Button>
          <Button
            variant="outline-secondary"
            aria-label="Next week"
            disabled={!w}
            onClick={() => w && setWeek(shift(w.weekStart, 7))}
          >
            <i className="bx bx-chevron-right" aria-hidden="true" />
          </Button>
        </ButtonGroup>
      </PageHeader>
      <div className="row g-6">
        <div className="col-lg-8">
          <div className="card">
            <div className="card-body">
              <h2 className="h5">My entries this week</h2>
              <ErrorAlert error={data.error} />
              <ErrorAlert error={remove.error} action />
              {data.isPending ? (
                <LoadingRows />
              ) : !w || w.items.length === 0 ? (
                <p className="text-body-secondary mb-0">No time logged this week.</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-stack-md">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Project</th>
                        <th scope="col">Task</th>
                        <th scope="col">Hours</th>
                        <th scope="col">Type</th>
                        <th scope="col">Notes</th>
                        <th scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {w.items.map((e) => (
                        <tr key={e.id}>
                          <td className="cell-primary text-nowrap">{shortDate(e.workDate)}</td>
                          <td data-label="Project">{e.project.name}</td>
                          <td data-label="Task">{e.task.name}</td>
                          <td data-label="Hours">{hoursLabel(e.hours)}</td>
                          <td data-label="Type">
                            <span className={`badge ${TIME_TYPE_BADGE[e.type]}`}>
                              {TIME_TYPE_SHORT[e.type]}
                            </span>
                          </td>
                          <td data-label="Notes">{e.notes ?? ''}</td>
                          <td className="text-end text-nowrap">
                            {e.locked ? (
                              <span
                                className="small text-body-secondary"
                                title={data.data?.lockDescription ?? 'Locked'}
                              >
                                🔒 Locked
                              </span>
                            ) : (
                              canDelete && (
                                <Button
                                  size="sm"
                                  variant="link"
                                  className="p-0 text-danger"
                                  aria-label={`Delete ${hoursLabel(e.hours)} on ${e.task.name}`}
                                  onClick={async () => {
                                    if (
                                      await confirm({
                                        title: 'Delete this time entry?',
                                        body: `${hoursLabel(e.hours)} on ${e.task.name}, ${shortDate(e.workDate, true)}. This can't be undone.`,
                                        confirmLabel: 'Delete entry',
                                        danger: true,
                                      })
                                    ) {
                                      remove.mutate({ id: e.id, method: 'DELETE' });
                                    }
                                  }}
                                >
                                  Delete
                                </Button>
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}>
                          <strong>Total</strong>
                        </td>
                        <td>
                          <strong>{hoursLabel(w.total)}</strong>
                        </td>
                        <td colSpan={3} className="small text-body-secondary">
                          of {hoursLabel(w.capacity)} available ({pct}% utilization)
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="small text-body-secondary mt-3 mb-0">
                {data.data?.lockDescription ??
                  "Last week's entries lock every Monday at 12:00 PM Philippine time."}{' '}
                Ask your project manager if a locked entry needs changing.
              </p>
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card">
            <div className="card-body">
              <h2 className="h5">Log time</h2>
              <TimeEntryForm />
            </div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </>
  );
}
