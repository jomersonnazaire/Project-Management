import {
  NO_ESTIMATE_LABEL,
  TASK_STATUS_LABELS,
  TEMPLATE_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
  formatHours,
  projectBadge,
  type Health,
  type ProjectStatus,
  type TaskStatus,
  type TemplateStatus,
} from '@xc8/shared';

/** Badges always carry a text label; colour is never the only signal (NFR-15). */
export function ProjectBadge(p: {
  status: ProjectStatus;
  health?: Health | null;
  archived?: boolean;
}) {
  const b = projectBadge(p);
  return <span className={`badge bg-label-${b.variant} text-uppercase`}>{b.label}</span>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`badge bg-label-${TASK_STATUS_VARIANTS[status]} text-uppercase`}>
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div
        className="progress"
        style={{ height: 8 }}
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-bar" style={{ width: `${value}%` }} />
      </div>
      <span className="small text-body-secondary">{value}%</span>
    </div>
  );
}

/** Estimated hours; tasks without an estimate show "–" with a "No estimate" hint (EC-58). */
export function Estimate({ hours }: { hours: number | null }) {
  if (hours === null) {
    return (
      <span title={NO_ESTIMATE_LABEL}>
        –<span className="visually-hidden"> ({NO_ESTIMATE_LABEL})</span>
        <small className="d-block text-body-secondary no-estimate">{NO_ESTIMATE_LABEL}</small>
      </span>
    );
  }
  return <>{formatHours(hours)}</>;
}

/** "Est / Act" cell; variance only for tasks that have an estimate (EC-58). */
export function EstAct({ est, act }: { est: number | null; act: number }) {
  return (
    <span className="text-nowrap">
      {est === null ? <Estimate hours={null} /> : formatHours(est)} / {act ? formatHours(act) : '–'}
    </span>
  );
}

const TEMPLATE_STATUS_VARIANT: Record<TemplateStatus, string> = {
  DRAFT: 'warning',
  PUBLISHED: 'success',
  ARCHIVED: 'secondary',
};

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  return (
    <span className={`badge bg-label-${TEMPLATE_STATUS_VARIANT[status]} text-uppercase`}>
      {TEMPLATE_STATUS_LABELS[status]}
    </span>
  );
}
