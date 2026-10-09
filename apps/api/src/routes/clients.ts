import {
  PROJECT_STATUSES,
  clientSchema,
  contactSchema,
  listQuerySchema,
  updateClientSchema,
  updateContactSchema,
  type ProjectStatus,
} from '@xc8/shared';
import type { Request } from 'express';
import type { FilterQuery, Types } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { paginate } from '../lib/pagination.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import {
  ClientContactModel,
  ClientModel,
  ProjectModel,
  UserModel,
  type Client,
  type ClientContact,
  type Project,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import { toClientDto, toContactDto, toProjectSummaryDto } from '../services/dto.js';
import { clientInScope, projectScopeFilter, visibleClientIds } from '../services/scope.js';

/**
 * Clients, their contacts and their projects (FR-CLI-01..03, FR-CLI-09..12).
 * The central gate checks the access rules (`clients.*`, `contacts.*`, `projects.view`);
 * these handlers add the fixed scope: Members only see clients of projects they belong to
 * (FR-ACL-07), so until projects exist they see none and get 404 by id.
 */

function nullify<T extends Record<string, unknown>>(input: T): T {
  // Convert empty optional strings to null so they clear the stored value.
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === '' ? null : v])) as T;
}

/** Loads a client the caller may see, or 404 (no leak of records outside the scope). */
async function clientForRequest(req: Request, id = idParam(req)) {
  const client = await ClientModel.findById(id);
  if (!client || !(await clientInScope(currentUser(req), client._id))) throw notFound();
  return client;
}

async function projectCounts(req: Request, clientIds: Types.ObjectId[]) {
  const counts = await ProjectModel.aggregate<{ _id: unknown; n: number }>([
    {
      $match: {
        ...projectScopeFilter(currentUser(req)),
        clientId: { $in: clientIds },
        archived: false,
      },
    },
    { $group: { _id: '$clientId', n: { $sum: 1 } } },
  ]);
  return new Map(counts.map((c) => [String(c._id), c.n]));
}

async function contactCounts(clientIds: Types.ObjectId[]) {
  const counts = await ClientContactModel.aggregate<{ _id: unknown; n: number }>([
    { $match: { clientId: { $in: clientIds }, active: true } },
    { $group: { _id: '$clientId', n: { $sum: 1 } } },
  ]);
  return new Map(counts.map((c) => [String(c._id), c.n]));
}

async function clientDto(
  req: Request,
  client: { _id: Types.ObjectId } & Parameters<typeof toClientDto>[0],
) {
  const [contacts, projects] = await Promise.all([
    contactCounts([client._id]),
    projectCounts(req, [client._id]),
  ]);
  const key = client._id.toString();
  return toClientDto(client, contacts.get(key) ?? 0, projects.get(key) ?? 0);
}

export function clientsRouter(registry: RouteRegistry) {
  const r = registry.router('/clients');

  r.get('/', perm('clients', 'view'), async (req, res) => {
    const q = parseQuery(listQuerySchema, req);
    const filter: FilterQuery<Client> = {};
    const scope = await visibleClientIds(currentUser(req));
    if (scope) filter._id = { $in: scope };
    if (q.includeInactive !== 'true') filter.active = true;
    if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
    const { skip, limit } = paginate(q.page, q.pageSize);
    const [items, total] = await Promise.all([
      ClientModel.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      ClientModel.countDocuments(filter),
    ]);
    const ids = items.map((c) => c._id);
    const [contacts, projects] = await Promise.all([contactCounts(ids), projectCounts(req, ids)]);
    res.json({
      items: items.map((c) =>
        toClientDto(c, contacts.get(c._id.toString()) ?? 0, projects.get(c._id.toString()) ?? 0),
      ),
      page: q.page,
      pageSize: q.pageSize,
      total,
    });
  });

  r.get('/:id', perm('clients', 'view'), async (req, res) => {
    const client = await clientForRequest(req);
    res.json({ client: await clientDto(req, client) });
  });

  r.post('/', perm('clients', 'create'), async (req, res) => {
    const input = parseBody(clientSchema, req);
    await assertClientNameFree(input.name);
    const client = await ClientModel.create({ ...input, nameKey: input.name.toLowerCase() });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'client',
      entityId: client._id,
      action: 'client_created',
    });
    res.status(201).json({ client: toClientDto(client) });
  });

  r.patch('/:id', perm('clients', 'edit'), async (req, res) => {
    const input = nullify(parseBody(updateClientSchema, req));
    const client = await clientForRequest(req);
    if (input.name && input.name.toLowerCase() !== client.nameKey) {
      await assertClientNameFree(input.name, client._id.toString());
      client.nameKey = input.name.toLowerCase();
    }
    client.set(input);
    await client.save();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'client',
      entityId: client._id,
      action: 'client_updated',
    });
    res.json({ client: await clientDto(req, client) });
  });

  // Clients are deactivated rather than deleted (FR-CLI-08 pattern), so this counts as Delete.
  for (const [path, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    r.post(`/:id/${path}`, perm('clients', 'delete'), async (req, res) => {
      const client = await clientForRequest(req);
      if (client.active !== active) {
        client.active = active;
        await client.save();
        await audit({
          actorId: currentUser(req)._id,
          entityType: 'client',
          entityId: client._id,
          action: active ? 'client_reactivated' : 'client_deactivated',
          changes: [{ field: 'active', old: !active, new: active }],
        });
      }
      res.json({ client: await clientDto(req, client) });
    });
  }

  // ----- Contacts tab (FR-CLI-09/10) -----
  r.get('/:id/contacts', perm('contacts', 'view'), async (req, res) => {
    const client = await clientForRequest(req);
    const q = parseQuery(listQuerySchema, req);
    const filter: FilterQuery<ClientContact> = { clientId: client._id };
    if (q.status === 'INACTIVE') filter.active = false;
    else if (q.status === 'ALL' || q.includeInactive === 'true') {
      // all contacts
    } else if (q.status && q.status !== 'ACTIVE') throw badRequest('Unknown status.');
    else filter.active = true;
    if (q.q) {
      const re = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ name: re }, { email: re }, { position: re }, { department: re }];
    }
    const contacts = await ClientContactModel.find(filter).sort({ name: 1 }).lean();
    res.json({ items: contacts.map((c) => toContactDto(c, client.name)) });
  });

  r.post('/:id/contacts', perm('contacts', 'create'), async (req, res) => {
    const input = parseBody(contactSchema, req);
    const client = await clientForRequest(req);
    const contact = await ClientContactModel.create({ ...input, clientId: client._id });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'clientContact',
      entityId: contact._id,
      action: 'contact_created',
    });
    res.status(201).json({ contact: toContactDto(contact, client.name) });
  });

  // ----- Projects tab (FR-CLI-11/12): only projects in the caller's scope, enforced here -----
  r.get('/:id/projects', perm('projects', 'view'), async (req, res) => {
    const client = await clientForRequest(req);
    const q = parseQuery(listQuerySchema, req);
    const filter: FilterQuery<Project> = {
      ...projectScopeFilter(currentUser(req)),
      clientId: client._id,
    };
    if (q.status === 'ARCHIVED') filter.archived = true;
    else {
      filter.archived = false;
      if (q.status) {
        if (!(PROJECT_STATUSES as readonly string[]).includes(q.status)) {
          throw badRequest('Unknown status.');
        }
        filter.status = q.status as ProjectStatus;
      }
    }
    if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
    const projects = await ProjectModel.find(filter).sort({ name: 1 }).limit(500).lean();
    const managers = await UserModel.find({
      _id: { $in: projects.map((p) => p.managerId).filter(Boolean) },
    })
      .select('name')
      .lean();
    const names = new Map(managers.map((u) => [u._id.toString(), u.name]));
    res.json({
      items: projects.map((p) =>
        toProjectSummaryDto(p, p.managerId ? (names.get(p.managerId.toString()) ?? null) : null),
      ),
      total: projects.length,
    });
  });

  return r.router;
}

/** Contacts across clients (kept for the Milestone 1 web app and for edits from the Contacts tab). */
export function contactsRouter(registry: RouteRegistry) {
  const r = registry.router('/contacts');

  async function contactForRequest(req: Request) {
    const contact = await ClientContactModel.findById(idParam(req));
    if (!contact || !(await clientInScope(currentUser(req), contact.clientId))) throw notFound();
    return contact;
  }

  r.get('/', perm('contacts', 'view'), async (req, res) => {
    const q = parseQuery(listQuerySchema, req);
    const filter: FilterQuery<ClientContact> = {};
    const scope = await visibleClientIds(currentUser(req));
    if (scope) filter.clientId = { $in: scope };
    if (q.includeInactive !== 'true') filter.active = true;
    if (q.clientId) {
      filter.clientId =
        scope && !scope.some((id) => id.toString() === q.clientId) ? { $in: [] } : q.clientId;
    }
    if (q.q) {
      const re = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ name: re }, { email: re }, { department: re }];
    }
    const { skip, limit } = paginate(q.page, q.pageSize);
    const [items, total] = await Promise.all([
      ClientContactModel.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      ClientContactModel.countDocuments(filter),
    ]);
    const clients = await ClientModel.find({ _id: { $in: items.map((c) => c.clientId) } })
      .select('name')
      .lean();
    const names = new Map(clients.map((c) => [c._id.toString(), c.name]));
    res.json({
      items: items.map((c) => toContactDto(c, names.get(c.clientId.toString()) ?? '')),
      page: q.page,
      pageSize: q.pageSize,
      total,
    });
  });

  r.get('/:id', perm('contacts', 'view'), async (req, res) => {
    const contact = await contactForRequest(req);
    const client = await ClientModel.findById(contact.clientId).select('name').lean();
    res.json({ contact: toContactDto(contact, client?.name ?? '') });
  });

  r.patch('/:id', perm('contacts', 'edit'), async (req, res) => {
    const input = nullify(parseBody(updateContactSchema, req));
    const contact = await contactForRequest(req);
    contact.set(input);
    await contact.save();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'clientContact',
      entityId: contact._id,
      action: 'contact_updated',
    });
    const client = await ClientModel.findById(contact.clientId).select('name').lean();
    res.json({ contact: toContactDto(contact, client?.name ?? '') });
  });

  // Contacts are deactivated, never deleted (FR-CLI-08), so this counts as Delete.
  for (const [path, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    r.post(`/:id/${path}`, perm('contacts', 'delete'), async (req, res) => {
      const contact = await contactForRequest(req);
      if (contact.active !== active) {
        contact.active = active;
        await contact.save();
        await audit({
          actorId: currentUser(req)._id,
          entityType: 'clientContact',
          entityId: contact._id,
          action: active ? 'contact_reactivated' : 'contact_deactivated',
          changes: [{ field: 'active', old: !active, new: active }],
        });
      }
      const client = await ClientModel.findById(contact.clientId).select('name').lean();
      res.json({ contact: toContactDto(contact, client?.name ?? '') });
    });
  }

  return r.router;
}

async function assertClientNameFree(name: string, exceptId?: string) {
  const filter: FilterQuery<Client> = { nameKey: name.toLowerCase() };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await ClientModel.exists(filter)) {
    throw conflict('A client with this name already exists.', 'CLIENT_NAME_IN_USE');
  }
}
