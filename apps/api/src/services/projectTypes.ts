import {
  DEFAULT_PROJECT_TYPES,
  projectTypeNameKey,
  type ProjectTypePreselectDto,
  type ProjectTypeRefDto,
} from '@xc8/shared';
import type { Logger } from 'pino';
import type { Types } from 'mongoose';
import { LookupModel, MigrationModel, ProjectTypeModel } from '../models/index.js';
import { ensureDefaultLookups } from './tracker.js';

type Id = Types.ObjectId;

export const PROJECT_TYPES_SEED_ID = 'project-types-seed-v1';

/**
 * Q-51 seed (doc 14 FR-PTY-01): the nine starting project types, each defaulting to the active
 * Activity type of the given name (blank when there is none). Runs once (migration marker), and
 * upserts by name, so a second run or a second instance never duplicates or overwrites a type,
 * and a type an Admin deleted later doesn't come back.
 */
export async function ensureDefaultProjectTypes(logger?: Logger): Promise<number> {
  if (await MigrationModel.exists({ _id: PROJECT_TYPES_SEED_ID })) return 0;
  // The defaults are matched by name, so the Activity types list must exist first.
  await ensureDefaultLookups();
  const activities = await LookupModel.find({ kind: 'ACTIVITY_TYPE', active: true })
    .select('nameKey')
    .lean();
  const byName = new Map(activities.map((a) => [a.nameKey, a._id]));
  const res = await ProjectTypeModel.bulkWrite(
    DEFAULT_PROJECT_TYPES.map(({ name, activity }) => ({
      updateOne: {
        filter: { nameKey: projectTypeNameKey(name) },
        update: {
          $setOnInsert: {
            name,
            nameKey: projectTypeNameKey(name),
            defaultActivityTypeId: byName.get(activity.toLowerCase()) ?? null,
            active: true,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  await MigrationModel.updateOne(
    { _id: PROJECT_TYPES_SEED_ID },
    {
      $setOnInsert: {
        kind: 'seed',
        status: 'DONE',
        startedAt: new Date(),
        finishedAt: new Date(),
        result: { seeded: res.upsertedCount },
      },
    },
    { upsert: true },
  ).catch(() => undefined);
  if (res.upsertedCount) logger?.info({ seeded: res.upsertedCount }, 'Seeded project types');
  return res.upsertedCount;
}

/** Current names for project screens, read by ID (FR-PTY-06: renames show live). */
export async function projectTypeRefs(
  ids: (Id | null | undefined)[],
): Promise<Map<string, ProjectTypeRefDto>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const docs = await ProjectTypeModel.find({ _id: { $in: unique } })
    .select('name active')
    .lean();
  return new Map(
    docs.map((d) => [
      d._id.toString(),
      { id: d._id.toString(), name: d.name, active: d.active !== false },
    ]),
  );
}

/**
 * FR-PTY-04: the Activity type Time in preselects on a project task. Nothing when the project
 * has no type, the type has no default, or the default Activity type is inactive (or gone).
 * An inactive project type still applies its default: the project keeps the type (FR-PTY-02).
 */
export async function preselectFor(project: {
  name: string;
  projectTypeId?: Id | null;
}): Promise<ProjectTypePreselectDto> {
  const out: ProjectTypePreselectDto = {
    projectName: project.name,
    projectType: null,
    activityType: null,
    inactiveDefault: null,
  };
  if (!project.projectTypeId) return out;
  const type = await ProjectTypeModel.findById(project.projectTypeId).lean();
  if (!type) return out;
  out.projectType = { id: type._id.toString(), name: type.name, active: type.active !== false };
  if (!type.defaultActivityTypeId) return out;
  const activity = await LookupModel.findOne({
    _id: type.defaultActivityTypeId,
    kind: 'ACTIVITY_TYPE',
  }).lean();
  if (!activity) return out;
  if (activity.active === false) out.inactiveDefault = activity.name;
  else out.activityType = { id: activity._id.toString(), name: activity.name };
  return out;
}
