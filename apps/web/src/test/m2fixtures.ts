import type { ProjectDto, SystemRole, TaskDto } from '@xc8/shared';
import { ACME, emptyDashboard, meBody } from './fixtures';
import { mockApi } from './utils';

/** Milestone 2 fixtures shared by the project and follow-up tests. */
export const PID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
export const ME_PM = 'me-PROJECT_MANAGER';

export const project = (over: Partial<ProjectDto> = {}): ProjectDto => ({
  id: PID,
  name: 'SAP B1 Rollout',
  clientId: ACME.id,
  clientName: ACME.name,
  managerId: ME_PM,
  managerName: 'Me PM',
  startDate: '2026-10-12',
  plannedEndDate: '2026-12-18',
  forecastEnd: '2026-12-18',
  scheduleVarianceDays: 0,
  progress: 10,
  status: 'ACTIVE',
  health: 'ON_TRACK',
  archived: false,
  templateName: 'SAP B1 Implementation',
  templateVersion: 1,
  taskCount: 2,
  unestimatedTaskCount: 1,
  description: null,
  type: 'SAP_B1',
  manager: { id: ME_PM, name: 'Me PM', active: true },
  members: [{ id: 'u2', name: 'Maria Member', active: true }],
  activeContacts: [],
  templateId: 't1',
  baselineHistory: [],
  can: {
    edit: true,
    archive: true,
    delete: false,
    planTasks: true,
    addMembers: true,
    activity: true,
  },
  ...over,
});

export const task = (over: Partial<TaskDto> = {}): TaskDto => ({
  id: 'k1',
  projectId: PID,
  order: 1,
  name: 'Kickoff',
  phase: 'Phase 1',
  taskType: null,
  priority: 'MEDIUM',
  mandatory: false,
  party: 'INTERNAL',
  teamId: null,
  owner: { id: 'u2', name: 'Maria Member', active: true },
  assignees: [],
  clientContact: null,
  plannedStart: '2026-10-12',
  dueDate: '2026-10-16',
  estHours: 8,
  actualHours: 0,
  status: 'TODO',
  previousStatus: null,
  dependsOn: [],
  deliverable: null,
  blockerReason: null,
  requiresApproval: false,
  reviewer: null,
  approval: { state: 'NONE', decidedBy: null, decidedAt: null, comment: null },
  evidence: [],
  followUps: [],
  isMilestone: false,
  overdue: false,
  daysLate: 0,
  version: 0,
  can: { edit: true, plan: true, status: true, approve: false },
  deletable: false,
  deleteBlockedReason: null,
  ...over,
});

export type Reply = { status: number; body?: unknown };
export type Route = (url: string, init?: RequestInit) => Reply | undefined;

export function api(role: SystemRole, route: Route = () => undefined) {
  return mockApi((url, init) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody(role) };
    const routed = route(url, init);
    if (routed) return routed;
    if (/\/api\/v1\/dashboard(\?|$)/.test(url)) return { status: 200, body: emptyDashboard() };
    return { status: 200, body: { items: [] } };
  });
}
