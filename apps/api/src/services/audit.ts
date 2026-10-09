import type { Types } from 'mongoose';
import { ActivityLogModel } from '../models/index.js';

interface AuditInput {
  actorId: Types.ObjectId | string | null;
  entityType: string;
  entityId: Types.ObjectId | string;
  action: string;
  changes?: { field: string; old: unknown; new: unknown }[];
  reason?: string;
  projectId?: Types.ObjectId | string | null;
}

/** Appends an audit entry (FR-AUD-01). Entries are never edited or deleted (FR-AUD-03). */
export async function audit(input: AuditInput): Promise<void> {
  await ActivityLogModel.create({
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changes: input.changes ?? [],
    reason: input.reason ?? null,
    projectId: input.projectId ?? null,
  });
}
