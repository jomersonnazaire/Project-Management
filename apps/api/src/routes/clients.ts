import { Router, type Request } from 'express';
import {
  can,
  clientSchema,
  contactSchema,
  listQuerySchema,
  updateClientSchema,
  updateContactSchema,
  type SystemRole,
} from '@xc8/shared';
import type { FilterQuery } from 'mongoose';
import type { AppConfig } from '../config.js';
import { conflict, notFound } from '../lib/errors.js';
import { paginate } from '../lib/pagination.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentRole, currentUser, requireAuth, requirePermission } from '../middleware/auth.js';
import {
  ClientContactModel,
  ClientModel,
  type Client,
  type ClientContact,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import { toClientDto, toContactDto } from '../services/dto.js';

/**
 * Clients and client contacts (FR-CLI-01..03). Admin and PM manage; Viewer reads all.
 * Members may only see clients of their own projects (07 §4); until projects exist
 * (later milestone) that set is empty, so Members get empty lists and 404 on reads.
 */
function canReadAll(req: Request) {
  return can(currentRole(req) as SystemRole, 'clients:read:all');
}

function nullify<T extends Record<string, unknown>>(input: T): T {
  // Convert empty optional strings to null so they clear the stored value.
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === '' ? null : v])) as T;
}

export function clientsRouter(config: AppConfig) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/', async (req, res) => {
    const q = parseQuery(listQuerySchema, req);
    if (!canReadAll(req)) {
      return res.json({ items: [], page: q.page, pageSize: q.pageSize, total: 0 });
    }
    const filter: FilterQuery<Client> = {};
    if (q.includeInactive !== 'true') filter.active = true;
    if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
    const { skip, limit } = paginate(q.page, q.pageSize);
    const [items, total] = await Promise.all([
      ClientModel.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      ClientModel.countDocuments(filter),
    ]);
    const counts = await ClientContactModel.aggregate<{ _id: unknown; n: number }>([
      { $match: { clientId: { $in: items.map((c) => c._id) }, active: true } },
      { $group: { _id: '$clientId', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({
      items: items.map((c) => toClientDto(c, byId.get(c._id.toString()) ?? 0)),
      page: q.page,
      pageSize: q.pageSize,
      total,
    });
  });

  router.get('/:id', async (req, res) => {
    const id = idParam(req);
    if (!canReadAll(req)) throw notFound();
    const client = await ClientModel.findById(id).lean();
    if (!client) throw notFound();
    const contactCount = await ClientContactModel.countDocuments({
      clientId: client._id,
      active: true,
    });
    res.json({ client: toClientDto(client, contactCount) });
  });

  router.post('/', requirePermission('clients:manage'), async (req, res) => {
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

  router.patch('/:id', requirePermission('clients:manage'), async (req, res) => {
    const input = nullify(parseBody(updateClientSchema, req));
    const client = await ClientModel.findById(idParam(req));
    if (!client) throw notFound();
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
    res.json({ client: toClientDto(client) });
  });

  for (const [path, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    router.post(`/:id/${path}`, requirePermission('clients:manage'), async (req, res) => {
      const client = await ClientModel.findById(idParam(req));
      if (!client) throw notFound();
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
      res.json({ client: toClientDto(client) });
    });
  }

  // ----- Contacts of a client -----
  router.get('/:id/contacts', async (req, res) => {
    const id = idParam(req);
    if (!canReadAll(req)) throw notFound();
    const client = await ClientModel.findById(id).lean();
    if (!client) throw notFound();
    const q = parseQuery(listQuerySchema, req);
    const filter: FilterQuery<ClientContact> = { clientId: client._id };
    if (q.includeInactive !== 'true') filter.active = true;
    const contacts = await ClientContactModel.find(filter).sort({ name: 1 }).lean();
    res.json({ items: contacts.map((c) => toContactDto(c, client.name)) });
  });

  router.post('/:id/contacts', requirePermission('clients:manage'), async (req, res) => {
    const input = parseBody(contactSchema, req);
    const client = await ClientModel.findById(idParam(req)).lean();
    if (!client) throw notFound();
    const contact = await ClientContactModel.create({ ...input, clientId: client._id });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'clientContact',
      entityId: contact._id,
      action: 'contact_created',
    });
    res.status(201).json({ contact: toContactDto(contact, client.name) });
  });

  return router;
}

/** Contacts across all clients, for the Client contacts screen. */
export function contactsRouter(config: AppConfig) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/', async (req, res) => {
    const q = parseQuery(listQuerySchema, req);
    if (!canReadAll(req)) {
      return res.json({ items: [], page: q.page, pageSize: q.pageSize, total: 0 });
    }
    const filter: FilterQuery<ClientContact> = {};
    if (q.includeInactive !== 'true') filter.active = true;
    if (q.clientId) filter.clientId = q.clientId;
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

  router.get('/:id', async (req, res) => {
    const id = idParam(req);
    if (!canReadAll(req)) throw notFound();
    const contact = await ClientContactModel.findById(id).lean();
    if (!contact) throw notFound();
    const client = await ClientModel.findById(contact.clientId).select('name').lean();
    res.json({ contact: toContactDto(contact, client?.name ?? '') });
  });

  router.patch('/:id', requirePermission('clients:manage'), async (req, res) => {
    const input = nullify(parseBody(updateContactSchema, req));
    const contact = await ClientContactModel.findById(idParam(req));
    if (!contact) throw notFound();
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

  for (const [path, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    router.post(`/:id/${path}`, requirePermission('clients:manage'), async (req, res) => {
      const contact = await ClientContactModel.findById(idParam(req));
      if (!contact) throw notFound();
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

  return router;
}

async function assertClientNameFree(name: string, exceptId?: string) {
  const filter: FilterQuery<Client> = { nameKey: name.toLowerCase() };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await ClientModel.exists(filter)) {
    throw conflict('A client with this name already exists.', 'CLIENT_NAME_IN_USE');
  }
}
