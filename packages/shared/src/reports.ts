import type { IssueSeverity, IssueStage } from './issues.js';
import type { Health, Party, ProjectStatus, Ref, TaskStatus, UserRefDto } from './projects.js';
import type { TimeType } from './m3.js';

/**
 * Milestone 4: dashboard (FR-DASH-01..06), My projects (doc 14 §6 FR-PMV-01..04), workload
 * (FR-WL-01..03), reports (FR-RPT-01..06) and issue reports (FR-ISS-16). Every number respects the
 * caller's project scope (FR-DASH-06): Members only see projects they belong to.
 */

export const HOURS_NOT_A_SCORE_NOTE =
  "Hours aren't used as a performance score. Waiting time and scope changes are shown separately.";
export const AI_INSIGHTS_PHASE2_NOTE =
  'AI insights arrive in Phase 2. Nothing here calls an AI service yet.';

export interface DashboardKpisDto {
  activeProjects: number;
  delayedProjects: number;
  overdueTasks: number;
  /** AC-20.2: the subset of overdue tasks waiting on the client. */
  overdueWaitingOnClient: number;
  hoursThisWeek: number;
  /** Team utilization this week: recorded working hours ÷ capacity × 100 (FR-WL-02); null with no capacity. */
  teamUtilizationPct: number | null;
}

export interface DashboardProjectDto {
  id: string;
  name: string;
  client: Ref;
  template: string | null;
  status: ProjectStatus;
  progress: number;
  health: Health;
  /** Go-live: the baseline end (FR-DASH-02). */
  goLive: string | null;
}

export interface WaitingTaskDto {
  id: string;
  name: string;
  project: Ref;
  client: Ref;
  contact: (Ref & { active: boolean }) | null;
  dueDate: string | null;
  /** > 0 days overdue, 0 due today, < 0 days until due; null without a due date. */
  daysOverdue: number | null;
}

export interface MilestoneDto {
  id: string;
  name: string;
  project: Ref;
  client: Ref;
  dueDate: string;
}

export interface IssueSummaryDto {
  open: number;
  overdue: number;
  bySeverity: Record<IssueSeverity, number>;
  byStage: Record<IssueStage, number>;
  /** Average days from raised to resolved over issues resolved in the window; null when none. */
  avgDaysToResolve: number | null;
  resolvedCount: number;
  perClient: { client: Ref; open: number; overdue: number }[];
}

export interface DashboardDto {
  kpis: DashboardKpisDto;
  activeProjects: DashboardProjectDto[];
  waitingOnClient: WaitingTaskDto[];
  upcomingMilestones: MilestoneDto[];
  issues: IssueSummaryDto;
  /** True when the caller gets the My projects view (FR-PMV-04). */
  myProjects: boolean;
}

// ---------- My projects (doc 14 FR-PMV-01..04) ----------
export interface FollowUpItemDto {
  kind: 'TASK' | 'DOCUMENT';
  id: string;
  name: string;
  dueDate: string | null;
  /** OVERDUE (past due) or AGING (FR-TSK-23: planned start passed, not started). */
  reason: 'OVERDUE' | 'AGING';
  /** Link target in the app. */
  href: string;
}
export interface FollowUpPersonDto {
  person: UserRefDto;
  overdue: number;
  aging: number;
  items: FollowUpItemDto[];
}
export interface FollowUpContactDto {
  contact: Ref & { active: boolean };
  overdueTasks: number;
  overdueDocuments: number;
  items: FollowUpItemDto[];
}
export interface MyProjectRowDto {
  id: string;
  name: string;
  client: Ref;
  manager: Ref | null;
  status: ProjectStatus;
  health: Health;
  progress: number;
  baselineEnd: string | null;
  forecastEnd: string | null;
  /** Forecast − baseline in days; > 0 is late ("N days late" in red). */
  daysLate: number;
  overdueTasks: number;
  blockedTasks: number;
  openIssues: number;
  openCriticalHighIssues: number;
  waitingOnClient: number;
  followUps: { people: FollowUpPersonDto[]; contacts: FollowUpContactDto[] };
}
export interface MyProjectsDto {
  items: MyProjectRowDto[];
}

// ---------- Workload (FR-WL-01..03) ----------
export interface WorkloadRowDto {
  person: UserRefDto;
  jobRole: string;
  teams: Ref[];
  capacityHours: number;
  /** Remaining estimates of open tasks they own that are due in the week. */
  assignedHours: number;
  /** Execution + rework hours recorded in the week. */
  recordedHours: number;
  /** Waiting on client / external, shown separately (FR-WL-03). */
  waitingHours: number;
  utilizationPct: number | null;
  assignedPct: number | null;
  overAssigned: boolean;
}
export interface WorkloadDto {
  weekStart: string;
  weekEnd: string;
  items: WorkloadRowDto[];
  note: string;
}

// ---------- Reports (FR-RPT-01..06) ----------
export interface EffortRowDto {
  id: string;
  name: string;
  project: Ref;
  client: Ref;
  owner: Ref | null;
  status: TaskStatus;
  estHours: number | null;
  actualHours: number;
  variance: number | null;
  overrunPct: number | null;
}
export interface OverdueRowDto {
  id: string;
  name: string;
  project: Ref;
  client: Ref;
  owner: Ref | null;
  party: Party;
  contact: Ref | null;
  status: TaskStatus;
  dueDate: string;
  daysOverdue: number;
}
export interface TimesheetRowDto {
  id: string;
  workDate: string;
  user: Ref;
  project: Ref;
  task: Ref;
  type: TimeType;
  hours: number;
  note: string | null;
}
export interface TimesheetReportDto {
  items: TimesheetRowDto[];
  totals: Record<TimeType, number> & { all: number };
}
export interface ProjectStatusRowDto {
  id: string;
  name: string;
  client: Ref;
  status: ProjectStatus;
  progress: number;
  health: Health;
  baselineEnd: string | null;
  forecastEnd: string | null;
  varianceDays: number;
  overdueTasks: number;
  blockedTasks: number;
  pendingClientItems: number;
}
export interface IssueReportRowDto {
  id: string;
  key: string;
  title: string;
  project: Ref;
  client: Ref;
  severity: IssueSeverity;
  stage: IssueStage;
  status: string;
  owner: Ref | null;
  dueDate: string | null;
  overdue: boolean;
  raisedAt: string;
  resolvedAt: string | null;
  daysToResolve: number | null;
}
export interface IssueReportDto {
  items: IssueReportRowDto[];
  summary: IssueSummaryDto;
}
/**
 * DR-43: the Project and Client filter options, built from the projects the caller's reports
 * cover (a Member sees only their projects' names and clients, without access to /clients).
 */
export interface ReportFilterOptionsDto {
  projects: Ref[];
  clients: Ref[];
}

export interface ReportList<T> {
  items: T[];
}

/** FR-RPT-01 / AC-22.1 in HH:MM (DR-25): "+04:00", "−02:00", "00:00"; null (no estimate) is "–". */
export function formatSignedHours(v: number | null): string {
  if (v === null) return '–';
  const m = Math.round(v * 60);
  if (m === 0) return '00:00';
  const a = Math.abs(m);
  const hhmm = `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  return `${m > 0 ? '+' : '−'}${hhmm}`;
}
/** AC-22.1: "+50%", "−12.5%", or "No estimate". */
export function formatOverrun(pct: number | null): string {
  if (pct === null) return 'No estimate';
  const r = Math.round(pct * 10) / 10;
  if (r === 0) return '0%';
  return `${r > 0 ? '+' : '−'}${Math.abs(r)}%`;
}
/** FR-WL-02: recorded ÷ capacity × 100, whole %; null without capacity. */
export function utilizationPct(hours: number, capacity: number): number | null {
  return capacity > 0 ? Math.round((hours / capacity) * 100) : null;
}
