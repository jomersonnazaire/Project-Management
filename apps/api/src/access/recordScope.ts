import { Types } from 'mongoose';
import {
  ClientContactModel,
  IssueModel,
  NotificationModel,
  ProjectModel,
  TaskModel,
  TimeEntryModel,
  UploadModel,
} from '../models/index.js';
import { clientInScope, isProjectMember, type ScopeUser } from '../services/scope.js';

/**
 * NFR-25 (DEF-005, DEF-006): the shared scope check of the central gate. For every route that
 * addresses a record by `/<collection>/:id…`, the gate asks here whether the record is inside the
 * caller's fixed scope BEFORE it checks the access rules or runs the handler. A record outside the
 * scope (or missing) answers 404 for every method (GET, PATCH, PUT, POST actions, DELETE), so its
 * existence never leaks; 403 stays for records the caller can see but lacks the action for.
 *
 * Resolvers return `true` (visible), `false` (outside scope or missing → 404). Collections with no
 * resolver (users, teams, templates, access rules) are not project-scoped and keep the rules only.
 */
type Resolver = (user: ScopeUser, id: Types.ObjectId) => Promise<boolean>;

const isMember = (user: ScopeUser) => user.systemRole === 'MEMBER';

async function projectVisible(user: ScopeUser, projectId: Types.ObjectId | null | undefined) {
  if (!projectId) return false;
  const project = await ProjectModel.findById(projectId, { managerId: 1, memberIds: 1 }).lean();
  if (!project) return false;
  return !isMember(user) || isProjectMember(user, project);
}

const owned = (doc: { userId?: Types.ObjectId | null } | null, user: ScopeUser) =>
  !!doc && !!doc.userId && doc.userId.equals(user._id);

const RESOLVERS: Record<string, Resolver> = {
  projects: (user, id) => projectVisible(user, id),
  tasks: async (user, id) => {
    const t = await TaskModel.findById(id, { projectId: 1 }).lean();
    return !!t && projectVisible(user, t.projectId);
  },
  issues: async (user, id) => {
    const i = await IssueModel.findById(id, { projectId: 1 }).lean();
    return !!i && projectVisible(user, i.projectId);
  },
  // Time entries, uploads and notifications belong to one person (FR-TIME-06, FR-DOC, FR-NOT).
  time: async (user, id) => owned(await TimeEntryModel.findById(id, { userId: 1 }).lean(), user),
  uploads: async (user, id) => owned(await UploadModel.findById(id, { userId: 1 }).lean(), user),
  notifications: async (user, id) =>
    owned(await NotificationModel.findById(id, { userId: 1 }).lean(), user),
  clients: (user, id) => clientInScope(user, id),
  contacts: async (user, id) => {
    const c = await ClientContactModel.findById(id, { clientId: 1 }).lean();
    return !!c && clientInScope(user, c.clientId);
  },
};

/** Collections whose `/:id` routes go through the shared scope check (used by the NFR-25 test). */
export const SCOPED_COLLECTIONS = Object.keys(RESOLVERS);

/**
 * `'hidden'` when `routePath` addresses a scoped record the user may not see, `'visible'` when it
 * may, `'n/a'` for routes without a scoped `:id` (or with a malformed id, left to the handler's
 * own validation).
 */
export async function recordScope(
  routePath: string,
  requestPath: string,
  user: ScopeUser,
): Promise<'hidden' | 'visible' | 'n/a'> {
  const [, collection, param] = routePath.split('/');
  if (param !== ':id' || !collection) return 'n/a';
  const resolver = RESOLVERS[collection];
  if (!resolver) return 'n/a';
  const raw = requestPath.split('/')[2] ?? '';
  if (!Types.ObjectId.isValid(raw) || String(new Types.ObjectId(raw)) !== raw.toLowerCase()) {
    return 'n/a';
  }
  return (await resolver(user, new Types.ObjectId(raw))) ? 'visible' : 'hidden';
}
