import {
  BOARD_COLUMNS,
  TASK_STATUS_LABELS,
  TASK_TRANSITIONS,
  effortSummary,
  formatHours,
  type ProjectDto,
  type TaskDto,
  type TaskStatus,
} from '@xc8/shared';
import { useState, type DragEvent } from 'react';
import { Button, Form } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useContactOptions, useProjectActivity, useProjectContact } from '../../api/projectHooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { EstAct, Estimate, TaskStatusBadge } from '../../components/ProjectBadges';
import { dateTime, initials, shortDate } from '../../lib/format';
import { moveLabel, useStatusMove } from './useStatusMove';

interface TabProps {
  project: ProjectDto;
  tasks: TaskDto[];
  onOpen: (id: string) => void;
}

function DueCell({ t }: { t: TaskDto }) {
  return (
    <span className={t.overdue ? 'text-danger' : undefined}>
      {shortDate(t.dueDate)}
      {t.overdue && <span className="d-block small">{t.daysLate}d late</span>}
    </span>
  );
}

/** Checklist: tasks grouped by phase (FR-TSK-11). */
export function ChecklistTab({ project, tasks, onOpen }: TabProps) {
  const phases = Array.from(new Set(tasks.map((t) => t.phase ?? 'Other tasks')));
  const summary = effortSummary(tasks);
  if (tasks.length === 0) {
    return (
      <EmptyState icon="bx-list-check" title="No tasks yet">
        {project.can.planTasks
          ? 'Add the first task with + Add task.'
          : 'Tasks will show here once the plan is ready.'}
      </EmptyState>
    );
  }
  return (
    <>
      <p className="small text-body-secondary">
        Estimated {formatHours(summary.estimatedHours)} across{' '}
        {tasks.length - summary.unestimatedCount} tasks ·{' '}
        <span data-testid="unestimated-count">{summary.unestimatedCount}</span> without an estimate
      </p>
      {phases.map((ph) => (
        <div key={ph} className="card mb-4">
          <div className="card-header py-3">
            <h3 className="h6 mb-0">{ph}</h3>
          </div>
          <div className="table-responsive">
            <table className="table table-stack-md mb-0">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Task</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Due</th>
                  <th scope="col">Est. / actual</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks
                  .filter((t) => (t.phase ?? 'Other tasks') === ph)
                  .map((t) => (
                    <tr key={t.id}>
                      <td data-label="#">{t.order}</td>
                      <td className="cell-primary">
                        <Button
                          variant="link"
                          className="p-0 text-start fw-medium"
                          onClick={() => onOpen(t.id)}
                        >
                          {t.name}
                        </Button>
                        {t.party === 'CLIENT' && (
                          <span className="badge bg-label-info ms-2">Client</span>
                        )}
                      </td>
                      <td data-label="Owner">{t.owner?.name ?? '–'}</td>
                      <td data-label="Due" className="text-nowrap">
                        <DueCell t={t} />
                      </td>
                      <td data-label="Est. / actual">
                        <EstAct est={t.estHours} act={t.actualHours} />
                      </td>
                      <td data-label="Status">
                        <TaskStatusBadge status={t.status} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Kanban board by status (FR-TSK-10). Cards can be dragged, and every card also has a "Move to…"
 * menu so the board works with a keyboard (NFR-15).
 */
export function BoardTab({ project, tasks, onOpen }: TabProps) {
  const [assignee, setAssignee] = useState('');
  const status = useStatusMove(project);
  const team = [project.manager, ...project.members].filter(
    (u, i, all): u is NonNullable<typeof u> =>
      Boolean(u) && all.findIndex((x) => x?.id === u!.id) === i,
  );
  const shown = assignee
    ? tasks.filter((t) => t.owner?.id === assignee || t.assignees.some((a) => a.id === assignee))
    : tasks;
  const drop = (e: DragEvent, to: TaskStatus) => {
    e.preventDefault();
    const t = tasks.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (t && t.status !== to && TASK_TRANSITIONS[t.status].includes(to) && t.can.status)
      status.move(t, to);
  };

  return (
    <>
      {status.element}
      <div className="d-flex align-items-center gap-3 mb-4">
        <Form.Select
          aria-label="Filter by assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          style={{ maxWidth: 240 }}
        >
          <option value="">Everyone</option>
          {team.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Form.Select>
        <span className="small text-body-secondary">Drag a card, or use its Move to… menu.</span>
      </div>
      <div className="board d-flex gap-4 overflow-auto pb-2">
        {BOARD_COLUMNS.map((col) => {
          const items = shown.filter((t) => t.status === col);
          return (
            <section
              key={col}
              className="board-column flex-shrink-0"
              style={{ width: 260 }}
              aria-label={`${TASK_STATUS_LABELS[col]} (${items.length})`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, col)}
            >
              <h3 className="h6 d-flex justify-content-between">
                {TASK_STATUS_LABELS[col]}
                <span className="badge bg-label-secondary">{items.length}</span>
              </h3>
              {items.map((t) => (
                <div
                  key={t.id}
                  className="card mb-3"
                  draggable={t.can.status && !project.archived}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                >
                  <div className="card-body p-3">
                    <Button
                      variant="link"
                      className="p-0 text-start fw-medium text-heading"
                      onClick={() => onOpen(t.id)}
                    >
                      #{t.order} {t.name}
                    </Button>
                    {t.phase && <div className="small text-body-secondary">{t.phase}</div>}
                    <div className="d-flex justify-content-between align-items-center mt-2 small">
                      <DueCell t={t} />
                      <Estimate hours={t.estHours} />
                      {t.owner && (
                        <span
                          className="avatar-initials"
                          title={t.owner.name}
                          aria-label={`Owner ${t.owner.name}`}
                        >
                          {initials(t.owner.name)}
                        </span>
                      )}
                    </div>
                    {t.can.status && !project.archived && TASK_TRANSITIONS[t.status].length > 0 && (
                      <Form.Select
                        size="sm"
                        className="mt-2"
                        aria-label={`Move ${t.name} to`}
                        value=""
                        onChange={(e) =>
                          e.target.value && status.move(t, e.target.value as TaskStatus)
                        }
                      >
                        <option value="">Move to…</option>
                        {TASK_TRANSITIONS[t.status].map((to) => (
                          <option key={to} value={to}>
                            {moveLabel(t, to)}
                          </option>
                        ))}
                      </Form.Select>
                    )}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

export function TeamTab({ project, tasks }: Omit<TabProps, 'onOpen'>) {
  const people = [
    ...(project.manager ? [{ ...project.manager, role: 'Project manager' }] : []),
    ...project.members
      .filter((m) => m.id !== project.manager?.id)
      .map((m) => ({ ...m, role: 'Member' })),
  ];
  return (
    <div className="card">
      <div className="table-responsive">
        <table className="table mb-0">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role on project</th>
              <th scope="col">Open tasks</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={p.active ? undefined : 'text-body-secondary'}>
                <td className="text-heading">
                  {p.name}
                  {!p.active && <span className="badge bg-label-secondary ms-2">Inactive</span>}
                </td>
                <td>{p.role}</td>
                <td>
                  {
                    tasks.filter(
                      (t) =>
                        !['COMPLETED', 'CANCELLED'].includes(t.status) &&
                        (t.owner?.id === p.id || t.assignees.some((a) => a.id === p.id)),
                    ).length
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {project.can.edit && !project.archived && (
        <p className="small text-body-secondary m-4 mt-3">Change the team with Edit project.</p>
      )}
    </div>
  );
}

/**
 * Active contacts (FR-PRJ-13): picked from this project's client only; inactive contacts stay
 * listed, greyed out.
 */
export function ContactsTab({ project }: { project: ProjectDto }) {
  const editable = project.can.edit && !project.archived;
  const options = useContactOptions(project.id, editable);
  const mutation = useProjectContact(project.id);
  const canCreateContact = useCan('contacts', 'create');
  const [pick, setPick] = useState('');
  const available = (options.data ?? []).filter((o) => !o.added);
  const clientContactsLink = `/clients/${project.clientId}/contacts`;

  return (
    <div className="card">
      <div className="card-body">
        <ErrorAlert error={mutation.error} action />
        {editable && available.length > 0 && (
          <div className="d-flex gap-2 mb-4" style={{ maxWidth: 480 }}>
            <Form.Select
              aria-label="Add a contact"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Add a contact from {project.clientName}…</option>
              {available.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.position ? ` · ${o.position}` : ''}
                </option>
              ))}
            </Form.Select>
            <Button
              disabled={!pick || mutation.isPending}
              onClick={() => mutation.mutate({ contactId: pick }, { onSuccess: () => setPick('') })}
            >
              Add
            </Button>
          </div>
        )}
        {project.activeContacts.length === 0 ? (
          <EmptyState
            icon="bx-phone"
            title="No active contacts"
            action={
              canCreateContact ? (
                <Link className="btn btn-outline-primary" to={clientContactsLink}>
                  Go to {project.clientName}’s contacts
                </Link>
              ) : undefined
            }
          >
            {editable && available.length > 0
              ? `Pick the people at ${project.clientName} this project works with.`
              : `${project.clientName} has no active contacts to add yet.`}
          </EmptyState>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Position</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  {editable && (
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {project.activeContacts.map((c) => (
                  <tr
                    key={c.id}
                    className={c.active ? undefined : 'text-body-secondary opacity-75'}
                    data-inactive={!c.active || undefined}
                  >
                    <td className={c.active ? 'text-heading' : undefined}>
                      {c.name}
                      {!c.active && <span className="badge bg-label-secondary ms-2">Inactive</span>}
                    </td>
                    <td>{c.position ?? '–'}</td>
                    <td className="text-break">{c.email ?? '–'}</td>
                    <td className="text-nowrap">{c.phone ?? '–'}</td>
                    {editable && (
                      <td className="text-end">
                        <Button
                          variant="link"
                          size="sm"
                          className="text-danger"
                          aria-label={`Remove ${c.name}`}
                          onClick={() => mutation.mutate({ contactId: c.id, remove: true })}
                        >
                          Remove
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityTab({ project }: { project: ProjectDto }) {
  const activity = useProjectActivity(project.id, true);
  return (
    <div className="card">
      <div className="card-body">
        <ErrorAlert error={activity.error} />
        {activity.isPending ? (
          <LoadingRows />
        ) : (activity.data ?? []).length === 0 ? (
          <EmptyState icon="bx-history" title="No activity yet" />
        ) : (
          <ul className="list-unstyled mb-0">
            {activity.data!.map((a) => (
              <li key={a.id} className="mb-3">
                <span className="text-heading">{a.actor?.name ?? 'System'}</span>{' '}
                {a.action.replace(/_/g, ' ')}
                {a.changes.length > 0 && ` (${a.changes.map((c) => c.field).join(', ')})`}
                {a.reason && <div className="small text-body-secondary">“{a.reason}”</div>}
                <div className="small text-body-secondary">{dateTime(a.at)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ComingSoonTab({ title }: { title: string }) {
  return (
    <EmptyState icon="bx-time" title={`${title} arrives in a later milestone`}>
      This tab is planned for Milestone 3.
    </EmptyState>
  );
}
