import {
  HEALTH_LABELS,
  NO_ESTIMATE_LABEL,
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  TEMPLATE_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
  formatHours,
  projectBadge,
  scheduleVarianceLabel,
  type Health,
  type ProjectStatus,
  type TaskStatus,
  type TemplateStatus,
} from '@xc8/shared';

/** DR-27: project health on its own (On track / At risk / Delayed / On hold). */
const HEALTH_VARIANTS: Record<Health, string> = {
  ON_TRACK: 'success',
  AT_RISK: 'warning',
  DELAYED: 'danger',
  ON_HOLD: 'secondary',
};
export function HealthBadge({ health }: { health: Health }) {
  return (
    <span className={`badge bg-label-${HEALTH_VARIANTS[health]}`}>{HEALTH_LABELS[health]}</span>
  );
}
const STATUS_VARIANTS: Record<ProjectStatus, string> = {
  PLANNING: 'info',
  ACTIVE: 'primary',
  ON_HOLD: 'secondary',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
};
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`badge bg-label-${STATUS_VARIANTS[status]}`}>
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

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
        –<small className="d-block text-body-secondary no-estimate">{NO_ESTIMATE_LABEL}</small>
      </span>
    );
  }
  return <>{formatHours(hours)}</>;
}

/**
 * "Est / Act" cell with units ("4h / 6h"). A task with no estimate reads "– / –" on one line with
 * a small "No estimate" note beneath (DR-08, EC-58).
 */
export function EstAct({ est, act }: { est: number | null; act: number }) {
  return (
    <span className="est-act d-inline-block">
      <span className="text-nowrap">
        {formatHours(est)} / {act ? formatHours(act) : '–'}
      </span>
      {est === null && (
        <small className="d-block text-body-secondary no-estimate">{NO_ESTIMATE_LABEL}</small>
      )}
    </span>
  );
}

/** Forecast vs baseline end in words, coloured (DR-09). */
export function ScheduleVariance({ days }: { days: number }) {
  const v = scheduleVarianceLabel(days);
  return <span className={`small text-${v.variant}`}>{v.text}</span>;
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
