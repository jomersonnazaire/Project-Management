import {
  toDateOnly,
  todayPH,
  type DocumentRequestListDto,
  type DocumentRequestRowDto,
} from '@xc8/shared';
import type { Request } from 'express';
import type { FilterQuery, Types } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { forbidden } from '../lib/errors.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  ClientModel,
  DocumentModel,
  FolderModel,
  ProjectModel,
  type DocumentRec,
} from '../models/index.js';
import { hiddenFolderIdsFor, partyFrom, resolveParties } from '../services/documentAccess.js';
import { userRefs } from '../services/projectService.js';
import { projectScopeFilter } from '../services/scope.js';

type Id = Types.ObjectId;
const DAY_MS = 86_400_000;
const MAX_ROWS = 200;

/**
 * Open document requests across projects (FR-DOC-26):
 *   - `/waiting-on-client`: requests from client contacts, for the Dashboard "Waiting on client"
 *     list (FR-DASH-03, AC-26.4), sorted by due date with overdue ones first.
 *   - `/mine`: requests from the signed-in user, shown in My tasks.
 * Both follow the caller's project scope and folder restrictions (FR-DOC-43).
 */
async function openRequests(
  req: Request,
  extra: FilterQuery<DocumentRec>,
): Promise<DocumentRequestListDto> {
  const user = currentUser(req);
  const projects = await ProjectModel.find({ ...projectScopeFilter(user), archived: { $ne: true } })
    .select('name clientId managerId memberIds')
    .lean();
  if (!projects.length) return { items: [], overdue: 0 };
  const docs = await DocumentModel.find({
    projectId: { $in: projects.map((p) => p._id) },
    status: 'REQUESTED',
    archived: { $ne: true },
    ...extra,
  })
    .sort({ dueDate: 1, name: 1 })
    .limit(MAX_ROWS * 2)
    .lean();
  if (!docs.length) return { items: [], overdue: 0 };
  const withDocs = projects.filter((p) => docs.some((d) => d.projectId.equals(p._id)));
  const hidden = await hiddenFolderIdsFor(user, withDocs);
  const visible = docs.filter((d) => !hidden.has(d.folderId.toString())).slice(0, MAX_ROWS);
  const [parties, users, folders, clients] = await Promise.all([
    resolveParties(visible.map((d) => d.requestedFrom)),
    userRefs(visible.map((d) => d.requestedBy)),
    FolderModel.find({ _id: { $in: visible.map((d) => d.folderId) } })
      .select('name')
      .lean(),
    ClientModel.find({ _id: { $in: withDocs.map((p) => p.clientId) } })
      .select('name')
      .lean(),
  ]);
  const projectById = new Map(projects.map((p) => [p._id.toString(), p]));
  const folderNames = new Map(folders.map((f) => [f._id.toString(), f.name]));
  const clientNames = new Map(clients.map((c) => [c._id.toString(), c.name]));
  const today = todayPH().getTime();
  const items: DocumentRequestRowDto[] = visible.map((d) => {
    const p = projectById.get(d.projectId.toString())!;
    const due = d.dueDate ?? new Date(today);
    const daysOverdue = Math.round((today - due.getTime()) / DAY_MS);
    const by = d.requestedBy ? users.get(d.requestedBy.toString()) : null;
    return {
      id: d._id.toString(),
      name: d.name,
      project: { id: p._id.toString(), name: p.name },
      client: { id: p.clientId.toString(), name: clientNames.get(p.clientId.toString()) ?? '' },
      folder: { id: d.folderId.toString(), name: folderNames.get(d.folderId.toString()) ?? '' },
      requestedFrom: partyFrom(parties, d.requestedFrom)!,
      requestedBy: by ? { id: by.id, name: by.name } : null,
      dueDate: toDateOnly(due),
      daysOverdue,
      overdue: daysOverdue > 0,
    };
  });
  // Overdue first (most overdue at the top), then by due date (mockup "Waiting on client").
  items.sort((a, b) => b.daysOverdue - a.daysOverdue || a.name.localeCompare(b.name));
  return { items, overdue: items.filter((i) => i.overdue).length };
}

export function documentRequestsRouter(registry: RouteRegistry) {
  const r = registry.router('/document-requests');

  r.get('/waiting-on-client', perm('reports', 'view'), async (req, res) => {
    if (!currentPermissions(req).documents.view) throw forbidden();
    res.json(await openRequests(req, { 'requestedFrom.kind': 'CONTACT' }));
  });

  r.get('/mine', perm('documents', 'view'), async (req, res) => {
    const me: Id = currentUser(req)._id;
    res.json(await openRequests(req, { 'requestedFrom.kind': 'USER', 'requestedFrom.id': me }));
  });

  return r.router;
}
