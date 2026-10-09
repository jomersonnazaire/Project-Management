import { JOB_ROLE_LABELS, type JobRole } from '@xc8/shared';
import { useMemo, useState } from 'react';
import { useTeams } from '../../api/hooks';
import { useCan } from '../../auth/useCan';
import { useWorkload } from '../../api/m4Hooks';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { hoursLabel, shortDate } from '../../lib/format';

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Pct({ value, over }: { value: number | null; over?: boolean }) {
  if (value === null) return <span className="text-body-secondary">–</span>;
  return <span className={over ? 'text-danger fw-medium' : ''}>{value}%</span>;
}

/** Team & workload (FR-WL-01..03, AC-21.1..21.3): one row per person for the selected week. */
export function WorkloadPage() {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [teamId, setTeamId] = useState('');
  const q = useWorkload(week, teamId || undefined);
  // DR-29: only people who can read teams ask for them; others get the list from the workload rows.
  const canTeams = useCan('teams', 'view');
  const teams = useTeams(false, canTeams);
  const d = q.data;
  const [seenTeams, setSeenTeams] = useState<Map<string, string>>(new Map());
  const rowTeams = useMemo(() => {
    const m = new Map(seenTeams);
    for (const r of d?.items ?? []) for (const t of r.teams) m.set(t.id, t.name);
    return m;
  }, [d, seenTeams]);
  if (rowTeams.size !== seenTeams.size) setSeenTeams(rowTeams);
  const teamOptions = canTeams
    ? (teams.data?.items ?? []).map((t) => ({ id: t.id, name: t.name }))
    : [...rowTeams]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
  const start = d?.weekStart;
  return (
    <>
      <PageHeader title="Team & workload" />
      <div className="card">
        <div className="card-header d-flex flex-wrap gap-2 align-items-center">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            aria-label="Previous week"
            disabled={!start}
            onClick={() => start && setWeek(addDays(start, -7))}
          >
            <i className="bx bx-chevron-left" aria-hidden="true" />
          </button>
          <span className="fw-medium" aria-live="polite">
            {d ? `Week of ${shortDate(d.weekStart, true)} – ${shortDate(d.weekEnd, true)}` : '…'}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            aria-label="Next week"
            disabled={!start}
            onClick={() => start && setWeek(addDays(start, 7))}
          >
            <i className="bx bx-chevron-right" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-link"
            onClick={() => setWeek(undefined)}
            disabled={!week}
          >
            This week
          </button>
          {teamOptions.length > 1 && (
            <select
              className="form-select form-select-sm w-auto ms-auto"
              aria-label="Team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">All teams</option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="card-body">
          <ErrorAlert error={q.error} />
          {q.isPending ? (
            <LoadingRows />
          ) : !d || d.items.length === 0 ? (
            <EmptyState icon="bx-group" title="No one to show">
              Active team members show here.
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Team</th>
                    <th className="text-end">Capacity</th>
                    <th className="text-end">Assigned</th>
                    <th className="text-end">Assigned %</th>
                    <th className="text-end">Recorded</th>
                    <th className="text-end">Utilization</th>
                    <th className="text-end">Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((r) => (
                    <tr key={r.person.id}>
                      <td>
                        <div className="fw-medium">{r.person.name}</div>
                        <div className="small text-body-secondary">
                          {JOB_ROLE_LABELS[r.jobRole as JobRole] ?? r.jobRole}
                        </div>
                      </td>
                      <td className="small">{r.teams.map((t) => t.name).join(', ') || '–'}</td>
                      <td className="text-end">{hoursLabel(r.capacityHours)}</td>
                      <td className="text-end">{hoursLabel(r.assignedHours)}</td>
                      <td className="text-end">
                        <Pct value={r.assignedPct} over={r.overAssigned} />
                        {r.overAssigned && (
                          <span className="badge bg-label-danger ms-2">Over capacity</span>
                        )}
                      </td>
                      <td className="text-end">{hoursLabel(r.recordedHours)}</td>
                      <td className="text-end">
                        <Pct value={r.utilizationPct} />
                      </td>
                      <td className="text-end text-body-secondary">{hoursLabel(r.waitingHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d && <p className="small text-body-secondary mt-3 mb-0">{d.note}</p>}
        </div>
      </div>
    </>
  );
}
