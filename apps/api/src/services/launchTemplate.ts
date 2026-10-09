import type { TemplateActivityDto } from '@xc8/shared';
import type { Logger } from 'pino';
import { TemplateModel } from '../models/index.js';

/**
 * Launch template (FR-TPL-09, Q-04, Q-06): "SAP B1 Implementation", the 10 blueprint activities of
 * doc 06 §4 in Rich's proposed order and dependencies, published as v1 with NO effort estimates
 * (estHours null, EC-58). Offsets and durations are placeholders (5 working days per activity,
 * starting when its predecessors finish) until the implementation team supplies them (Q-06).
 */
export const LAUNCH_TEMPLATE_KEY = 'sap-b1-implementation';
export const LAUNCH_TEMPLATE_NAME = 'SAP B1 Implementation';

type Act = Omit<
  TemplateActivityDto,
  'defaultTeamId' | 'taskType' | 'priority' | 'estHours' | 'isMilestone'
> &
  Partial<Pick<TemplateActivityDto, 'isMilestone'>>;

const P1 = 'p1';
const P2 = 'p2';
const P3 = 'p3';
const P4 = 'p4';

export const LAUNCH_TEMPLATE_PHASES = [
  { id: P1, name: 'Phase 1 – Data gathering' },
  { id: P2, name: 'Phase 2 – Configuration' },
  { id: P3, name: 'Phase 3 – UAT & Training' },
  { id: P4, name: 'Phase 4 – Go-live' },
];

const base = { mandatory: true, requiresApproval: false, durationDays: 5 } as const;

export const LAUNCH_TEMPLATE_ACTIVITIES: Act[] = [
  {
    ...base,
    id: 'a1',
    phaseId: P1,
    name: 'Data gathering',
    party: 'INTERNAL',
    defaultJobRole: 'CONSULTANT',
    deliverable: 'Completed data-gathering document',
    offsetDays: 0,
    dependsOn: [],
  },
  {
    ...base,
    id: 'a2',
    phaseId: P1,
    name: 'Submit master data template to client',
    party: 'INTERNAL',
    defaultJobRole: 'CONSULTANT',
    deliverable: 'Template sent to client',
    offsetDays: 5,
    dependsOn: ['a1'],
  },
  {
    ...base,
    id: 'a3',
    phaseId: P1,
    name: 'Client master data – Items',
    party: 'CLIENT',
    defaultJobRole: 'CONSULTANT',
    deliverable: 'Completed items template',
    offsetDays: 10,
    dependsOn: ['a2'],
  },
  {
    ...base,
    id: 'a4',
    phaseId: P1,
    name: 'Client master data – Business Partners',
    party: 'CLIENT',
    defaultJobRole: 'CONSULTANT',
    deliverable: 'Completed BP template',
    offsetDays: 10,
    dependsOn: ['a2'],
  },
  {
    ...base,
    id: 'a5',
    phaseId: P2,
    name: 'Validate imported master data',
    party: 'INTERNAL',
    defaultJobRole: 'TECHNICAL_DATA',
    deliverable: 'Validation results and exceptions',
    offsetDays: 15,
    dependsOn: ['a3', 'a4'],
  },
  {
    ...base,
    id: 'a6',
    phaseId: P2,
    name: 'Configure system and validate setup',
    party: 'INTERNAL',
    defaultJobRole: 'TECHNICAL_DATA',
    deliverable: 'Configuration evidence',
    offsetDays: 5,
    dependsOn: ['a1'],
  },
  {
    ...base,
    id: 'a7',
    phaseId: P3,
    name: 'User acceptance testing (UAT)',
    party: 'INTERNAL',
    defaultJobRole: 'QA_TESTER',
    deliverable: 'Test results and sign-off',
    offsetDays: 20,
    dependsOn: ['a5', 'a6'],
    requiresApproval: true,
  },
  {
    ...base,
    id: 'a8',
    phaseId: P3,
    name: 'End-user training',
    party: 'INTERNAL',
    defaultJobRole: 'CONSULTANT',
    deliverable: 'Training completion record',
    offsetDays: 25,
    dependsOn: ['a7'],
  },
  {
    ...base,
    id: 'a9',
    phaseId: P4,
    name: 'Cutover preparation',
    party: 'INTERNAL',
    defaultJobRole: 'PROJECT_MANAGER',
    deliverable: 'Approved cutover checklist',
    offsetDays: 25,
    dependsOn: ['a7'],
  },
  {
    ...base,
    id: 'a10',
    phaseId: P4,
    name: 'Go-live and post-implementation support',
    party: 'INTERNAL',
    defaultJobRole: 'SUPPORT',
    deliverable: 'Go-live approval and handover',
    offsetDays: 30,
    dependsOn: ['a8', 'a9'],
    requiresApproval: true,
    isMilestone: true,
  },
];

/**
 * Inserts the launch template once. Idempotent and safe to run concurrently: `$setOnInsert` on the
 * unique (templateKey, version) never overwrites it, and once any version of the key exists (for
 * example an Admin published v2 or archived it) nothing is touched. Runs on API start and in the seed.
 */
export async function ensureLaunchTemplate(logger?: Logger): Promise<boolean> {
  if (await TemplateModel.exists({ templateKey: LAUNCH_TEMPLATE_KEY })) return false;
  const res = await TemplateModel.updateOne(
    { templateKey: LAUNCH_TEMPLATE_KEY, version: 1 },
    {
      $setOnInsert: {
        templateKey: LAUNCH_TEMPLATE_KEY,
        version: 1,
        name: LAUNCH_TEMPLATE_NAME,
        type: 'SAP_B1',
        description:
          'Standard SAP Business One implementation (blueprint, doc 06 §4). Estimates, offsets and durations are placeholders until the implementation team supplies them (Q-06).',
        status: 'PUBLISHED',
        superseded: false,
        publishedAt: new Date(),
        phases: LAUNCH_TEMPLATE_PHASES,
        activities: LAUNCH_TEMPLATE_ACTIVITIES.map((a) => ({
          taskType: null,
          priority: 'MEDIUM',
          defaultTeamId: null,
          estHours: null,
          isMilestone: false,
          ...a,
        })),
        createdBy: null,
        updatedBy: null,
      },
    },
    { upsert: true },
  );
  const created = res.upsertedCount > 0;
  if (created) logger?.info('Seeded the SAP B1 Implementation launch template');
  return created;
}
