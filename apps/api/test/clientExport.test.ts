import {
  CLIENT_IMPORT_COLUMNS,
  CLIENT_IMPORT_TOKEN_HEADER,
  XLSX_MIME,
  phDateOf,
  type ClientImportCommitDto,
  type ClientImportPreviewDto,
  type ClientImportSheet,
} from '@xc8/shared';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import {
  ActivityLogModel,
  ClientContactModel,
  ClientModel,
  ProjectModel,
} from '../src/models/index.js';
import { CSRF, createUser, login, makeApp, signedInAs, useDatabase } from './helpers.js';
import { grant, resetRules } from './m2helpers.js';

/**
 * Clients export (Jomerson, Nov 3): GET /clients/import/export is the template layout filled
 * with the clients (and contact persons) the user may see, and imports back as all No change.
 * Own database for this file, so the exported rows are exactly what is seeded here.
 */

useDatabase();
const app = makeApp();
type Agent = ReturnType<typeof request.agent>;

const EXPORT = '/api/v1/clients/import/export';
const allFour = { view: true, create: true, edit: true, delete: true, export: false };

const fileOf = (agent: Agent, path: string) =>
  agent
    .get(path)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

/** Data rows (row 3 on) of a sheet as arrays of cell text, one per template column. */
function dataOf(wb: ExcelJS.Workbook, sheet: ClientImportSheet): string[][] {
  const ws = wb.getWorksheet(sheet)!;
  const width = CLIENT_IMPORT_COLUMNS[sheet].length;
  const out: string[][] = [];
  ws.eachRow((r, n) => {
    if (n < 3) return;
    out.push(Array.from({ length: width }, (_, i) => String(r.getCell(i + 1).value ?? '')));
  });
  return out;
}

const send = (agent: Agent, step: 'preview' | 'commit', buf: Buffer, token?: string) => {
  const req = agent
    .post(`/api/v1/clients/import/${step}?fileName=clients.xlsx`)
    .set(CSRF)
    .set('Content-Type', XLSX_MIME);
  if (token !== undefined) req.set(CLIENT_IMPORT_TOKEN_HEADER, token);
  return req.send(buf);
};

const FORMULA = '=HYPERLINK("http://example.com","x")';

beforeAll(async () => {
  // Inserted out of order and with mixed case, to prove the sort.
  const [beta, alpha, zeta, hidden] = await ClientModel.create([
    { name: 'beta Logistics', nameKey: 'beta logistics', industry: 'Logistics' },
    {
      name: 'Alpha Foods',
      nameKey: 'alpha foods',
      industry: 'Retail',
      address: 'Makati City\nMetro Manila',
      notes: FORMULA,
    },
    { name: 'Zeta Old Co', nameKey: 'zeta old co', active: false, notes: '@SUM(A1)' },
    { name: 'Hidden Corp', nameKey: 'hidden corp' },
  ]);
  await ClientContactModel.create([
    {
      clientId: alpha!._id,
      name: 'Zed Reyes',
      email: 'zed@xceler8.example',
      phone: '+63 900 000 0000',
      position: '-cmd',
    },
    {
      clientId: alpha!._id,
      name: 'Ana Cruz',
      email: 'ana@xceler8.example',
      phone: '0917 123 4567',
      department: 'Finance',
      notes: '+cmd|calc',
    },
    { clientId: beta!._id, name: 'No Email Person', position: 'Driver' },
    { clientId: zeta!._id, name: 'Former Contact', active: false },
    { clientId: hidden!._id, name: 'Hidden Person', email: 'hidden@xceler8.example' },
  ]);
  const pm = await createUser({ systemRole: 'PROJECT_MANAGER' });
  // Members only see clients of their projects (FR-ACL-07): this Member's project is under beta.
  const member = await createUser({ systemRole: 'MEMBER', email: 'scoped.member@xceler8.example' });
  await ProjectModel.create({
    name: 'Beta Rollout',
    clientId: beta!._id,
    managerId: pm._id,
    memberIds: [member._id],
  });
});

const ALL_CLIENTS = [
  ['Alpha Foods', 'Retail', 'Makati City\nMetro Manila', FORMULA, 'Active'],
  ['beta Logistics', 'Logistics', '', '', 'Active'],
  ['Hidden Corp', '', '', '', 'Active'],
  ['Zeta Old Co', '', '', '@SUM(A1)', 'Inactive'],
];
const ALL_CONTACTS = [
  ['Alpha Foods', 'Ana Cruz', '', 'ana@xceler8.example', '0917 123 4567', 'Finance', '+cmd|calc'],
  ['Alpha Foods', 'Zed Reyes', '-cmd', 'zed@xceler8.example', '+63 900 000 0000', '', ''],
  ['beta Logistics', 'No Email Person', 'Driver', '', '', '', ''],
  ['Hidden Corp', 'Hidden Person', '', 'hidden@xceler8.example', '', '', ''],
  ['Zeta Old Co', 'Former Contact', '', '', '', '', ''],
];

describe('Clients export: layout, file name and audit', () => {
  it('is the template layout (help row 1, headers row 2, locked) with the data from row 3', async () => {
    const { agent, user } = await signedInAs(app, 'ADMIN');
    const res = await fileOf(agent, EXPORT);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_MIME);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="clients-${phDateOf(new Date())}.xlsx"`,
    );
    expect(res.headers['content-disposition']).toMatch(/clients-\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = await load(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Clients', 'Contacts']);
    for (const sheet of ['Clients', 'Contacts'] as const) {
      const ws = wb.getWorksheet(sheet)!;
      const cols = CLIENT_IMPORT_COLUMNS[sheet];
      expect((ws.getRow(2).values as string[]).slice(1)).toEqual(cols.map((c) => c.header));
      expect((ws.getRow(1).values as string[]).slice(1)).toEqual(cols.map((c) => c.help));
      expect(ws.getCell('A1').protection?.locked).not.toBe(false);
      expect(ws.getCell('A2').protection?.locked).not.toBe(false);
      expect(ws.getCell('A3').protection?.locked).toBe(false);
      expect(ws.getCell('A3').numFmt).toBe('@');
    }
    expect(wb.getWorksheet('Clients')!.getCell('E3').dataValidation).toMatchObject({
      type: 'list',
      formulae: ['"Active,Inactive"'],
    });
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheetXml).toMatch(/<sheetProtection[^>]*sheet="1"/);

    // Clients by name (case ignored), inactive included; contacts by company, then name.
    expect(dataOf(wb, 'Clients')).toEqual(ALL_CLIENTS);
    expect(dataOf(wb, 'Contacts')).toEqual(ALL_CONTACTS);

    // FR-AUD-01: one entry per export, counts only (no customer values).
    const entries = await ActivityLogModel.find({
      action: 'clients_exported',
      actorId: user._id,
    }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityType: 'clientExport',
      meta: {
        fileName: `clients-${phDateOf(new Date())}.xlsx`,
        counts: { clients: 4, contacts: 5 },
      },
    });
    expect(JSON.stringify(entries[0])).not.toContain('Alpha Foods');
  });

  it('the blank template is still blank (template = export with no rows)', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const res = await fileOf(agent, '/api/v1/clients/import/template');
    const wb = await load(res.body as Buffer);
    expect(dataOf(wb, 'Clients')).toEqual([]);
    expect(dataOf(wb, 'Contacts')).toEqual([]);
    expect(res.headers['content-disposition']).toContain('OpsTrack-clients-template.xlsx');
  });
});

describe('Clients export: scope and access', () => {
  afterEach(() => resetRules());

  it('Admin and PM export every client (PMs see all clients, FR-ACL-07)', async () => {
    for (const role of ['ADMIN', 'PROJECT_MANAGER'] as const) {
      const { agent } = await signedInAs(app, role);
      const wb = await load((await fileOf(agent, EXPORT)).body as Buffer);
      expect(dataOf(wb, 'Clients').map((r) => r[0])).toEqual(ALL_CLIENTS.map((r) => r[0]));
      expect(dataOf(wb, 'Contacts')).toHaveLength(ALL_CONTACTS.length);
    }
  });

  it('Member and Viewer get 403 FORBIDDEN by default', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      const res = await agent.get(EXPORT);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('a Member given the four gates exports only the clients (and contacts) in their scope', async () => {
    await grant(app, 'MEMBER', { clients: allFour, contacts: allFour });
    const agent = await login(app, 'scoped.member@xceler8.example');
    const wb = await load((await fileOf(agent, EXPORT)).body as Buffer);
    expect(dataOf(wb, 'Clients')).toEqual([ALL_CLIENTS[1]]);
    expect(dataOf(wb, 'Contacts')).toEqual([ALL_CONTACTS[2]]);
    // And a Member with no projects exports an empty (template-like) workbook.
    const { agent: lonely } = await signedInAs(app, 'MEMBER');
    const empty = await load((await fileOf(lonely, EXPORT)).body as Buffer);
    expect(dataOf(empty, 'Clients')).toEqual([]);
    expect(dataOf(empty, 'Contacts')).toEqual([]);
  });

  it('without the signing key: 503 IMPORT_NOT_CONFIGURED, and a Member still gets 403 first', async () => {
    const noKey = makeApp({ CLIENT_IMPORT_TOKEN_SECRET: '' });
    const admin = await login(noKey, (await createUser({ systemRole: 'ADMIN' })).email);
    const res = await admin.get(EXPORT);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'IMPORT_NOT_CONFIGURED',
      message: 'Excel import isn’t set up yet. Ask an Admin.',
    });
    const member = await login(noKey, (await createUser({ systemRole: 'MEMBER' })).email);
    expect((await member.get(EXPORT)).status).toBe(403);
  });
});

describe('Clients export: formula safety and round trip (FR-CLI-37, EC-153, EC-156)', () => {
  it('formula-like values are plain text cells, never formulas', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const res = await fileOf(agent, EXPORT);
    const wb = await load(res.body as Buffer);
    const notes = wb.getWorksheet('Clients')!.getCell('D3');
    expect(notes.type).toBe(ExcelJS.ValueType.String);
    expect(notes.value).toBe(FORMULA);
    const contacts = wb.getWorksheet('Contacts')!;
    for (const ref of ['G3', 'C4', 'E4']) {
      expect(contacts.getCell(ref).type, ref).toBe(ExcelJS.ValueType.String);
    }
    const zip = await JSZip.loadAsync(res.body as Buffer);
    for (const name of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      expect(await zip.file(name)!.async('string')).not.toContain('<f>');
    }
  });

  it('an unedited export previews as all No change, and committing it changes nothing', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const buf = (await fileOf(agent, EXPORT)).body as Buffer;
    const before = {
      clients: await ClientModel.find().sort({ _id: 1 }).lean(),
      contacts: await ClientContactModel.find().sort({ _id: 1 }).lean(),
    };
    const p = await send(agent, 'preview', buf);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const body = p.body as ClientImportPreviewDto;
    expect(body.counts.clients).toEqual({ new: 0, update: 0, noChange: 4, error: 0 });
    expect(body.counts.contacts).toEqual({ new: 0, update: 0, noChange: 5, error: 0 });
    for (const r of [...body.clients, ...body.contacts]) {
      expect(r.reasons, JSON.stringify(r)).toEqual([]);
      expect(r.warnings, JSON.stringify(r)).toEqual([]);
    }
    // The "=" value is read back exactly as stored (not as a formula, no added apostrophe).
    expect(body.clients[0]!.values.Notes).toBe(FORMULA);

    const c = await send(agent, 'commit', buf, body.token);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect((c.body as ClientImportCommitDto).applied).toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
    });
    expect(await ClientModel.find().sort({ _id: 1 }).lean()).toEqual(before.clients);
    expect(await ClientContactModel.find().sort({ _id: 1 }).lean()).toEqual(before.contacts);
  });
});
