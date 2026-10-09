import { TASK_STATUS_LABELS, type ProjectDto, type TaskDto, type TaskStatus } from '@xc8/shared';
import { useState, type ReactNode } from 'react';
import { Alert } from 'react-bootstrap';
import { ApiError, saveErrorMessage } from '../../api/client';
import { useTaskMutation } from '../../api/projectHooks';
import { ReasonModal } from '../../components/ReasonModal';

/** Label of the action that moves a task to `to` (workflow §2). */
export function moveLabel(task: Pick<TaskDto, 'status' | 'requiresApproval'>, to: TaskStatus) {
  if (to === 'IN_PROGRESS') return task.status === 'COMPLETED' ? 'Reopen' : 'Start';
  if (to === 'BLOCKED') return 'Mark blocked';
  if (to === 'COMPLETED') return task.requiresApproval ? 'Submit for review' : 'Complete';
  if (to === 'CANCELLED') return 'Cancel task';
  return TASK_STATUS_LABELS[to];
}

interface Pending {
  task: TaskDto;
  to: TaskStatus;
  kind: 'reason' | 'override';
  intro?: string;
}

/**
 * Status changes shared by the board, the checklist and the task panel. Asks for the blocker,
 * cancel or reopen reason, and offers PMs an override when predecessors aren't done (FR-TSK-04).
 */
export function useStatusMove(project: Pick<ProjectDto, 'can'>) {
  const mutation = useTaskMutation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<unknown>(null);

  const send = (
    task: TaskDto,
    to: TaskStatus,
    extra: { reason?: string; overrideReason?: string } = {},
  ) => {
    setError(null);
    mutation.mutate(
      {
        path: `/tasks/${task.id}/status`,
        body: { status: to, version: task.version, ...extra },
      },
      {
        onSuccess: () => setPending(null),
        onError: (e) => {
          if (
            e instanceof ApiError &&
            e.code === 'PREDECESSOR_INCOMPLETE' &&
            project.can.planTasks &&
            !extra.overrideReason
          ) {
            setPending({ task, to, kind: 'override', intro: e.message });
            return;
          }
          setPending(null);
          setError(e);
        },
      },
    );
  };

  const needsReason = (task: TaskDto, to: TaskStatus) =>
    to === 'BLOCKED' || to === 'CANCELLED' || (task.status === 'COMPLETED' && to === 'IN_PROGRESS');

  const move = (task: TaskDto, to: TaskStatus) => {
    if (needsReason(task, to)) setPending({ task, to, kind: 'reason' });
    else send(task, to);
  };

  let modal: ReactNode = null;
  if (pending?.kind === 'reason') {
    const { task, to } = pending;
    modal = (
      <ReasonModal
        title={
          to === 'BLOCKED'
            ? 'Mark task blocked'
            : to === 'CANCELLED'
              ? 'Cancel task'
              : 'Reopen task'
        }
        label={to === 'BLOCKED' ? 'What is blocking it?' : 'Reason'}
        confirmLabel={moveLabel(task, to)}
        optional={to === 'CANCELLED' && !task.mandatory}
        intro={task.name}
        pending={mutation.isPending}
        onClose={() => setPending(null)}
        onSubmit={(reason) => send(task, to, { reason: reason || undefined })}
      />
    );
  } else if (pending?.kind === 'override') {
    const { task, to } = pending;
    modal = (
      <ReasonModal
        title="Override dependency"
        label="Override reason"
        confirmLabel="Override and continue"
        intro={pending.intro}
        pending={mutation.isPending}
        onClose={() => setPending(null)}
        onSubmit={(overrideReason) => send(task, to, { overrideReason })}
      />
    );
  }

  const element = (
    <>
      {error ? (
        <Alert variant="danger" dismissible onClose={() => setError(null)} role="alert">
          {saveErrorMessage(error, 'Could not change the status.')}
        </Alert>
      ) : null}
      {modal}
    </>
  );
  return { move, element, isPending: mutation.isPending };
}
