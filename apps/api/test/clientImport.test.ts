import {
  CLIENT_IMPORT_COLUMNS,
  CLIENT_IMPORT_MAX_ROWS,
  CLIENT_IMPORT_TOKEN_HEADER,
  XLSX_MIME,
  type ClientImportCommitDto,
  type ClientImportPreviewDto,
  type ClientImportSheet,
} from '@xc8/shared';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type request from 'supertest';
import {
  ActivityLogModel,
  ClientContactModel,
  ClientModel,
  ProjectModel,
} from '../src/models/index.js';
import {
  PREVIEW_TOKEN_TTL_MS,
  previewTokenClock,
} from '../src/services/clientImport/previewToken.js';
import { loadConfig } from '../src/config.js';
import {
  appWithCapturedLogs,
  CSRF,
  createUser,
  login,
  makeApp,
  signedInAs,
  useDatabase,
} from './helpers.js';
import { grant, resetRules } from './m2helpers.js';

/**
 * CR-19: Clients Excel template download and import (doc 17, 17_CR-19_CLIENTS_EXCEL_IMPORT.md).
 * Test names carry the CR-19 AC / FR / EC ids they cover.
 */

useDatabase();
const app = makeApp();
type Agent = ReturnType<typeof request.agent>;
type Cell = ExcelJS.CellValue;

const HEADERS = (sheet: ClientImportSheet) => CLIENT_IMPORT_COLUMNS[sheet].map((c) => c.header);

/** A filled template: row 1 help, row 2 headers, data from row 3 (FR-CLI-27). */
async function xlsx(
  data: { clients?: Cell[][]; contacts?: Cell[][] },
  opts: { headers?: Partial<Record<ClientImportSheet, string[]>>; only?: ClientImportSheet[] } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of opts.only ?? (['Clients', 'Contacts'] as const)) {
    const ws = wb.addWorksheet(sheet);
    const headers = opts.headers?.[sheet] ?? HEADERS(sheet);
    ws.addRow(headers.map(() => 'help'));
    ws.addRow(headers);
    for (const r of (sheet === 'Clients' ? data.clients : data.contacts) ?? []) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const send = (
  agent: Agent,
  step: 'preview' | 'commit',
  buf: Buffer,
  name = 'clients.xlsx',
  token?: string,
) => {
  const req = agent
    .post(`/api/v1/clients/import/${step}?fileName=${encodeURIComponent(name)}`)
    .set(CSRF)
    .set('Content-Type', XLSX_MIME);
  if (token !== undefined) req.set(CLIENT_IMPORT_TOKEN_HEADER, token);
  return req.send(buf);
};

async function preview(agent: Agent, buf: Buffer) {
  const res = await send(agent, 'preview', buf);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ClientImportPreviewDto;
}
/** Commit with a given preview token (FR-CLI-35b), returning the raw response. */
const commitWith = (agent: Agent, buf: Buffer, token: string) =>
  send(agent, 'commit', buf, 'clients.xlsx', token);
/** Preview, then commit with that preview's token (the normal two-step flow). */
async function commit(agent: Agent, buf: Buffer) {
  const { token } = await preview(agent, buf);
  const res = await commitWith(agent, buf, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ClientImportCommitDto;
}

/** Reads a file response into a Buffer (same as the DAR export tests). */
const fileOf = (agent: Agent, path: string) =>
  agent
    .get(path)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

let n = 0;
/** A unique company name per test, so tests in this file never share clients. */
const co = (label: string) => `${label} ${++n}-${Date.now().toString(36)}`;

const allFour = { view: true, create: true, edit: true, delete: true, export: false };
const viewOnly = { view: true, create: false, edit: false, delete: false, export: false };

describe('CR-19 access (FR-CLI-23/24, Q-111)', () => {
  afterEach(() => resetRules());

  it('AC-61.2 Member and Viewer get 403 FORBIDDEN on template, preview and commit', async () => {
    const buf = await xlsx({ clients: [[co('Gate')]] });
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      const t = await agent.get('/api/v1/clients/import/template');
      expect(t.status).toBe(403);
      expect(t.body.error.code).toBe('FORBIDDEN');
      for (const step of ['preview', 'commit'] as const) {
        const res = await send(agent, step, buf);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
    expect(await ActivityLogModel.countDocuments({ action: 'clients_imported' })).toBe(0);
  });

  it('AC-61.1 Admin and PM (all four by default) may download the template and preview', async () => {
    for (const role of ['ADMIN', 'PROJECT_MANAGER'] as const) {
      const { agent } = await signedInAs(app, role);
      expect((await agent.get('/api/v1/clients/import/template')).status).toBe(200);
      await preview(agent, await xlsx({ clients: [[co('Ok')]] }));
    }
  });

  it('AC-61.6 clients-only rights (View only on contacts) and contacts-only rights both get 403', async () => {
    const buf = await xlsx({ clients: [[co('Partial')]] });
    const pm = await createUser({ systemRole: 'PROJECT_MANAGER' });
    const agent = await login(app, pm.email);
    await grant(app, 'PROJECT_MANAGER', { clients: allFour, contacts: viewOnly });
    expect((await agent.get('/api/v1/clients/import/template')).status).toBe(403);
    expect((await send(agent, 'preview', buf)).status).toBe(403);
    expect((await send(agent, 'commit', buf)).status).toBe(403);
    // "New client" keeps its own rule (clients.create).
    expect(
      (
        await agent
          .post('/api/v1/clients')
          .set(CSRF)
          .send({ name: co('Still') })
      ).status,
    ).toBe(201);

    await grant(app, 'PROJECT_MANAGER', { clients: viewOnly, contacts: allFour });
    expect((await agent.get('/api/v1/clients/import/template')).status).toBe(403);
    expect((await send(agent, 'preview', buf)).status).toBe(403);
    expect((await send(agent, 'commit', buf)).status).toBe(403);
  });

  it('AC-61.3 removing any ONE of the four gates the calls on the next request; granting it back restores them', async () => {
    const buf = await xlsx({ clients: [[co('Toggle')]] });
    const pm = await createUser({ systemRole: 'PROJECT_MANAGER' });
    const agent = await login(app, pm.email);
    const cases: [string, string][] = [
      ['clients', 'create'],
      ['clients', 'edit'],
      ['contacts', 'create'],
      ['contacts', 'edit'],
    ];
    for (const [record, action] of cases) {
      await grant(app, 'PROJECT_MANAGER', {
        clients: { ...allFour },
        contacts: { ...allFour },
        [record]: { ...allFour, [action]: false },
      });
      expect((await send(agent, 'preview', buf)).status, `${record}.${action}`).toBe(403);
      expect((await agent.get('/api/v1/clients/import/template')).status).toBe(403);
    }
    await grant(app, 'PROJECT_MANAGER', { clients: allFour, contacts: allFour });
    expect((await send(agent, 'preview', buf)).status).toBe(200);
  });

  it('AC-62.15 / FR-CLI-41 without clients.delete a Status change makes the WHOLE row an Error', async () => {
    const name = co('Status Co');
    const admin = await signedInAs(app, 'ADMIN');
    await commit(
      admin.agent,
      await xlsx({ clients: [[name, 'Retail', '', 'Old notes', 'Active']] }),
    );
    await grant(app, 'PROJECT_MANAGER', {
      clients: { ...allFour, delete: false },
      contacts: allFour,
    });
    const { agent } = await signedInAs(app, 'PROJECT_MANAGER');
    const fresh = co('Fresh Inactive');
    const file = await xlsx({
      clients: [
        [name, '', '', 'New notes', 'Inactive'],
        // AC-62.11: a NEW client may be created Inactive without clients.delete.
        [fresh, '', '', '', 'Inactive'],
      ],
      // EC-141: contacts of the failed row still link to the existing client.
      contacts: [[name, 'Status Person', '', 'status.person@example.com']],
    });
    const p = await preview(agent, file);
    expect(p.clients[0]).toMatchObject({
      row: 3,
      result: 'ERROR',
      reasons: [
        "You don't have permission to change Status. Set it back to Active or leave it blank, then import this row again.",
      ],
    });
    expect(p.clients[1]!.result).toBe('NEW');
    expect(p.contacts[0]!.result).toBe('NEW');
    const c = await commit(agent, file);
    expect(c.applied).toEqual({ created: 2, updated: 0, skipped: 1 });
    const stored = await ClientModel.findOne({ name }).lean();
    expect(stored).toMatchObject({ active: true, notes: 'Old notes' });
    expect(await ClientModel.findOne({ name: fresh }).lean()).toMatchObject({ active: false });

    // Set Status back (or blank) and re-import: the Notes change is saved.
    const again = await commit(
      agent,
      await xlsx({ clients: [[name, '', '', 'New notes', 'Active']] }),
    );
    expect(again.applied.updated).toBe(1);
    expect(await ClientModel.findOne({ name }).lean()).toMatchObject({
      active: true,
      notes: 'New notes',
    });
  });

  it('EC-154 a Member given the four gates can’t use a company outside their scope', async () => {
    const name = co('Hidden Co');
    await ClientModel.create({ name, nameKey: name.toLowerCase() });
    await grant(app, 'MEMBER', { clients: allFour, contacts: allFour });
    const { agent } = await signedInAs(app, 'MEMBER');
    const p = await preview(
      agent,
      await xlsx({ clients: [[name, 'X']], contacts: [[name, 'Someone']] }),
    );
    expect(p.clients[0]!.reasons).toEqual(["This company name can't be used."]);
    expect(p.contacts[0]!.reasons).toEqual(["This company name can't be used."]);
  });
});

describe('CR-19 template (FR-CLI-25..28)', () => {
  it('AC-61.5 two sheets in order, help row 1, headers row 2, locked rows, Status dropdown', async () => {
    const { agent } = await signedInAs(app, 'PROJECT_MANAGER');
    const res = await fileOf(agent, '/api/v1/clients/import/template');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_MIME);
    expect(res.headers['content-disposition']).toContain('OpsTrack-clients-template.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Clients', 'Contacts']);
    const clients = wb.getWorksheet('Clients')!;
    const contacts = wb.getWorksheet('Contacts')!;
    expect((clients.getRow(2).values as string[]).slice(1)).toEqual([
      'Company name',
      'Industry',
      'Address',
      'Notes',
      'Status',
    ]);
    expect((contacts.getRow(2).values as string[]).slice(1)).toEqual([
      'Company name',
      'Full Name',
      'Position',
      'Email',
      'Phone',
      'Department',
      'Notes',
    ]);
    for (const ws of [clients, contacts]) {
      ws.getRow(1).eachCell((c) => expect(String(c.value).length).toBeGreaterThan(5));
      // Locked is Excel's default, so rows 1-2 carry no "unlocked" flag; the data columns do.
      expect(ws.getCell('A1').protection?.locked).not.toBe(false);
      expect(ws.getCell('A2').protection?.locked).not.toBe(false);
      expect(ws.getColumn(1).style?.protection?.locked).toBe(false);
      expect(ws.getColumn(1).style?.numFmt).toBe('@');
    }
    expect(clients.getCell('E3').dataValidation).toMatchObject({
      type: 'list',
      formulae: ['"Active,Inactive"'],
    });
    expect(clients.getCell('E2002').dataValidation?.type).toBe('list');
    // Sheet protection is on (no password), so rows 1 and 2 can't be edited by accident.
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheetXml).toMatch(/<sheetProtection[^>]*sheet="1"/);
    expect(sheetXml).not.toMatch(/hashValue/);
  });

  it('AC-62.1 / FR-CLI-34 the downloaded template previews as "No rows found"', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const tpl = await fileOf(agent, '/api/v1/clients/import/template');
    const res = await send(agent, 'preview', tpl.body as Buffer);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'EMPTY_FILE',
      message: 'No rows found in the file.',
    });
  });
});

describe('CR-19 preview and matching (FR-CLI-29..34a)', () => {
  it('AC-62.1 preview returns counts and per-row tags and changes nothing', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const name = co('Preview Only');
    const before = await ActivityLogModel.countDocuments();
    const p = await preview(
      agent,
      await xlsx({
        clients: [
          [name, 'Retail'],
          ['', 'No name'],
        ],
        contacts: [[name, 'A Person']],
      }),
    );
    expect(p.counts.clients).toEqual({ new: 1, update: 0, noChange: 0, error: 1 });
    expect(p.counts.contacts).toEqual({ new: 1, update: 0, noChange: 0, error: 0 });
    expect(p.counts.total).toEqual({ new: 2, update: 0, noChange: 0, error: 1 });
    expect(p.clients[1]).toMatchObject({
      row: 4,
      result: 'ERROR',
      reasons: ['Company name is blank'],
    });
    expect(p.clients[0]!.values).toMatchObject({ 'Company name': name, Industry: 'Retail' });
    expect(p.fileName).toBe('clients.xlsx');
    expect(await ClientModel.countDocuments({ name })).toBe(0);
    expect(await ActivityLogModel.countDocuments()).toBe(before);
  });

  it('AC-62.2 / FR-CLI-29 client match trims and ignores case; inner spaces still count', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const base = co('Client A');
    await ClientModel.create({ name: base, nameKey: base.toLowerCase(), industry: 'Retail' });
    const p = await preview(
      agent,
      await xlsx({
        clients: [
          [`  ${base.toLowerCase()} `, 'Retail'],
          [`${co('Client B')}`],
          [base.replace('Client A', 'Client  A'), 'Retail'],
        ],
      }),
    );
    expect(p.clients.map((r) => r.result)).toEqual(['NO_CHANGE', 'NEW', 'NEW']);
    const upd = await preview(agent, await xlsx({ clients: [[base.toUpperCase(), 'Wholesale']] }));
    expect(upd.clients[0]!.result).toBe('UPDATE');
  });

  it('AC-62.3 / FR-CLI-30 contact email matches case-insensitively within its client only', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Email A');
    const b = co('Email B');
    await commit(
      admin.agent,
      await xlsx({
        clients: [[a], [b]],
        contacts: [[a, 'Contact Person', 'Manager', 'contact@example.com']],
      }),
    );
    const file = await xlsx({
      contacts: [
        [a, '', 'Director', 'CONTACT@example.com'],
        [b, 'Contact Person', '', 'contact@example.com'],
      ],
    });
    const p = await preview(admin.agent, file);
    expect(p.contacts.map((r) => r.result)).toEqual(['UPDATE', 'NEW']);
    await commit(admin.agent, file);
    const clientA = await ClientModel.findOne({ name: a }).lean();
    const clientB = await ClientModel.findOne({ name: b }).lean();
    const ofA = await ClientContactModel.find({ clientId: clientA!._id }).lean();
    expect(ofA).toHaveLength(1);
    // Blank Full Name kept the name; Position replaced.
    expect(ofA[0]).toMatchObject({ name: 'Contact Person', position: 'Director' });
    expect(await ClientContactModel.countDocuments({ clientId: clientB!._id })).toBe(1);
  });

  it('AC-62.4 / AC-62.18 no-email rows match on Full name; an email row next to a no-email twin is New with a warning', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Fallback');
    await commit(admin.agent, await xlsx({ clients: [[a]], contacts: [[a, 'Contact One']] }));
    const p = await preview(
      admin.agent,
      await xlsx({
        contacts: [
          [a, '  contact one ', 'Buyer'],
          [a, 'Contact One', '', 'contact@example.com'],
        ],
      }),
    );
    expect(p.contacts[0]!.result).toBe('UPDATE');
    expect(p.contacts[1]).toMatchObject({
      result: 'NEW',
      warnings: ['Possible duplicate of Contact One (no email) on the Contacts tab.'],
    });
  });

  it('AC-62.5 / FR-CLI-31 on update a blank cell keeps the value and a filled cell replaces it', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Blank Keeps');
    await commit(admin.agent, await xlsx({ clients: [[a, 'Retail', 'Makati', 'Old']] }));
    const c = await commit(admin.agent, await xlsx({ clients: [[a, '', '', 'New']] }));
    expect(c.applied).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(await ClientModel.findOne({ name: a }).lean()).toMatchObject({
      industry: 'Retail',
      address: 'Makati',
      notes: 'New',
    });
  });

  it('AC-62.6 / FR-CLI-33 / EC-139 duplicates in the file are Errors on every copy', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Dup');
    const b = co('Other');
    const p = await preview(
      admin.agent,
      await xlsx({
        clients: [[b], [a], ['x'], ['y'], [a.toUpperCase()]],
        contacts: [
          [b, 'P1', '', 'contact@example.com'],
          [b, 'P2', '', 'CONTACT@example.com'],
          [b, 'Same Name'],
          [b, 'same name'],
          // The same email under a different client isn't a duplicate.
          ['x', 'P3', '', 'contact@example.com'],
        ],
      }),
    );
    expect(p.clients[1]).toMatchObject({
      result: 'ERROR',
      reasons: ['Duplicate in file (rows 4 and 7)'],
    });
    expect(p.clients[4]).toMatchObject({
      result: 'ERROR',
      reasons: ['Duplicate in file (rows 4 and 7)'],
    });
    expect(p.contacts.map((r) => r.result)).toEqual(['ERROR', 'ERROR', 'ERROR', 'ERROR', 'NEW']);
    expect(p.contacts[0]!.reasons).toEqual(['Duplicate in file (rows 3 and 4)']);
    expect(p.contacts[2]!.reasons).toEqual(['Duplicate in file (rows 5 and 6)']);
    // EC-141: a contact whose client row is an Error (and isn't in the app) is an Error too.
    const q = await preview(
      admin.agent,
      await xlsx({ clients: [[a], [a]], contacts: [[a, 'Kid']] }),
    );
    expect(q.contacts[0]!.reasons).toEqual(['Its client row 3 has an error.']);
  });

  it('AC-62.14 / FR-CLI-34a a contact whose company is in neither the file nor the app is an Error; no client is created', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const z = co('Client Z');
    const c = await commit(
      admin.agent,
      await xlsx({ contacts: [[z, 'Leo Navarro', '', 'leo@example.com']] }),
    );
    expect(c.contacts[0]).toMatchObject({
      result: 'ERROR',
      reasons: [
        `Company ${z} isn't on the Clients sheet or in OpsTrack. Add it on the Clients sheet.`,
      ],
    });
    expect(c.applied).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(await ClientModel.countDocuments({ name: z })).toBe(0);
  });

  it('§6 validation: blank names, bad email, unknown Status, long values and wrong cell types', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Invalid');
    const typed = co('Typed');
    const p = await preview(
      admin.agent,
      await xlsx({
        clients: [
          [a, 'x'.repeat(121), '', '', 'Paused'],
          // A number, a date and a boolean cell are read as their text.
          [typed, 12345, new Date(Date.UTC(2026, 10, 3)), true],
        ],
        contacts: [
          [typed, 'Grace Tan', '', 'grace.tan@sunridge'],
          [typed, ''],
          ['', 'No Company'],
          [typed, 'Phone Person', '', '', 639170000000],
          [a, 'Orphan'],
        ],
      }),
    );
    expect(p.clients[0]!.reasons).toEqual([
      'Industry is longer than 120 characters',
      'Status must be Active or Inactive',
    ]);
    expect(p.clients[1]).toMatchObject({
      result: 'NEW',
      values: { Industry: '12345', Address: '2026-11-03', Notes: 'TRUE' },
    });
    expect(p.contacts[0]!.reasons).toEqual(["Email isn't valid"]);
    expect(p.contacts[1]!.reasons).toEqual(['Full name is blank']);
    expect(p.contacts[2]!.reasons).toEqual(['Company name is blank']);
    expect(p.contacts[3]).toMatchObject({ result: 'NEW', values: { Phone: '639170000000' } });
    // The client row is an Error and not in the app, so its contacts are Errors too (EC-141).
    expect(p.contacts[4]!.reasons).toEqual(['Its client row 3 has an error.']);
  });

  it('FR-CLI-32 / EC-152 an ambiguous match in the app is an Error', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Ambiguous');
    const client = await ClientModel.create({ name: a, nameKey: a.toLowerCase() });
    await ClientContactModel.create([
      { clientId: client._id, name: 'One', email: 'same@example.com' },
      { clientId: client._id, name: 'Two', email: 'same@example.com' },
    ]);
    const p = await preview(
      admin.agent,
      await xlsx({ contacts: [[a, 'X', '', 'same@example.com']] }),
    );
    expect(p.contacts[0]!.reasons).toEqual([
      `Matches more than one contact in ${a}. Fix it on the Contacts tab first.`,
    ]);
  });

  it('AC-62.17 / EC-150 a row matching an inactive contact updates it and keeps it inactive', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Inactive Kept');
    const client = await ClientModel.create({ name: a, nameKey: a.toLowerCase(), active: false });
    const contact = await ClientContactModel.create({
      clientId: client._id,
      name: 'Sleeper',
      email: 'sleeper@example.com',
      active: false,
    });
    const file = await xlsx({
      clients: [[a, 'Mining']],
      contacts: [[a, '', 'CFO', 'sleeper@example.com']],
    });
    const p = await preview(admin.agent, file);
    expect(p.clients[0]).toMatchObject({ result: 'UPDATE', inactive: true });
    expect(p.contacts[0]).toMatchObject({ result: 'UPDATE', inactive: true });
    await commit(admin.agent, file);
    expect(await ClientContactModel.findById(contact._id).lean()).toMatchObject({
      active: false,
      position: 'CFO',
    });
    expect(await ClientModel.findById(client._id).lean()).toMatchObject({ active: false });
  });

  it('§9 extra columns and extra sheets are ignored with a note', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const p = await preview(
      admin.agent,
      await xlsx(
        { clients: [[co('Extra'), '', '', '', '', 'ignored']] },
        { headers: { Clients: [...HEADERS('Clients'), 'Website'] } },
      ),
    );
    expect(p.notes).toEqual(['Extra columns were ignored: Website (Clients).']);
    expect(p.clients[0]!.result).toBe('NEW');
  });
});

describe('CR-19 commit (FR-CLI-35..39)', () => {
  it('AC-62.7 / AC-62.12 / FR-CLI-39 commit writes New and Update rows, skips Errors, audits each with importId', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const upd = co('Upd');
    const same = co('Same');
    await commit(
      admin.agent,
      await xlsx({
        clients: [
          [upd, 'Old'],
          [same, 'Retail'],
        ],
      }),
    );
    const fresh = co('Fresh');
    const file = await xlsx({
      clients: [
        [fresh, 'Marine'],
        [upd, 'New'],
        [same, 'Retail'],
        ['', 'blank'],
      ],
      contacts: [
        [fresh, 'Maria Santos', '', 'maria@example.com', '+63 917 000 0000'],
        [fresh, 'Bad Email', '', 'nope'],
      ],
    });
    const c = await commit(admin.agent, file);
    expect(c.applied).toEqual({ created: 2, updated: 1, skipped: 2 });
    expect(c.counts.total).toEqual({ new: 2, update: 1, noChange: 1, error: 2 });
    const freshDoc = await ClientModel.findOne({ name: fresh }).lean();
    expect(freshDoc).toMatchObject({
      industry: 'Marine',
      active: true,
      nameKey: fresh.toLowerCase(),
    });
    expect(await ClientContactModel.findOne({ clientId: freshDoc!._id }).lean()).toMatchObject({
      name: 'Maria Santos',
      email: 'maria@example.com',
      phone: '+63 917 000 0000',
      active: true,
    });
    const entries = await ActivityLogModel.find({ 'meta.importId': c.importId }).lean();
    const actions = entries.map((e) => e.action).sort();
    expect(actions).toEqual([
      'client_created',
      'client_updated',
      'clients_imported',
      'contact_created',
    ]);
    const updated = entries.find((e) => e.action === 'client_updated')!;
    expect(updated.changes).toEqual([{ field: 'industry', old: 'Old', new: 'New' }]);
    const summary = entries.find((e) => e.action === 'clients_imported')!;
    expect(summary.meta).toMatchObject({
      fileName: 'clients.xlsx',
      size: file.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      counts: {
        clients: { new: 1, update: 1, noChange: 1, error: 1 },
        contacts: { new: 1, update: 0, noChange: 0, error: 1 },
      },
    });
    // No change rows aren't written or audited.
    const sameDoc = await ClientModel.findOne({ name: same }).lean();
    expect(entries.some((e) => e.entityId.equals(sameDoc!._id))).toBe(false);
  });

  it('AC-62.16 with clients.delete a Status change deactivates and writes client_deactivated (Q-107: no open-project check, as today)', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Deactivate Me');
    const client = await ClientModel.create({ name: a, nameKey: a.toLowerCase() });
    // An open project doesn't block it, matching POST /clients/:id/deactivate today (Q-107 open).
    await ProjectModel.collection.insertOne({
      name: 'Open',
      clientId: client._id,
      status: 'ACTIVE',
    });
    const c = await commit(admin.agent, await xlsx({ clients: [[a, '', '', '', 'inactive']] }));
    expect(c.applied.updated).toBe(1);
    expect(await ClientModel.findById(client._id).lean()).toMatchObject({ active: false });
    const e = await ActivityLogModel.findOne({
      'meta.importId': c.importId,
      entityId: client._id,
    }).lean();
    expect(e).toMatchObject({
      action: 'client_deactivated',
      changes: [{ field: 'active', old: true, new: false }],
    });
  });

  it('AC-62.9 / FR-CLI-37 formula-like cells are stored as plain text, never evaluated', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Formula');
    await commit(
      admin.agent,
      await xlsx({
        clients: [[a, '@risk', '-dash', { formula: 'HYPERLINK("http://example.com")' }]],
        contacts: [[a, '=1+2', '', '', '+63 900 000 0000', '\t=cmd']],
      }),
    );
    const client = await ClientModel.findOne({ name: a }).lean();
    expect(client).toMatchObject({
      industry: '@risk',
      address: '-dash',
      notes: '=HYPERLINK("http://example.com")',
    });
    expect(await ClientContactModel.findOne({ clientId: client!._id }).lean()).toMatchObject({
      name: '=1+2',
      phone: '+63 900 000 0000',
      department: '=cmd',
    });
  });

  it('AC-62.8 a failure part-way rolls everything back and leaves no create/update audit entries', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Rollback');
    const existing = co('Rollback Existing');
    await commit(admin.agent, await xlsx({ clients: [[existing, 'Before']] }));
    const file = await xlsx({ clients: [[a], [existing, 'After']], contacts: [[a, 'Kid']] });
    const { token } = await preview(admin.agent, file);
    const spy = vi
      .spyOn(ClientContactModel, 'insertMany')
      .mockRejectedValueOnce(new Error('simulated write failure'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await commitWith(admin.agent, file, token);
      expect(res.status).toBe(500);
      expect(res.body.error).toMatchObject({
        code: 'IMPORT_FAILED',
        message: 'Import failed. Nothing was saved. Try again.',
      });
    } finally {
      spy.mockRestore();
      errors.mockRestore();
    }
    expect(await ClientModel.countDocuments({ name: a })).toBe(0);
    expect(await ClientModel.findOne({ name: existing }).lean()).toMatchObject({
      industry: 'Before',
    });
    const failed = await ActivityLogModel.findOne({ action: 'clients_import_failed' }).lean();
    expect(failed).not.toBeNull();
    const importId = (failed!.meta as { importId: string }).importId;
    expect(
      await ActivityLogModel.countDocuments({
        'meta.importId': importId,
        action: { $ne: 'clients_import_failed' },
      }),
    ).toBe(0);
  });

  it('EC-156 re-uploading the same file shows every row as No change and writes nothing', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Idem');
    const file = await xlsx({
      clients: [[a, 'Retail', 'Pasig', 'n', 'Active']],
      contacts: [
        [a, 'With Email', 'CEO', 'Ceo@Example.com', '+63 2 8000'],
        [a, 'No Email', 'Clerk'],
      ],
    });
    const first = await commit(admin.agent, file);
    expect(first.applied).toEqual({ created: 3, updated: 0, skipped: 0 });
    const p = await preview(admin.agent, file);
    expect([...p.clients, ...p.contacts].map((r) => r.result)).toEqual([
      'NO_CHANGE',
      'NO_CHANGE',
      'NO_CHANGE',
    ]);
    const before = await ActivityLogModel.countDocuments({ action: { $ne: 'clients_imported' } });
    const second = await commit(admin.agent, file);
    expect(second.applied).toEqual({ created: 0, updated: 0, skipped: 0 });
    expect(await ActivityLogModel.countDocuments({ action: { $ne: 'clients_imported' } })).toBe(
      before,
    );
    const client = await ClientModel.findOne({ name: a }).lean();
    expect(await ClientContactModel.countDocuments({ clientId: client!._id })).toBe(2);
  });
});

describe('CR-19 file checks (§9, NFR-36/37, AC-62.10)', () => {
  const expectError = async (buf: Buffer, status: number, code: string, message?: string) => {
    const { agent } = await signedInAs(app, 'ADMIN');
    for (const step of ['preview', 'commit'] as const) {
      const res = await send(agent, step, buf);
      expect(res.status, `${step} ${code}`).toBe(status);
      expect(res.body.error.code).toBe(code);
      if (message) expect(res.body.error.message).toBe(message);
    }
  };

  it('over 5 MB is 413 FILE_TOO_LARGE (both above and just over the raw limit)', async () => {
    await expectError(
      Buffer.alloc(6 * 1024 * 1024),
      413,
      'FILE_TOO_LARGE',
      'The file is larger than 5 MB.',
    );
    await expectError(Buffer.alloc(5 * 1024 * 1024 + 10), 413, 'FILE_TOO_LARGE');
  });

  it('.csv, .xls, .docx and .xlsm are 415 UNSUPPORTED_FILE (checked by content)', async () => {
    await expectError(
      Buffer.from('Company name,Industry\nAcme,Retail\n'),
      415,
      'UNSUPPORTED_FILE',
      'Upload an .xlsx file.',
    );
    const xls = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512),
    ]);
    await expectError(xls, 415, 'UNSUPPORTED_FILE');
    const docx = new JSZip();
    docx.file('[Content_Types].xml', '<Types/>');
    docx.file('word/document.xml', '<w:document/>');
    await expectError(await docx.generateAsync({ type: 'nodebuffer' }), 415, 'UNSUPPORTED_FILE');
    const xlsm = await JSZip.loadAsync(await xlsx({ clients: [[co('Macro')]] }));
    xlsm.file('xl/vbaProject.bin', 'macro');
    await expectError(await xlsm.generateAsync({ type: 'nodebuffer' }), 415, 'UNSUPPORTED_FILE');
  });

  it('a corrupt, password-protected or zip-bomb workbook is 422 UNREADABLE_FILE', async () => {
    const msg = "This file can't be read. Save it again as .xlsx and retry.";
    await expectError(
      Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(200, 7)]),
      422,
      'UNREADABLE_FILE',
      msg,
    );
    const encrypted = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(64),
      Buffer.from('EncryptionInfo', 'utf16le'),
    ]);
    await expectError(encrypted, 422, 'UNREADABLE_FILE');
    const bomb = await JSZip.loadAsync(await xlsx({ clients: [[co('Bomb')]] }));
    bomb.file('xl/media/huge.bin', Buffer.alloc(60 * 1024 * 1024));
    const zipped = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(zipped.length).toBeLessThan(1024 * 1024);
    await expectError(zipped, 422, 'UNREADABLE_FILE');
  });

  it('renamed, reordered or missing headers, or a missing sheet, are 422 NOT_TEMPLATE', async () => {
    const msg = "This file isn't the OpsTrack template. Download the template and try again.";
    const renamed = ['Client', 'Industry', 'Address', 'Notes', 'Status'];
    await expectError(
      await xlsx({ clients: [['A']] }, { headers: { Clients: renamed } }),
      422,
      'NOT_TEMPLATE',
      msg,
    );
    const reordered = [
      'Company name',
      'Full Name',
      'Email',
      'Position',
      'Phone',
      'Department',
      'Notes',
    ];
    await expectError(
      await xlsx({ clients: [['A']] }, { headers: { Contacts: reordered } }),
      422,
      'NOT_TEMPLATE',
    );
    await expectError(await xlsx({ clients: [['A']] }, { only: ['Clients'] }), 422, 'NOT_TEMPLATE');
  });

  it('an empty file is 422 EMPTY_FILE; 2,001 rows on a sheet is 422 TOO_MANY_ROWS', async () => {
    await expectError(await xlsx({}), 422, 'EMPTY_FILE', 'No rows found in the file.');
    const rows = Array.from({ length: CLIENT_IMPORT_MAX_ROWS + 1 }, (_, i) => [`x`, `P ${i}`]);
    await expectError(
      await xlsx({ contacts: rows }),
      422,
      'TOO_MANY_ROWS',
      'Too many rows: the Contacts sheet has 2,001. The limit is 2,000 per sheet.',
    );
  });

  it('exactly 2,000 rows is accepted (NFR-36 boundary)', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const rows = Array.from({ length: CLIENT_IMPORT_MAX_ROWS }, (_, i) => [`Bulk ${n}-${i}`]);
    const p = await preview(agent, await xlsx({ clients: rows }));
    expect(p.counts.clients.new).toBe(CLIENT_IMPORT_MAX_ROWS);
  });
});

describe('CR-19 signed preview token (FR-CLI-35b, Q-116)', () => {
  const STALE = {
    code: 'PREVIEW_STALE',
    message: 'These clients changed after your preview. Preview again.',
  };
  const importAudits = () =>
    ActivityLogModel.countDocuments({
      action: { $in: ['client_created', 'client_updated', 'contact_created', 'clients_imported'] },
    });

  afterEach(() => vi.restoreAllMocks());

  it('preview returns a signed token; nothing changed within 15 minutes: commit succeeds first try', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Fresh');
    const file = await xlsx({ clients: [[a, 'Retail']] });
    const p = await preview(admin.agent, file);
    expect(p.token).toMatch(/^[\w-]+\.[\w-]+$/);
    // The payload names no records or values, only the user, the time and a hash.
    const payload = JSON.parse(Buffer.from(p.token.split('.')[0]!, 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['h', 'iat', 'uid', 'v']);
    const res = await commitWith(admin.agent, file, p.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.applied).toEqual({ created: 1, updated: 0, skipped: 0 });
  });

  it('AC-62.19 a matched client edited after the preview: 409 PREVIEW_STALE, nothing saved; preview again then commit works', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const other = await signedInAs(app, 'ADMIN');
    const a = co('Stale');
    const fresh = co('Stale New');
    await commit(admin.agent, await xlsx({ clients: [[a, 'Retail']] }));
    const client = await ClientModel.findOne({ name: a }).lean();
    const file = await xlsx({ clients: [[a, 'Banking'], [fresh]], contacts: [[a, 'Kid']] });
    const p = await preview(admin.agent, file);
    expect(p.clients.map((r) => r.result)).toEqual(['UPDATE', 'NEW']);

    const edit = await other.agent
      .patch(`/api/v1/clients/${client!._id.toString()}`)
      .set(CSRF)
      .send({ industry: 'Mining' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);

    const before = await importAudits();
    const failedBefore = await ActivityLogModel.countDocuments({ action: 'clients_import_failed' });
    const res = await commitWith(admin.agent, file, p.token);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject(STALE);
    expect(await ClientModel.countDocuments({ name: fresh })).toBe(0);
    expect(await ClientModel.findOne({ name: a }).lean()).toMatchObject({ industry: 'Mining' });
    expect(await ClientContactModel.countDocuments({ clientId: client!._id })).toBe(0);
    expect(await importAudits()).toBe(before);
    expect(await ActivityLogModel.countDocuments({ action: 'clients_import_failed' })).toBe(
      failedBefore,
    );

    const again = await preview(admin.agent, file);
    const ok = await commitWith(admin.agent, file, again.token);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.counts).toEqual(again.counts);
    expect(ok.body.applied).toEqual({ created: 2, updated: 1, skipped: 0 });
    expect(await ClientModel.findOne({ name: a }).lean()).toMatchObject({ industry: 'Banking' });
  });

  it('EC-148 a change to a client the file does not touch does not cause a 409', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const untouched = co('Untouched');
    await commit(admin.agent, await xlsx({ clients: [[untouched]] }));
    const file = await xlsx({ clients: [[co('Other')]] });
    const p = await preview(admin.agent, file);
    await ClientModel.updateOne({ name: untouched }, { $set: { industry: 'Changed' } });
    expect((await commitWith(admin.agent, file, p.token)).status).toBe(200);
  });

  it('AC-62.20 two overlapping imports committed at the same time: exactly one saves, the other gets 409', async () => {
    const u1 = await signedInAs(app, 'ADMIN');
    const u2 = await signedInAs(app, 'ADMIN');
    const existing = co('Race Existing');
    const fresh = co('Race New');
    await commit(u1.agent, await xlsx({ clients: [[existing]] }));
    const f1 = await xlsx({
      clients: [[fresh, 'One']],
      contacts: [[existing, 'Same Person', '', 'same@example.com']],
    });
    const f2 = await xlsx({
      clients: [[fresh, 'Two']],
      contacts: [[existing, 'Same Person', '', 'same@example.com']],
    });
    const [p1, p2] = await Promise.all([preview(u1.agent, f1), preview(u2.agent, f2)]);
    const results = await Promise.all([
      commitWith(u1.agent, f1, p1.token),
      commitWith(u2.agent, f2, p2.token),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error).toMatchObject(STALE);
    expect(await ClientModel.countDocuments({ name: fresh })).toBe(1);
    const client = await ClientModel.findOne({ name: existing }).lean();
    expect(
      await ClientContactModel.countDocuments({ clientId: client!._id, email: 'same@example.com' }),
    ).toBe(1);
    expect(await ActivityLogModel.countDocuments({ action: 'clients_imported' })).toBeGreaterThan(
      0,
    );
  });

  it('AC-62.20 / EC-149 two imports adding the same contact under an existing client: one saves, one 409', async () => {
    const u1 = await signedInAs(app, 'ADMIN');
    const u2 = await signedInAs(app, 'ADMIN');
    const existing = co('Race Contacts');
    await commit(u1.agent, await xlsx({ clients: [[existing]] }));
    const file = await xlsx({ contacts: [[existing, 'Twin', '', 'twin@example.com']] });
    const [p1, p2] = await Promise.all([preview(u1.agent, file), preview(u2.agent, file)]);
    const results = await Promise.all([
      commitWith(u1.agent, file, p1.token),
      commitWith(u2.agent, file, p2.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const client = await ClientModel.findOne({ name: existing }).lean();
    expect(await ClientContactModel.countDocuments({ clientId: client!._id })).toBe(1);
  });

  it('AC-62.21 another user committing with my token gets 409, nothing saved, no hint of whose it was', async () => {
    const u1 = await signedInAs(app, 'ADMIN');
    const u2 = await signedInAs(app, 'ADMIN');
    const a = co('Borrowed');
    const file = await xlsx({ clients: [[a]] });
    const p1 = await preview(u1.agent, file);
    const before = await importAudits();
    const res = await commitWith(u2.agent, file, p1.token);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject(STALE);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(u1.user._id.toString());
    expect(text).not.toContain(u1.user.email);
    expect(await ClientModel.countDocuments({ name: a })).toBe(0);
    expect(await importAudits()).toBe(before);
    // Their own preview and token work as usual.
    const p2 = await preview(u2.agent, file);
    expect((await commitWith(u2.agent, file, p2.token)).status).toBe(200);
  });

  it('AC-62.22 a token older than 15 minutes is 409 even with no data change; under 15 minutes it works', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Expired');
    const file = await xlsx({ clients: [[a]] });
    const t0 = Date.now();
    const clock = vi.spyOn(previewTokenClock, 'now').mockReturnValue(t0);
    const old = await preview(admin.agent, file);
    clock.mockReturnValue(t0 + PREVIEW_TOKEN_TTL_MS + 1);
    const res = await commitWith(admin.agent, file, old.token);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject(STALE);
    expect(await ClientModel.countDocuments({ name: a })).toBe(0);

    clock.mockReturnValue(t0 + 20 * 60_000);
    const p = await preview(admin.agent, file);
    clock.mockReturnValue(t0 + 20 * 60_000 + PREVIEW_TOKEN_TTL_MS - 1000);
    expect((await commitWith(admin.agent, file, p.token)).status).toBe(200);
  });

  it('a tampered, forged, missing or other-file token is 409 PREVIEW_STALE and saves nothing', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Tamper');
    const file = await xlsx({ clients: [[a]] });
    const { token } = await preview(admin.agent, file);
    const [data, mac] = token.split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    const altered = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() + 1 })).toString(
      'base64url',
    );
    const flipped = `${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    const otherApp = makeApp({
      CLIENT_IMPORT_TOKEN_SECRET: 'another-test-only-key-abcdefghijklmnop',
    });
    const otherAgent = await login(otherApp, admin.user.email);
    const { token: foreign } = await preview(otherAgent, file);
    const otherFile = await xlsx({ clients: [[a, 'Different']] });
    const bad = [`${altered}.${mac}`, `${data}.${flipped}`, `${data}`, 'x.y.z', '', foreign];
    // Nine commits by one user: each on a fresh app so NFR-41's 5-commit limit isn't the answer.
    const fresh = () => login(makeApp(), admin.user.email);
    for (const t of bad) {
      const res = await commitWith(await fresh(), file, t);
      expect(res.status, t).toBe(409);
      expect(res.body.error).toMatchObject(STALE);
    }
    const noHeader = await send(await fresh(), 'commit', file);
    expect(noHeader.status).toBe(409);
    // A valid token for a different file is stale too (file SHA-256 is in the hash).
    expect((await commitWith(await fresh(), otherFile, token)).status).toBe(409);
    expect(await ClientModel.countDocuments({ name: a })).toBe(0);
    // The untouched token still works.
    expect((await commitWith(admin.agent, file, token)).status).toBe(200);
  });
});

describe('CR-19 any matched-record change makes the preview stale (FR-CLI-35b v0.7)', () => {
  it('AC-62.19 an edit to a field the file does not touch (Notes, file cell blank) is still 409', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = co('Notes Only');
    await commit(admin.agent, await xlsx({ clients: [[a, 'Retail']] }));
    const file = await xlsx({ clients: [[a, 'Banking']] });
    const p = await preview(admin.agent, file);
    const client = await ClientModel.findOne({ name: a }).lean();
    const edit = await admin.agent
      .patch(`/api/v1/clients/${client!._id.toString()}`)
      .set(CSRF)
      .send({ notes: 'Edited elsewhere' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const res = await commitWith(admin.agent, file, p.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PREVIEW_STALE');
    expect(await ClientModel.findOne({ name: a }).lean()).toMatchObject({ industry: 'Retail' });
  });

  it("AC-62.19 user 1's commit updating Client A makes user 2's open preview of Client A stale", async () => {
    const u1 = await signedInAs(app, 'ADMIN');
    const u2 = await signedInAs(app, 'ADMIN');
    const a = co('Shared');
    await commit(u1.agent, await xlsx({ clients: [[a, 'Retail']] }));
    const f1 = await xlsx({ clients: [[a, 'Banking']] });
    const f2 = await xlsx({ clients: [[a, 'Retail', 'Somewhere']] });
    const p2 = await preview(u2.agent, f2);
    await commit(u1.agent, f1);
    const res = await commitWith(u2.agent, f2, p2.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PREVIEW_STALE');
  });
});

describe('CR-19 abuse limits (NFR-41, AC-62.24, EC-149)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('AC-62.24 the 21st preview in 15 minutes gets 429 RATE_LIMITED; another user is not affected', async () => {
    const app2 = makeApp();
    const u1 = await signedInAs(app2, 'ADMIN');
    const u2 = await signedInAs(app2, 'ADMIN');
    const file = await xlsx({ clients: [[co('Limit')]] });
    for (let i = 0; i < 20; i++) {
      expect((await send(u1.agent, 'preview', file)).status, `preview ${i + 1}`).toBe(200);
    }
    const res = await send(u1.agent, 'preview', file);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many imports. Wait a few minutes, then try again. Nothing was saved.',
    });
    expect((await send(u2.agent, 'preview', file)).status).toBe(200);
    // Other routes for the same user still work.
    expect((await u1.agent.get('/api/v1/clients')).status).toBe(200);
  });

  it('AC-62.24 the 6th commit in 15 minutes gets 429 and saves nothing', async () => {
    const app2 = makeApp();
    const admin = await signedInAs(app2, 'ADMIN');
    for (let i = 0; i < 5; i++) {
      const file = await xlsx({ clients: [[co('Five')]] });
      const { token } = await preview(admin.agent, file);
      expect((await commitWith(admin.agent, file, token)).status, `commit ${i + 1}`).toBe(200);
    }
    const sixth = co('Sixth');
    const file = await xlsx({ clients: [[sixth]] });
    const { token } = await preview(admin.agent, file);
    const res = await commitWith(admin.agent, file, token);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(await ClientModel.countDocuments({ name: sixth })).toBe(0);
  });

  /** Holds the next commit inside the handler (at startSession) until release() is called. */
  function holdNextCommit() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    const real = mongoose.startSession.bind(mongoose);
    const spy = vi.spyOn(mongoose, 'startSession').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return real(...(args as Parameters<typeof real>));
    });
    return { release, inside, spy };
  }

  it('AC-62.24 / EC-149 a second commit by the same user while one runs gets 429 IMPORT_BUSY; the first saves; another user still works', async () => {
    const app2 = makeApp();
    const u1 = await signedInAs(app2, 'ADMIN');
    const u2 = await signedInAs(app2, 'ADMIN');
    const a = co('Busy');
    const b = co('Busy Other');
    const file = await xlsx({ clients: [[a]] });
    const other = await xlsx({ clients: [[b]] });
    const p1 = await preview(u1.agent, file);
    const p1b = await preview(u1.agent, file);
    const p2 = await preview(u2.agent, other);

    const hold = holdNextCommit();
    const first = commitWith(u1.agent, file, p1.token).then((r) => r);
    await hold.inside;
    const second = await commitWith(u1.agent, file, p1b.token);
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBe('5');
    expect(second.body.error).toMatchObject({
      code: 'IMPORT_BUSY',
      message: 'Another import is still running. Wait a moment, then try again. Nothing was saved.',
    });
    // A different user is not blocked by u1's lock (their own rules apply: here, success).
    const theirs = await commitWith(u2.agent, other, p2.token);
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(200);
    hold.release();
    const done = await first;
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await ClientModel.countDocuments({ name: a })).toBe(1);
  });

  it('AC-62.24 the lock is released after a 409, a 500 and a file error', async () => {
    const app2 = makeApp();
    const admin = await signedInAs(app2, 'ADMIN');
    const a = co('Released');
    const file = await xlsx({ clients: [[a]] });
    // 409: a bad token.
    expect((await commitWith(admin.agent, file, 'bad.token')).status).toBe(409);
    // 415/422: a file error.
    const bad = await send(admin.agent, 'commit', Buffer.from('not a zip'), 'x.xlsx', 'x');
    expect([415, 422]).toContain(bad.status);
    // 500: the database session fails.
    const p = await preview(admin.agent, file);
    vi.spyOn(mongoose, 'startSession').mockRejectedValueOnce(new Error('boom'));
    expect((await commitWith(admin.agent, file, p.token)).status).toBe(500);
    // The next commit is not refused as busy.
    const ok = await commitWith(admin.agent, file, p.token);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await ClientModel.countDocuments({ name: a })).toBe(1);
  });
});

describe('CR-19 signing key not set (AC-62.23, EC-158, NFR-42)', () => {
  it('template, preview and commit return 503 IMPORT_NOT_CONFIGURED; the rest of the API works', async () => {
    for (const value of ['', 'too-short-key']) {
      const noKey = makeApp({ CLIENT_IMPORT_TOKEN_SECRET: value });
      const user = await createUser({ systemRole: 'ADMIN' });
      const agent = await login(noKey, user.email);
      const expected = {
        code: 'IMPORT_NOT_CONFIGURED',
        message: 'Excel import isn’t set up yet. Ask an Admin.',
      };
      const t = await agent.get('/api/v1/clients/import/template');
      expect(t.status).toBe(503);
      expect(t.body.error).toMatchObject(expected);
      const a = co('NoKey');
      const buf = await xlsx({ clients: [[a]] });
      for (const step of ['preview', 'commit'] as const) {
        const res = await send(agent, step, buf, 'clients.xlsx', 'anything');
        expect(res.status, step).toBe(503);
        expect(res.body.error).toMatchObject(expected);
      }
      expect(await ClientModel.countDocuments({ name: a })).toBe(0);
      // Clients list and New client still work.
      expect((await agent.get('/api/v1/clients')).status).toBe(200);
      const created = await agent
        .post('/api/v1/clients')
        .set(CSRF)
        .send({ name: co('Manual') });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
    }
  });

  it('the gate still answers first: a Member gets 403, not 503', async () => {
    const noKey = makeApp({ CLIENT_IMPORT_TOKEN_SECRET: '' });
    const user = await createUser({ systemRole: 'MEMBER' });
    const agent = await login(noKey, user.email);
    expect((await agent.get('/api/v1/clients/import/template')).status).toBe(403);
  });

  it('config loads in production without the key (no fail-fast) and logs one warning without a value', () => {
    const base = {
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost/x',
      COOKIE_SECURE: 'true',
    };
    expect(loadConfig(base).clientImportTokenSecret).toBeNull();
    expect(
      loadConfig({ ...base, CLIENT_IMPORT_TOKEN_SECRET: 'short' }).clientImportTokenSecret,
    ).toBeNull();
    const key = 'p'.repeat(40);
    expect(loadConfig({ ...base, CLIENT_IMPORT_TOKEN_SECRET: key }).clientImportTokenSecret).toBe(
      key,
    );
    // Development without a key gets a random per-process key so import works locally.
    expect(
      loadConfig({ ...base, NODE_ENV: 'development' }).clientImportTokenSecret?.length,
    ).toBeGreaterThanOrEqual(32);

    const off = appWithCapturedLogs({ CLIENT_IMPORT_TOKEN_SECRET: 'short-secret-value' });
    const warnings = off.lines.filter((l) => l.includes('CLIENT_IMPORT_TOKEN_SECRET'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('short-secret-value');
    const on = appWithCapturedLogs();
    expect(on.lines.join('')).not.toContain('CLIENT_IMPORT_TOKEN_SECRET');
  });
});
