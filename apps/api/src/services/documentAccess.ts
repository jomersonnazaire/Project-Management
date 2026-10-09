import type { PartyDto, PartyKind } from '@xc8/shared';
import type { Types } from 'mongoose';
import { badRequest } from '../lib/errors.js';
import { ClientContactModel, ClientModel, FolderModel, UserModel } from '../models/index.js';
import { isPlanner, isProjectMember, type ScopeUser } from './scope.js';

type Id = Types.ObjectId;

interface ProjectLike {
  _id: Id;
  clientId: Id;
  managerId?: Id | null;
  memberIds?: Id[] | null;
}

/**
 * Restricted folders (FR-DOC-43). A restricted folder, and everything inside it, is visible only to
 * the project's planners (Admins and the managing PM) and the members picked on the folder.
 * Everyone else gets the same answer as for a folder that doesn't exist (404), so nothing leaks.
 */
export function seesAllFolders(user: ScopeUser, project: ProjectLike): boolean {
  return isPlanner(user, project);
}

/** Ids (as strings) of the project's folders the user may not see. */
export async function hiddenFolderIds(user: ScopeUser, project: ProjectLike): Promise<Set<string>> {
  if (seesAllFolders(user, project)) return new Set();
  const folders = await FolderModel.find({ projectId: project._id })
    .select('parentId restricted allowedUserIds')
    .lean();
  if (!folders.some((f) => f.restricted)) return new Set();
  const byId = new Map(folders.map((f) => [f._id.toString(), f]));
  const hidden = new Set<string>();
  for (const f of folders) {
    let cur: (typeof folders)[number] | undefined = f;
    for (let guard = 0; cur && guard < 10; guard++) {
      if (cur.restricted && !(cur.allowedUserIds ?? []).some((id) => id.equals(user._id))) {
        hidden.add(f._id.toString());
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId.toString()) : undefined;
    }
  }
  return hidden;
}

/** Hidden folder ids for several projects at once (dashboard and "requested from you" lists). */
export async function hiddenFolderIdsFor(
  user: ScopeUser,
  projects: ProjectLike[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const p of projects) for (const id of await hiddenFolderIds(user, p)) out.add(id);
  return out;
}

export interface PartyRef {
  kind: string;
  id: Id;
}
const key = (kind: string, id: Id | string) => `${kind}:${id.toString()}`;

/** Resolves users and client contacts to display records in two or three queries. */
export async function resolveParties(
  refs: (PartyRef | null | undefined)[],
): Promise<Map<string, PartyDto>> {
  const list = refs.filter((r): r is PartyRef => Boolean(r?.id));
  const userIds = list.filter((r) => r.kind === 'USER').map((r) => r.id);
  const contactIds = list.filter((r) => r.kind === 'CONTACT').map((r) => r.id);
  const [users, contacts] = await Promise.all([
    userIds.length
      ? UserModel.find({ _id: { $in: userIds } })
          .select('name active')
          .lean()
      : Promise.resolve([]),
    contactIds.length
      ? ClientContactModel.find({ _id: { $in: contactIds } })
          .select('name active clientId')
          .lean()
      : Promise.resolve([]),
  ]);
  const clients = contacts.length
    ? await ClientModel.find({ _id: { $in: contacts.map((c) => c.clientId) } })
        .select('name')
        .lean()
    : [];
  const clientNames = new Map(clients.map((c) => [c._id.toString(), c.name]));
  const out = new Map<string, PartyDto>();
  for (const u of users) {
    out.set(key('USER', u._id), {
      kind: 'USER',
      id: u._id.toString(),
      name: u.name,
      active: Boolean(u.active),
    });
  }
  for (const c of contacts) {
    out.set(key('CONTACT', c._id), {
      kind: 'CONTACT',
      id: c._id.toString(),
      name: c.name,
      active: Boolean(c.active),
      company: clientNames.get(c.clientId.toString()) ?? null,
    });
  }
  return out;
}

export function partyFrom(
  map: Map<string, PartyDto>,
  ref: PartyRef | null | undefined,
): PartyDto | null {
  if (!ref?.id) return null;
  return (
    map.get(key(ref.kind, ref.id)) ?? {
      kind: ref.kind as PartyKind,
      id: ref.id.toString(),
      name: 'Unknown',
      active: false,
    }
  );
}

/**
 * AC-26.2: a document can be requested from a project member (active user) or an active contact of
 * the project's client. Anything else is a 400 with the field highlighted.
 */
export async function assertRequestableParty(
  project: ProjectLike,
  party: { kind: PartyKind; id: string },
): Promise<void> {
  const fail = () =>
    badRequest(
      'Pick a project member or an active contact of this project’s client.',
      [{ path: 'requestedFrom', message: 'Pick someone on this project.' }],
      'INVALID_REQUESTED_FROM',
    );
  if (party.kind === 'USER') {
    const user = await UserModel.findOne({ _id: party.id, active: true }).select('_id').lean();
    if (!user || !isProjectMember({ _id: user._id, systemRole: 'MEMBER' }, project)) throw fail();
    return;
  }
  await assertActiveContact(project, party.id, fail);
}

export async function assertActiveContact(
  project: ProjectLike,
  contactId: string,
  fail: () => Error = () =>
    badRequest(
      'Pick an active contact of this project’s client.',
      [{ path: 'signedByContactId', message: 'Pick an active client contact.' }],
      'INVALID_CONTACT',
    ),
): Promise<void> {
  const ok = await ClientContactModel.exists({
    _id: contactId,
    clientId: project.clientId,
    active: true,
  });
  if (!ok) throw fail();
}
