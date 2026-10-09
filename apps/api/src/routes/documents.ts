import {
  DOWNLOAD_LINK_MINUTES,
  MAX_UPLOAD_BYTES,
  archiveDocumentSchema,
  checkFileRules,
  documentListQuerySchema,
  documentUploadSchema,
  evidenceUploadSchema,
  fileExtension,
  folderSchema,
  malwareMessage,
  notRealTypeMessage,
  renameFolderSchema,
  updateDocumentSchema,
  type DocumentDto,
  type DocumentListDto,
  type DocumentStatus,
  type FileKind,
  type FolderDto,
  type UploadPurpose,
  type UploadTicketDto,
} from '@xc8/shared';
import express, { type Request } from 'express';
import { Types } from 'mongoose';
import { AUTHENTICATED, perm, type RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { unprocessable } from '../lib/http422.js';
import { idParam, parseBody, parseQuery, escapeRegex } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  DocumentModel,
  FolderModel,
  ProjectModel,
  TaskModel,
  UploadModel,
  type DocumentRec,
  type Folder,
  type Project,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';
import { userRefs } from '../services/projectService.js';
import { canEditProjectScope, isPlanner, type ScopeUser } from '../services/scope.js';
import type { BlobStore } from '../storage/blobStore.js';
import { MemoryBlobStore } from '../storage/blobStore.js';
import { detectFileType, malwareVerdict, sha256Hex } from '../storage/fileCheck.js';
import { assertNotArchived, loadProject } from './projects.js';
import { assertCan, loadTask, respondTask, type TaskDoc } from './tasks.js';

/**
 * Documents (doc 10) and task evidence uploads (doc 12 §3.2). Files never pass through the API:
 *   1. the API checks name, type and size and issues a short-lived write-only upload link;
 *   2. the browser PUTs the file straight to the private Azure Blob container;
 *   3. the API reads the stored bytes, scans them (Q-29), checks the real type (FR-EVD-02), and
 *      only then records the document (EC-59: nothing half-saved; a failed check deletes the blob).
 * Downloads are links that expire within 5 minutes (FR-DOC-41), issued after the same access
 * checks as viewing the project, and only for a document of THAT project (TC-N07).
 */
type Id = Types.ObjectId;
type ProjectDoc = Project & { _id: Id };
type FolderDoc = Folder & { _id: Id };
type DocDoc = DocumentRec & { _id: Id; updatedAt?: Date };

const MAX_FOLDER_DEPTH = 3;

function requireStore(store: BlobStore | null): BlobStore {
  if (!store) {
    throw new HttpError(
      503,
      'STORAGE_NOT_CONFIGURED',
      'File storage isn’t set up yet. Ask an Admin.',
    );
  }
  return store;
}

const nameKey = (s: string) => s.trim().toLowerCase();

/** Who may write documents on a project (doc 10 §5): Admin, the managing PM, Members on it. */
function canWriteDocs(
  user: ScopeUser,
  perms: ReturnType<typeof currentPermissions>,
  p: ProjectDoc,
) {
  return !p.archived && perms.documents.create && canEditProjectScope(user, p);
}
const canArchiveDocs = (
  user: ScopeUser,
  perms: ReturnType<typeof currentPermissions>,
  p: ProjectDoc,
) => !p.archived && perms.documents.edit && isPlanner(user, p);

/** Contracts plus one folder per task phase, created on first use (FR-DOC-01, FR-DOC-17). */
export async function ensureDefaultFolders(project: ProjectDoc): Promise<void> {
  const phases = (await TaskModel.distinct('phase', { projectId: project._id })).filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  const tasks = await TaskModel.find({ projectId: project._id })
    .select('phase order')
    .sort({ order: 1 })
    .lean();
  const ordered = [...new Set(tasks.map((t) => t.phase).filter((p): p is string => Boolean(p)))];
  const wanted: {
    name: string;
    kind: 'CONTRACTS' | 'PHASE';
    phase: string | null;
    order: number;
  }[] = [
    { name: 'Contracts', kind: 'CONTRACTS', phase: null, order: 0 },
    ...ordered
      .filter((p) => phases.includes(p))
      .map((p, i) => ({ name: p, kind: 'PHASE' as const, phase: p, order: i + 1 })),
  ];
  for (const w of wanted) {
    const filter =
      w.kind === 'CONTRACTS'
        ? { projectId: project._id, kind: 'CONTRACTS' }
        : { projectId: project._id, kind: 'PHASE', phase: w.phase };
    if (await FolderModel.exists(filter)) continue;
    // If a custom folder already uses the name, keep it and suffix the default one.
    let name = w.name;
    for (
      let n = 2;
      await FolderModel.exists({ projectId: project._id, parentId: null, nameKey: nameKey(name) });
      n++
    ) {
      name = `${w.name} (${n})`;
    }
    await FolderModel.create({
      projectId: project._id,
      name,
      nameKey: nameKey(name),
      parentId: null,
      kind: w.kind,
      phase: w.phase,
      order: w.order,
    }).catch((e: { code?: number }) => {
      if (e.code !== 11000) throw e; // created concurrently
    });
  }
}

/** The task's phase folder (FR-DOC-17); tasks without a phase use "Task evidence". */
async function evidenceFolder(project: ProjectDoc, phase: string | null): Promise<FolderDoc> {
  await ensureDefaultFolders(project);
  if (phase) {
    const f = await FolderModel.findOne({ projectId: project._id, kind: 'PHASE', phase }).lean();
    if (f) return f as FolderDoc;
  }
  const name = 'Task evidence';
  const existing = await FolderModel.findOne({
    projectId: project._id,
    parentId: null,
    nameKey: nameKey(name),
  }).lean();
  if (existing) return existing as FolderDoc;
  return (
    await FolderModel.create({
      projectId: project._id,
      name,
      nameKey: nameKey(name),
      kind: 'PHASE',
      phase: null,
      order: 99,
    })
  ).toObject() as FolderDoc;
}

async function folderDepth(folder: FolderDoc): Promise<number> {
  let depth = 1;
  let parent = folder.parentId;
  while (parent && depth <= MAX_FOLDER_DEPTH + 1) {
    const p = await FolderModel.findById(parent).select('parentId').lean();
    if (!p) break;
    depth += 1;
    parent = p.parentId;
  }
  return depth;
}

async function toDocDtos(
  req: Request,
  project: ProjectDoc,
  docs: DocDoc[],
): Promise<DocumentDto[]> {
  const user = currentUser(req);
  const perms = currentPermissions(req);
  const users = await userRefs(
    docs.flatMap((d) => [
      ...d.versions.map((v) => v.uploadedBy),
      ...d.events.map((e) => e.actorId),
    ]),
  );
  const tasks = await TaskModel.find({ _id: { $in: docs.map((d) => d.taskId).filter(Boolean) } })
    .select('name')
    .lean();
  const taskNames = new Map(tasks.map((t) => [t._id.toString(), t.name]));
  const ref = (id?: Id | null) => {
    const u = id ? users.get(id.toString()) : null;
    return u ? { id: u.id, name: u.name } : null;
  };
  const write = canWriteDocs(user, perms, project);
  const archive = canArchiveDocs(user, perms, project);
  return docs.map((d) => {
    const latest = d.versions[d.versions.length - 1]!;
    return {
      id: d._id.toString(),
      projectId: d.projectId.toString(),
      folderId: d.folderId.toString(),
      name: d.name,
      kind: d.kind as FileKind,
      status: d.status as DocumentStatus,
      signedVersion: d.signedVersion ?? null,
      latestVersion: latest?.version ?? 0,
      task: d.taskId
        ? { id: d.taskId.toString(), name: taskNames.get(d.taskId.toString()) ?? '' }
        : null,
      source: d.source as 'DOCUMENT' | 'EVIDENCE',
      archived: Boolean(d.archived),
      archivedReason: d.archivedReason ?? null,
      updatedAt: (d.updatedAt ?? latest?.uploadedAt ?? new Date()).toISOString(),
      uploadedBy: ref(latest?.uploadedBy),
      versions: d.versions.map((v) => ({
        version: v.version,
        fileName: v.fileName,
        size: v.size,
        mimeType: v.mimeType,
        sha256: v.sha256,
        status: v.status as DocumentStatus,
        uploadedBy: ref(v.uploadedBy),
        uploadedAt: (v.uploadedAt ?? new Date()).toISOString(),
        note: v.note ?? null,
      })),
      events: d.events.map((e) => ({
        event: e.event ?? '',
        actor: ref(e.actorId),
        at: (e.at ?? new Date()).toISOString(),
        version: e.version ?? null,
        note: e.note ?? null,
      })),
      can: {
        upload: write && !d.archived,
        // Signed documents are locked (FR-DOC-30): no metadata changes.
        edit: write && !d.archived && d.status !== 'SIGNED' && d.signedVersion == null,
        archive,
      },
    };
  });
}

/** "Report (2).pdf" for "Keep both" (FR-DOC-12) and same-name evidence (EC-60). */
async function freeName(projectId: Id, folderId: Id, name: string): Promise<string> {
  const ext = fileExtension(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  let candidate = name;
  for (
    let n = 2;
    await DocumentModel.exists({ projectId, folderId, nameKey: nameKey(candidate) });
    n++
  ) {
    candidate = `${base} (${n})${ext ? `.${ext}` : ''}`;
  }
  return candidate;
}

function fileIssue(file: { name: string; size: number }, purpose: UploadPurpose) {
  const issue = checkFileRules(file, purpose);
  if (issue)
    throw new HttpError(issue.status, issue.code, issue.message, [
      { path: 'file', message: issue.message, name: file.name },
    ]);
}

export function documentsRouter(
  config: AppConfig,
  registry: RouteRegistry,
  store: BlobStore | null,
) {
  const p = registry.router('/projects');

  async function ticket(
    req: Request,
    project: ProjectDoc,
    purpose: UploadPurpose,
    file: { name: string; size: number },
    extra: Record<string, unknown>,
  ): Promise<UploadTicketDto> {
    const s = requireStore(store);
    const _id = new Types.ObjectId();
    const blobKey = `projects/${project._id.toString()}/${_id.toString()}`;
    const expiresAt = new Date(Date.now() + config.UPLOAD_LINK_MINUTES * 60_000);
    await UploadModel.create({
      _id,
      userId: currentUser(req)._id,
      projectId: project._id,
      purpose,
      fileName: file.name,
      declaredSize: file.size,
      blobKey,
      expiresAt,
      ...extra,
    });
    const { url, headers } = await s.uploadUrl(blobKey, config.UPLOAD_LINK_MINUTES);
    return {
      id: _id.toString(),
      name: file.name,
      uploadUrl: url,
      headers,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ----- Folders (FR-DOC-01..05) -----
  p.get('/:id/folders', perm('documents', 'view'), async (req, res) => {
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    await ensureDefaultFolders(project);
    const folders = (await FolderModel.find({ projectId: project._id })
      .sort({ order: 1, name: 1 })
      .lean()) as FolderDoc[];
    const counts = await DocumentModel.aggregate<{ _id: Id; n: number }>([
      { $match: { projectId: project._id, archived: { $ne: true } } },
      { $group: { _id: '$folderId', n: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.n]));
    const byId = new Map(folders.map((f) => [f._id.toString(), f]));
    const depth = (f: FolderDoc) => {
      let d = 0;
      let cur: FolderDoc | undefined = f;
      while (cur?.parentId && d < 5) {
        cur = byId.get(cur.parentId.toString());
        d += 1;
      }
      return d;
    };
    // Depth-first order so sub-folders sit under their parent.
    const out: FolderDto[] = [];
    const visit = (parent: string | null) => {
      for (const f of folders.filter((x) => (x.parentId?.toString() ?? null) === parent)) {
        out.push({
          id: f._id.toString(),
          name: f.name,
          parentId: f.parentId?.toString() ?? null,
          kind: f.kind as FolderDto['kind'],
          depth: depth(f),
          documentCount: countMap.get(f._id.toString()) ?? 0,
        });
        visit(f._id.toString());
      }
    };
    visit(null);
    const user = currentUser(req);
    const perms = currentPermissions(req);
    res.json({
      items: out,
      can: {
        createFolder: canWriteDocs(user, perms, project),
        renameDefault: canArchiveDocs(user, perms, project),
      },
    });
  });

  p.post('/:id/folders', perm('documents', 'create'), async (req, res) => {
    const input = parseBody(folderSchema, req);
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    assertNotArchived(project);
    if (!canWriteDocs(currentUser(req), currentPermissions(req), project)) throw forbidden();
    let parentId: Id | null = null;
    if (input.parentId) {
      const parent = (await FolderModel.findOne({
        _id: input.parentId,
        projectId: project._id,
      }).lean()) as FolderDoc | null;
      if (!parent) throw badRequest('Unknown parent folder.');
      if ((await folderDepth(parent)) >= MAX_FOLDER_DEPTH) {
        throw unprocessable('Folders can be nested up to 3 levels.', 'FOLDER_TOO_DEEP');
      }
      parentId = parent._id;
    }
    if (
      await FolderModel.exists({ projectId: project._id, parentId, nameKey: nameKey(input.name) })
    ) {
      throw conflict('A folder with that name already exists here.', 'DUPLICATE_FOLDER');
    }
    const f = await FolderModel.create({
      projectId: project._id,
      name: input.name,
      nameKey: nameKey(input.name),
      parentId,
      kind: 'CUSTOM',
      order: 100,
    });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'folder',
      entityId: f._id,
      projectId: project._id,
      action: 'folder_created',
      changes: [{ field: 'name', old: null, new: input.name }],
    });
    res.status(201).json({ folder: { id: f._id.toString(), name: f.name } });
  });

  p.patch('/:id/folders/:folderId', perm('documents', 'edit'), async (req, res) => {
    const input = parseBody(renameFolderSchema, req);
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    assertNotArchived(project);
    const folder = await FolderModel.findOne({
      _id: idParam(req, 'folderId'),
      projectId: project._id,
    });
    if (!folder) throw notFound();
    const user = currentUser(req);
    const perms = currentPermissions(req);
    // FR-DOC-04: default folders are renamed by the PM (or Admin) only.
    const allowed =
      folder.kind === 'CUSTOM'
        ? canWriteDocs(user, perms, project)
        : canArchiveDocs(user, perms, project);
    if (!allowed) throw forbidden();
    if (
      await FolderModel.exists({
        projectId: project._id,
        parentId: folder.parentId,
        nameKey: nameKey(input.name),
        _id: { $ne: folder._id },
      })
    ) {
      throw conflict('A folder with that name already exists here.', 'DUPLICATE_FOLDER');
    }
    const old = folder.name;
    folder.name = input.name;
    folder.nameKey = nameKey(input.name);
    await folder.save();
    await audit({
      actorId: user._id,
      entityType: 'folder',
      entityId: folder._id,
      projectId: project._id,
      action: 'folder_renamed',
      changes: [{ field: 'name', old, new: input.name }],
    });
    res.json({ folder: { id: folder._id.toString(), name: folder.name } });
  });

  p.delete('/:id/folders/:folderId', perm('documents', 'delete'), async (req, res) => {
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    assertNotArchived(project);
    if (!canWriteDocs(currentUser(req), currentPermissions(req), project)) throw forbidden();
    const folder = await FolderModel.findOne({
      _id: idParam(req, 'folderId'),
      projectId: project._id,
    });
    if (!folder) throw notFound();
    if (folder.kind !== 'CUSTOM')
      throw unprocessable("Default folders can't be deleted.", 'DEFAULT_FOLDER');
    if (
      (await DocumentModel.exists({ folderId: folder._id })) ||
      (await FolderModel.exists({ parentId: folder._id }))
    ) {
      throw unprocessable('Only empty folders can be deleted.', 'FOLDER_NOT_EMPTY');
    }
    await folder.deleteOne();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'folder',
      entityId: folder._id,
      projectId: project._id,
      action: 'folder_deleted',
      changes: [{ field: 'name', old: folder.name, new: null }],
    });
    res.status(204).end();
  });

  // ----- Documents (FR-DOC-10..33) -----
  p.get('/:id/documents', perm('documents', 'view'), async (req, res) => {
    const q = parseQuery(documentListQuerySchema, req);
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    const base: Record<string, unknown> = {
      projectId: project._id,
      archived: q.archived === 'true' ? true : { $ne: true },
    };
    if (q.folderId) base.folderId = new Types.ObjectId(q.folderId);
    if (q.q) base.name = new RegExp(escapeRegex(q.q), 'i');
    const all = (await DocumentModel.find(base)
      .sort({ updatedAt: -1 })
      .limit(1000)
      .lean()) as DocDoc[];
    const list = q.status ? all.filter((d) => d.status === q.status) : all;
    const user = currentUser(req);
    const perms = currentPermissions(req);
    const body: DocumentListDto = {
      items: await toDocDtos(req, project, list),
      counts: {
        all: all.length,
        SUBMITTED: all.filter((d) => d.status === 'SUBMITTED').length,
        SIGNED: all.filter((d) => d.status === 'SIGNED').length,
      },
      can: {
        upload: canWriteDocs(user, perms, project),
        createFolder: canWriteDocs(user, perms, project),
        archive: canArchiveDocs(user, perms, project),
      },
    };
    res.json(body);
  });

  async function loadDoc(req: Request, project: ProjectDoc) {
    // Always scoped to THIS project: an id from another project is simply not found (TC-N07).
    const doc = await DocumentModel.findOne({ _id: idParam(req, 'docId'), projectId: project._id });
    if (!doc) throw notFound();
    return doc;
  }

  p.get('/:id/documents/:docId', perm('documents', 'view'), async (req, res) => {
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    const doc = await loadDoc(req, project);
    const [dto] = await toDocDtos(req, project, [doc.toObject() as DocDoc]);
    res.json({ document: dto });
  });

  p.post('/:id/documents/uploads', perm('documents', 'create'), async (req, res) => {
    const input = parseBody(documentUploadSchema, req);
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    assertNotArchived(project);
    if (!canWriteDocs(currentUser(req), currentPermissions(req), project)) throw forbidden();
    const folder = await FolderModel.exists({ _id: input.folderId, projectId: project._id });
    if (!folder) throw badRequest('Unknown folder.', undefined, 'UNKNOWN_FOLDER');
    if (input.taskId && !(await TaskModel.exists({ _id: input.taskId, projectId: project._id }))) {
      throw badRequest('Linked task must be in this project.', undefined, 'INVALID_TASK');
    }
    fileIssue(input.file, 'DOCUMENT');
    const t = await ticket(req, project, 'DOCUMENT', input.file, {
      folderId: input.folderId,
      taskId: input.taskId ?? null,
      status: input.status,
      onDuplicate: input.onDuplicate,
      note: input.note || null,
    });
    res.status(201).json({ upload: t });
  });

  async function downloadLink(project: ProjectDoc, doc: DocDoc, version?: number) {
    const s = requireStore(store);
    const v = version
      ? doc.versions.find((x) => x.version === version)
      : doc.versions[doc.versions.length - 1];
    if (!v) throw notFound();
    const info = await s.info(v.blobKey);
    if (!info) throw notFound('This file is no longer available.');
    // Defender for Storage may tag a blob as malicious after upload (Q-29): never hand it out.
    if (malwareVerdict(null, info.tags)) {
      throw unprocessable(
        'This file was flagged by the malware scan and can’t be downloaded.',
        'MALWARE_DETECTED',
      );
    }
    const url = await s.downloadUrl(v.blobKey, DOWNLOAD_LINK_MINUTES, v.fileName, v.mimeType);
    return {
      url,
      fileName: v.fileName,
      expiresAt: new Date(Date.now() + DOWNLOAD_LINK_MINUTES * 60_000).toISOString(),
      projectId: project._id.toString(),
    };
  }

  p.get('/:id/documents/:docId/download', perm('documents', 'view'), async (req, res) => {
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    const doc = (await loadDoc(req, project)).toObject() as DocDoc;
    const v = req.query.version ? Number(req.query.version) : undefined;
    if (v !== undefined && !Number.isInteger(v)) throw badRequest('Invalid version.');
    res.json(await downloadLink(project, doc, v));
  });

  p.patch('/:id/documents/:docId', perm('documents', 'edit'), async (req, res) => {
    const input = parseBody(updateDocumentSchema, req);
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    assertNotArchived(project);
    if (!canWriteDocs(currentUser(req), currentPermissions(req), project)) throw forbidden();
    const doc = await loadDoc(req, project);
    if (doc.status === 'SIGNED' || doc.signedVersion != null) {
      throw conflict(
        'Signed documents are locked. Upload a new version instead.',
        'DOCUMENT_LOCKED',
      );
    }
    const changes: { field: string; old: unknown; new: unknown }[] = [];
    if (input.folderId && input.folderId !== doc.folderId.toString()) {
      // FR-DOC-18: within the same project only.
      if (!(await FolderModel.exists({ _id: input.folderId, projectId: project._id }))) {
        throw badRequest('Unknown folder.', undefined, 'UNKNOWN_FOLDER');
      }
      changes.push({ field: 'folderId', old: doc.folderId.toString(), new: input.folderId });
      doc.folderId = new Types.ObjectId(input.folderId);
    }
    if (input.taskId !== undefined && (input.taskId ?? null) !== (doc.taskId?.toString() ?? null)) {
      if (
        input.taskId &&
        !(await TaskModel.exists({ _id: input.taskId, projectId: project._id }))
      ) {
        throw badRequest('Linked task must be in this project.', undefined, 'INVALID_TASK');
      }
      changes.push({
        field: 'taskId',
        old: doc.taskId?.toString() ?? null,
        new: input.taskId ?? null,
      });
      doc.taskId = input.taskId ? new Types.ObjectId(input.taskId) : null;
    }
    if (changes.length) {
      doc.events.push({ event: 'UPDATED', actorId: currentUser(req)._id, at: new Date() });
      await doc.save();
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'document',
        entityId: doc._id,
        projectId: project._id,
        action: 'document_updated',
        changes,
      });
    }
    const [dto] = await toDocDtos(req, project, [doc.toObject() as DocDoc]);
    res.json({ document: dto });
  });

  for (const action of ['archive', 'restore'] as const) {
    p.post(`/:id/documents/:docId/${action}`, perm('documents', 'edit'), async (req, res) => {
      const input = action === 'archive' ? parseBody(archiveDocumentSchema, req) : { reason: null };
      const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
      assertNotArchived(project);
      if (!canArchiveDocs(currentUser(req), currentPermissions(req), project)) {
        throw forbidden('Only the project manager or an Admin can archive documents.');
      }
      const doc = await loadDoc(req, project);
      doc.archived = action === 'archive';
      doc.archivedReason = input.reason;
      doc.events.push({
        event: action === 'archive' ? 'ARCHIVED' : 'RESTORED',
        actorId: currentUser(req)._id,
        at: new Date(),
        note: input.reason,
      });
      await doc.save();
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'document',
        entityId: doc._id,
        projectId: project._id,
        action: action === 'archive' ? 'document_archived' : 'document_restored',
        reason: input.reason ?? undefined,
      });
      const [dto] = await toDocDtos(req, project, [doc.toObject() as DocDoc]);
      res.json({ document: dto });
    });
  }

  // ----- Task evidence (FR-EVD-01..07) -----
  const t = registry.router('/tasks');

  t.post('/:id/evidence/uploads', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(evidenceUploadSchema, req);
    const { task, project } = await loadTask(req);
    assertCan(req, project, task.toObject() as TaskDoc, 'status');
    if (!currentPermissions(req).documents.create) throw forbidden();
    for (const f of input.files) fileIssue(f, 'EVIDENCE');
    const items: UploadTicketDto[] = [];
    for (const f of input.files) {
      items.push(
        await ticket(req, project.toObject() as ProjectDoc, 'EVIDENCE', f, { taskId: task._id }),
      );
    }
    res.status(201).json({ uploads: items });
  });

  t.get('/:id/evidence/:evidenceId/download', perm('tasks', 'view'), async (req, res) => {
    const { task, project } = await loadTask(req);
    if (!currentPermissions(req).documents.view) throw forbidden();
    const item = task.evidence.find((e) => e._id.toString() === idParam(req, 'evidenceId'));
    if (!item || item.type !== 'FILE' || !item.documentId) throw notFound();
    const doc = (await DocumentModel.findOne({
      _id: item.documentId,
      projectId: project._id,
    }).lean()) as DocDoc | null;
    if (!doc) throw notFound();
    res.json(await downloadLink(project.toObject() as ProjectDoc, doc));
  });

  // ----- Upload completion (both kinds) -----
  const u = registry.router('/uploads');

  if (store instanceof MemoryBlobStore) {
    // Development/test stand-in for the Azure upload link (see MemoryBlobStore).
    u.put(
      '/:id/blob',
      AUTHENTICATED,
      express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 1024 }),
      async (req, res) => {
        const up = await UploadModel.findOne({
          _id: idParam(req),
          userId: currentUser(req)._id,
          state: 'PENDING',
        });
        if (!up || up.expiresAt < new Date()) throw notFound();
        store.put(up.blobKey, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
        res.status(201).end();
      },
    );
  }

  u.post('/:id/complete', AUTHENTICATED, async (req, res) => {
    const s = requireStore(store);
    const user = currentUser(req);
    const up = await UploadModel.findOne({ _id: idParam(req), userId: user._id });
    if (!up || up.state !== 'PENDING') throw notFound();
    if (up.expiresAt.getTime() + 60 * 60_000 < Date.now()) throw notFound();
    const projectDoc = await loadProject(req, 'view', up.projectId.toString());
    const project = projectDoc.toObject() as ProjectDoc;
    assertNotArchived(project);
    const perms = currentPermissions(req);
    // Re-check the right to write: access may have changed since the ticket was issued.
    let task: Awaited<ReturnType<typeof loadTask>>['task'] | null = null;
    if (up.purpose === 'EVIDENCE') {
      ({ task } = await loadTask(req, up.taskId!.toString()));
      assertCan(req, project, task.toObject() as TaskDoc, 'status');
    } else if (!canWriteDocs(user, perms, project)) {
      throw forbidden();
    }

    const reject = async (status: number, code: string, message: string, reason: string) => {
      await s.remove(up.blobKey);
      up.state = 'REJECTED';
      up.rejectReason = reason;
      await up.save();
      await audit({
        actorId: user._id,
        entityType: 'upload',
        entityId: up._id,
        projectId: project._id,
        action: code === 'MALWARE_DETECTED' ? 'upload_blocked_malware' : 'upload_rejected',
        reason,
        meta: { fileName: up.fileName, purpose: up.purpose },
      });
      return new HttpError(status, code, message, [{ path: 'file', message, name: up.fileName }]);
    };

    const info = await s.info(up.blobKey);
    if (!info) {
      // EC-59: the upload didn't finish; nothing is recorded and the user can retry.
      throw conflict('The file didn’t finish uploading. Please try again.', 'UPLOAD_INCOMPLETE');
    }
    if (info.size > MAX_UPLOAD_BYTES) {
      throw await reject(
        413,
        'FILE_TOO_LARGE',
        checkFileRules({ name: up.fileName, size: info.size }, up.purpose as UploadPurpose)!
          .message,
        'too large',
      );
    }
    if (info.size === 0) throw await reject(422, 'EMPTY_FILE', `${up.fileName} is empty.`, 'empty');
    const buf = await s.read(up.blobKey, MAX_UPLOAD_BYTES);
    const verdict = malwareVerdict(buf, info.tags);
    if (verdict) throw await reject(422, 'MALWARE_DETECTED', malwareMessage(up.fileName), verdict);
    const detected = detectFileType(buf, up.fileName);
    if (!detected.ok) {
      const ext = fileExtension(up.fileName);
      const message =
        detected.reason === 'MACRO'
          ? `${up.fileName} can't be added. Save it as .${ext.startsWith('d') ? 'docx' : 'xlsx'} without macros.`
          : notRealTypeMessage(up.fileName);
      throw await reject(422, 'INVALID_FILE_TYPE', message, detected.reason);
    }
    if (up.purpose === 'EVIDENCE' && detected.kind === 'IMAGE') {
      throw await reject(
        422,
        'INVALID_FILE_TYPE',
        `${up.fileName} can't be added. Evidence must be a PDF, Word or Excel file.`,
        'image',
      );
    }

    const version = {
      blobKey: up.blobKey,
      fileName: up.fileName,
      size: info.size,
      mimeType: detected.mimeType,
      sha256: sha256Hex(buf),
      status: up.status,
      uploadedBy: user._id,
      uploadedAt: new Date(),
      note: up.note ?? null,
    };
    let doc: InstanceType<typeof DocumentModel>;
    if (up.purpose === 'EVIDENCE') {
      const folder = await evidenceFolder(project, task!.phase ?? null);
      const name = await freeName(project._id, folder._id, up.fileName);
      doc = await DocumentModel.create({
        projectId: project._id,
        folderId: folder._id,
        name,
        nameKey: nameKey(name),
        kind: detected.kind,
        status: 'SUBMITTED',
        taskId: task!._id,
        source: 'EVIDENCE',
        versions: [{ ...version, version: 1, status: 'SUBMITTED' }],
        events: [
          {
            event: 'SUBMITTED',
            actorId: user._id,
            at: new Date(),
            version: 1,
            note: 'Task evidence',
          },
        ],
        createdBy: user._id,
      });
      await TaskModel.updateOne(
        { _id: task!._id },
        {
          $push: {
            evidence: {
              type: 'FILE',
              name,
              url: null,
              documentId: doc._id,
              size: info.size,
              mimeType: detected.mimeType,
              addedBy: user._id,
              at: new Date(),
            },
          },
          $inc: { version: 1 },
        },
      );
      await audit({
        actorId: user._id,
        entityType: 'task',
        entityId: task!._id,
        projectId: project._id,
        action: 'task_evidence_added',
        changes: [{ field: 'evidence', old: null, new: name }],
        meta: { documentId: doc._id.toString(), sha256: version.sha256, size: info.size },
      });
      const fresh = (await ProjectModel.findById(project._id).lean()) as ProjectDoc;
      await notify({
        type: 'EVIDENCE',
        project: fresh,
        taskId: task!._id,
        actorId: user._id,
        recipients: [
          task!.ownerId,
          ...(task!.assigneeIds ?? []),
          task!.approval?.reviewerId,
          fresh.managerId,
        ],
      });
    } else {
      const folderId = up.folderId!;
      const same =
        up.onDuplicate === 'NEW_VERSION'
          ? await DocumentModel.findOne({
              projectId: project._id,
              folderId,
              nameKey: nameKey(up.fileName),
              archived: { $ne: true },
            })
          : null;
      if (same) {
        // FR-DOC-12/31: a new version; a signed copy stays as the "Signed copy".
        const n = (same.versions[same.versions.length - 1]?.version ?? 0) + 1;
        same.versions.push({ ...version, version: n });
        same.status = up.status;
        if (up.status === 'SIGNED') same.signedVersion = n;
        same.kind = detected.kind;
        same.events.push({
          event: up.status,
          actorId: user._id,
          at: new Date(),
          version: n,
          note: up.note ?? null,
        });
        await same.save();
        doc = same;
      } else {
        const name = await freeName(project._id, folderId, up.fileName);
        doc = await DocumentModel.create({
          projectId: project._id,
          folderId,
          name,
          nameKey: nameKey(name),
          kind: detected.kind,
          status: up.status,
          signedVersion: up.status === 'SIGNED' ? 1 : null,
          taskId: up.taskId ?? null,
          source: 'DOCUMENT',
          versions: [{ ...version, version: 1 }],
          events: [
            {
              event: up.status,
              actorId: user._id,
              at: new Date(),
              version: 1,
              note: up.note ?? null,
            },
          ],
          createdBy: user._id,
        });
      }
      await audit({
        actorId: user._id,
        entityType: 'document',
        entityId: doc._id,
        projectId: project._id,
        action: same ? 'document_version_added' : 'document_uploaded',
        changes: [
          { field: 'version', old: null, new: doc.versions[doc.versions.length - 1]!.version },
        ],
        meta: { fileName: up.fileName, sha256: version.sha256, size: info.size, status: up.status },
      });
    }
    up.state = 'DONE';
    up.documentId = doc._id;
    await up.save();
    if (task) return respondTask(req, res, project, task._id, 201);
    const [dto] = await toDocDtos(req, project, [doc.toObject() as DocDoc]);
    res.status(201).json({ document: dto });
  });

  return [p.router, t.router, u.router];
}
