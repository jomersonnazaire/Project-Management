import type request from 'supertest';
import { parseDateOnly, toDateOnly, todayPH } from '@xc8/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityLogModel, DocumentModel, HolidayModel, UploadModel } from '../src/models/index.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';
import { FILES, store } from './m3helpers.js';

/**
 * Request a document (FR-DOC-20..26, AC-26.x, AC-27.4, EC-44/46), folder restrictions (FR-DOC-43)
 * (see m3holidays.test.ts for the holiday seed data).
 */
useDatabase();
const app = makeApp();
type Agent = ReturnType<typeof request.agent>;
type W = Awaited<ReturnType<typeof world>>;

// Dates are relative to today in Manila, so the tests don't depend on the day they run.
const day = (n: number) => toDateOnly(new Date(todayPH().getTime() + n * 86_400_000));
afterEach(async () => {
  await resetRules();
});

const base = (w: W) => `/api/v1/projects/${w.project.id}`;

async function folders(agent: Agent, w: W) {
  const res = await agent.get(`${base(w)}/folders`);
  return res.body.items as {
    id: string;
    name: string;
    kind: string;
    restricted: boolean;
    restrictedByParent: boolean;
    allowedUserIds: string[];
    canRestrict: boolean;
  }[];
}
async function folderId(w: W, name: string) {
  return (await folders(w.pm.agent, w)).find((f) => f.name === name)!.id;
}

function ask(agent: Agent, w: W, body: Record<string, unknown>) {
  return agent
    .post(`${base(w)}/documents/requests`)
    .set(CSRF)
    .send(body);
}
async function requestFromContact(agent: Agent, w: W, extra: Record<string, unknown> = {}) {
  const res = await ask(agent, w, {
    name: 'NDA – Acme Trading',
    folderId: await folderId(w, 'Contracts'),
    dueDate: day(3),
    requestedFrom: { kind: 'CONTACT', id: w.acme.active[0].id },
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.document;
}

/** Ticket + PUT (dev blob route); returns the ticket response and a `complete()` step. */
async function docTicket(agent: Agent, w: W, body: Record<string, unknown>, data = FILES.pdf()) {
  const name = (body.name as string) ?? 'file.pdf';
  const { name: _n, ...rest } = body;
  void _n;
  const t = await agent
    .post(`${base(w)}/documents/uploads`)
    .set(CSRF)
    .send({ file: { name, size: data.length }, ...rest });
  return {
    t,
    put: async () =>
      agent
        .put(t.body.upload.uploadUrl)
        .set(CSRF)
        .set('Content-Type', 'application/octet-stream')
        .send(data),
    complete: async () =>
      agent.post(`/api/v1/uploads/${t.body.upload.id}/complete`).set(CSRF).send({}),
  };
}
async function uploadDoc(agent: Agent, w: W, body: Record<string, unknown>, data = FILES.pdf()) {
  const s = await docTicket(agent, w, body, data);
  if (s.t.status !== 201) return s.t;
  expect((await s.put()).status).toBe(201);
  return s.complete();
}

describe('AC-26.1 / AC-26.2: Request a document form rules', () => {
  it('needs name, folder, due date and requested-from; a past due date is refused', async () => {
    const w = await world(app);
    const res = await ask(w.member.agent, w, {});
    expect(res.status).toBe(400);
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(expect.arrayContaining(['dueDate', 'folderId', 'name', 'requestedFrom']));

    const contracts = await folderId(w, 'Contracts');
    const past = await ask(w.member.agent, w, {
      name: 'NDA',
      folderId: contracts,
      dueDate: day(-1),
      requestedFrom: { kind: 'CONTACT', id: w.acme.active[0].id },
    });
    expect(past.status).toBe(400);
    expect(past.body.error).toMatchObject({
      code: 'DUE_DATE_PAST',
      message: 'The due date can’t be in the past.',
    });
    // Today (Philippine time) is allowed.
    const today = await ask(w.member.agent, w, {
      name: 'NDA',
      folderId: contracts,
      dueDate: day(0),
      requestedFrom: { kind: 'CONTACT', id: w.acme.active[0].id },
    });
    expect(today.status).toBe(201);
  });

  it('requested-from lists only project members and active contacts of the project’s client', async () => {
    const w = await world(app);
    const parties = (await w.member.agent.get(`${base(w)}/request-parties`)).body;
    expect(parties.users.map((u: { id: string }) => u.id).sort()).toEqual(
      [w.pm.user._id.toString(), w.member.user._id.toString()].sort(),
    );
    expect(parties.contacts.map((c: { name: string }) => c.name)).toEqual([
      'Ana Active',
      'Ben Active',
    ]);
    expect(parties.contacts[0].company).toBe(w.acme.client.name);

    const contracts = await folderId(w, 'Contracts');
    for (const from of [
      { kind: 'USER', id: w.outsider.user._id.toString() },
      { kind: 'CONTACT', id: w.acme.inactive.id },
      { kind: 'CONTACT', id: w.other.active[0].id },
    ]) {
      const res = await ask(w.member.agent, w, {
        name: 'X',
        folderId: contracts,
        dueDate: day(3),
        requestedFrom: from,
      });
      expect(res.status, JSON.stringify(from)).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUESTED_FROM');
    }
  });

  it('Viewers can’t request; outsiders get 404', async () => {
    const w = await world(app);
    const body = {
      name: 'X',
      folderId: await folderId(w, 'Contracts'),
      dueDate: day(3),
      requestedFrom: { kind: 'CONTACT', id: w.acme.active[0].id },
    };
    expect((await ask(w.viewer.agent, w, body)).status).toBe(403);
    expect((await ask(w.outsider.agent, w, body)).status).toBe(404);
  });
});

describe('AC-26.3: a saved request', () => {
  it('is Requested with no file, shows who it waits on, and logs "Requested by"', async () => {
    const w = await world(app);
    const doc = await requestFromContact(w.member.agent, w);
    expect(doc).toMatchObject({
      name: 'NDA – Acme Trading',
      status: 'REQUESTED',
      kind: null,
      latestVersion: 0,
      versions: [],
      requiresSignature: true, // on by default in Contracts
      request: {
        requestedBy: { id: w.member.user._id.toString() },
        requestedFrom: { kind: 'CONTACT', name: 'Ana Active', company: w.acme.client.name },
        dueDate: day(3),
        overdue: false,
        cancelled: null,
      },
      can: { cancel: true, upload: true },
    });
    expect(doc.events).toHaveLength(1);
    expect(doc.events[0]).toMatchObject({
      event: 'REQUESTED',
      actor: { id: w.member.user._id.toString() },
    });
    const log = await ActivityLogModel.findOne({
      action: 'document_requested',
      entityId: doc.id,
    }).lean();
    expect(log?.projectId?.toString()).toBe(w.project.id);

    const list = (await w.member.agent.get(`${base(w)}/documents`)).body;
    expect(list.counts).toMatchObject({ all: 1, REQUESTED: 1, SUBMITTED: 0, SIGNED: 0 });
    expect(list.can.request).toBe(true);
    const requested = (await w.member.agent.get(`${base(w)}/documents?status=REQUESTED`)).body;
    expect(requested.items).toHaveLength(1);
  });

  it('requires-signature is off by default outside Contracts; requests can come from team members', async () => {
    const w = await world(app);
    const res = await ask(w.pm.agent, w, {
      name: 'Item master list',
      folderId: await folderId(w, 'Phase A'),
      dueDate: day(6),
      requestedFrom: { kind: 'USER', id: w.member.user._id.toString() },
    });
    expect(res.status).toBe(201);
    expect(res.body.document).toMatchObject({
      requiresSignature: false,
      request: { requestedFrom: { kind: 'USER', id: w.member.user._id.toString() } },
    });
  });

  it('EC-44: an open request can be reassigned and rescheduled, never into the past', async () => {
    const w = await world(app);
    const doc = await requestFromContact(w.pm.agent, w);
    const res = await w.pm.agent
      .patch(`${base(w)}/documents/${doc.id}`)
      .set(CSRF)
      .send({ requestedFrom: { kind: 'CONTACT', id: w.acme.active[1].id }, dueDate: day(11) });
    expect(res.status).toBe(200);
    expect(res.body.document.request).toMatchObject({
      requestedFrom: { name: 'Ben Active' },
      dueDate: day(11),
    });
    const past = await w.pm.agent
      .patch(`${base(w)}/documents/${doc.id}`)
      .set(CSRF)
      .send({ dueDate: day(-8) });
    expect(past.status).toBe(400);
    const inactive = await w.pm.agent
      .patch(`${base(w)}/documents/${doc.id}`)
      .set(CSRF)
      .send({ requestedFrom: { kind: 'CONTACT', id: w.acme.inactive.id } });
    expect(inactive.status).toBe(400);
  });
});

describe('AC-27.4 / FR-DOC-21/22/25: fulfilling a request', () => {
  it('an upload that fulfils a request adds v1 and moves it to Submitted', async () => {
    const w = await world(app);
    const doc = await requestFromContact(w.pm.agent, w);
    const res = await uploadDoc(w.member.agent, w, {
      name: 'nda-draft.pdf',
      folderId: await folderId(w, 'Phase A'), // ignored: the request's folder wins
      status: 'SUBMITTED',
      fulfilsDocumentId: doc.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.document).toMatchObject({
      id: doc.id,
      name: 'NDA – Acme Trading',
      folderId: doc.folderId,
      status: 'SUBMITTED',
      kind: 'PDF',
      latestVersion: 1,
    });
    expect(res.body.document.versions[0]).toMatchObject({
      version: 1,
      fileName: 'nda-draft.pdf',
      status: 'SUBMITTED',
      signedBy: null,
    });
    expect(res.body.document.events.map((e: { event: string }) => e.event)).toEqual([
      'REQUESTED',
      'SUBMITTED',
    ]);
    expect(
      await ActivityLogModel.exists({ action: 'document_request_fulfilled', entityId: doc.id }),
    ).toBeTruthy();
    // Already fulfilled: a second "fulfils" upload is refused before anything is uploaded.
    const again = await docTicket(w.member.agent, w, {
      name: 'nda-2.pdf',
      folderId: doc.folderId,
      status: 'SUBMITTED',
      fulfilsDocumentId: doc.id,
    });
    expect(again.t.status).toBe(409);
    expect(again.t.body.error.code).toBe('REQUEST_FULFILLED');
  });

  it('a signed copy signed by a client contact records the contact as signer and the uploader as recorder', async () => {
    const w = await world(app);
    const doc = await requestFromContact(w.pm.agent, w);
    const res = await uploadDoc(w.member.agent, w, {
      name: 'nda-signed.pdf',
      folderId: doc.folderId,
      status: 'SIGNED',
      fulfilsDocumentId: doc.id,
      signedByContactId: w.acme.active[0].id,
    });
    expect(res.status).toBe(201);
    const d = res.body.document;
    expect(d).toMatchObject({ status: 'SIGNED', signedVersion: 1 });
    expect(d.versions[0]).toMatchObject({
      signedBy: { kind: 'CONTACT', name: 'Ana Active' },
      uploadedBy: { id: w.member.user._id.toString() },
    });
    expect(d.events[1]).toMatchObject({
      event: 'SIGNED',
      actor: { id: w.member.user._id.toString() },
      onBehalfOf: { kind: 'CONTACT', name: 'Ana Active', company: w.acme.client.name },
    });
    // Signed is locked (FR-DOC-30).
    const patch = await w.pm.agent
      .patch(`${base(w)}/documents/${doc.id}`)
      .set(CSRF)
      .send({ taskId: null });
    expect(patch.status).toBe(409);
  });

  it('signed-by needs status Signed and an active contact of this client', async () => {
    const w = await world(app);
    const contracts = await folderId(w, 'Contracts');
    const notSigned = await docTicket(w.member.agent, w, {
      name: 'a.pdf',
      folderId: contracts,
      status: 'SUBMITTED',
      signedByContactId: w.acme.active[0].id,
    });
    expect(notSigned.t.status).toBe(400);
    for (const id of [w.acme.inactive.id, w.other.active[0].id]) {
      const bad = await docTicket(w.member.agent, w, {
        name: 'a.pdf',
        folderId: contracts,
        status: 'SIGNED',
        signedByContactId: id,
      });
      expect(bad.t.status).toBe(400);
      expect(bad.t.body.error.code).toBe('INVALID_CONTACT');
    }
    // A direct signed upload (no request) can also be signed on behalf of a contact.
    const ok = await uploadDoc(w.member.agent, w, {
      name: 'msa.pdf',
      folderId: contracts,
      status: 'SIGNED',
      signedByContactId: w.acme.active[1].id,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.document.versions[0].signedBy.name).toBe('Ben Active');
    expect(ok.body.document.request).toBeNull();
  });

  it('a same-named upload never turns into a version of an open request', async () => {
    const w = await world(app);
    const doc = await requestFromContact(w.pm.agent, w, { name: 'Report.pdf' });
    const res = await uploadDoc(w.member.agent, w, {
      name: 'Report.pdf',
      folderId: doc.folderId,
      status: 'SUBMITTED',
    });
    expect(res.status).toBe(201);
    expect(res.body.document.id).not.toBe(doc.id);
    expect(res.body.document.name).toBe('Report (2).pdf');
    expect((await DocumentModel.findById(doc.id).lean())!.status).toBe('REQUESTED');
  });
});

describe('AC-26.5 / FR-DOC-23: cancelling a request', () => {
  it('needs a reason; only the requester or the PM can cancel; the request stays, read-only', async () => {
    const w = await world(app);
    const pmReq = await requestFromContact(w.pm.agent, w);
    const cancel = (agent: Agent, id: string, body: object) =>
      agent
        .post(`${base(w)}/documents/${id}/cancel`)
        .set(CSRF)
        .send(body);

    expect((await cancel(w.pm.agent, pmReq.id, {})).status).toBe(400);
    // A Member can't cancel someone else's request; Viewers never.
    const memberView = (await w.member.agent.get(`${base(w)}/documents/${pmReq.id}`)).body.document;
    expect(memberView.can.cancel).toBe(false);
    expect((await cancel(w.member.agent, pmReq.id, { reason: 'x' })).status).toBe(403);
    expect((await cancel(w.viewer.agent, pmReq.id, { reason: 'x' })).status).toBe(403);

    const res = await cancel(w.pm.agent, pmReq.id, { reason: 'Client sent it by email' });
    expect(res.status).toBe(200);
    expect(res.body.document).toMatchObject({
      status: 'CANCELLED',
      request: {
        cancelled: { by: { id: w.pm.user._id.toString() }, reason: 'Client sent it by email' },
      },
      can: { cancel: false, upload: false, edit: false },
    });
    expect(res.body.document.events.at(-1)).toMatchObject({
      event: 'CANCELLED',
      note: 'Client sent it by email',
    });
    expect(
      await ActivityLogModel.exists({ action: 'document_request_cancelled', entityId: pmReq.id }),
    ).toBeTruthy();

    // Read-only and still listed under All.
    expect((await cancel(w.pm.agent, pmReq.id, { reason: 'again' })).status).toBe(409);
    const patch = await w.pm.agent
      .patch(`${base(w)}/documents/${pmReq.id}`)
      .set(CSRF)
      .send({ dueDate: day(21) });
    expect(patch.status).toBe(409);
    const fulfil = await docTicket(w.member.agent, w, {
      name: 'nda.pdf',
      folderId: pmReq.folderId,
      status: 'SUBMITTED',
      fulfilsDocumentId: pmReq.id,
    });
    expect(fulfil.t.status).toBe(409);
    expect(fulfil.t.body.error).toMatchObject({
      code: 'REQUEST_CANCELLED',
      message: 'This request was cancelled.',
    });
    const all = (await w.member.agent.get(`${base(w)}/documents`)).body;
    expect(all.items.map((d: { status: string }) => d.status)).toEqual(['CANCELLED']);
    expect(all.counts).toMatchObject({ all: 1, CANCELLED: 1, REQUESTED: 0 });
  });

  it('a Member cancels their own request', async () => {
    const w = await world(app);
    const mine = await requestFromContact(w.member.agent, w);
    const res = await w.member.agent
      .post(`${base(w)}/documents/${mine.id}/cancel`)
      .set(CSRF)
      .send({ reason: 'Not needed' });
    expect(res.status).toBe(200);
  });

  it('EC-46: fulfilling a request cancelled a moment earlier is refused and nothing is kept', async () => {
    const w = await world(app);
    const doc = await requestFromContact(w.pm.agent, w);
    const s = await docTicket(w.member.agent, w, {
      name: 'nda.pdf',
      folderId: doc.folderId,
      status: 'SUBMITTED',
      fulfilsDocumentId: doc.id,
    });
    expect(s.t.status).toBe(201);
    expect((await s.put()).status).toBe(201);
    await w.pm.agent
      .post(`${base(w)}/documents/${doc.id}/cancel`)
      .set(CSRF)
      .send({ reason: 'Wrong document' });
    const done = await s.complete();
    expect(done.status).toBe(409);
    expect(done.body.error).toMatchObject({
      code: 'REQUEST_CANCELLED',
      message: 'This request was cancelled.',
    });
    const up = await UploadModel.findById(s.t.body.upload.id).lean();
    expect(up!.state).toBe('REJECTED');
    expect(await store(app).info(up!.blobKey)).toBeNull();
    const after = await DocumentModel.findById(doc.id).lean();
    expect(after!.versions).toHaveLength(0);
    expect(after!.status).toBe('CANCELLED');
  });
});

describe('FR-DOC-26 / AC-26.4: overdue requests', () => {
  it('client requests past due show in Dashboard "Waiting on client" and the contact’s overdue count', async () => {
    const w = await world(app);
    const nda = await requestFromContact(w.pm.agent, w, { dueDate: day(0) });
    await requestFromContact(w.pm.agent, w, { name: 'BP template', dueDate: day(1) });
    await ask(w.pm.agent, w, {
      name: 'Internal memo',
      folderId: await folderId(w, 'Phase A'),
      dueDate: day(0),
      requestedFrom: { kind: 'USER', id: w.member.user._id.toString() },
    });

    // Due today: not overdue yet.
    // Other tests' projects share the database (and PMs see every project): look at this one only.
    const waiting = async (agent: Agent = w.pm.agent) => {
      const body = (await agent.get('/api/v1/document-requests/waiting-on-client')).body;
      const items = body.items.filter(
        (i: { project: { id: string } }) => i.project.id === w.project.id,
      );
      return { items, overdue: items.filter((i: { overdue: boolean }) => i.overdue).length };
    };
    let list = await waiting();
    expect(list.overdue).toBe(0);
    expect(list.items.map((i: { name: string }) => i.name)).toEqual([
      'NDA – Acme Trading',
      'BP template',
    ]);

    // The NDA was due three days ago: 3d overdue, sorted first. (Moving the clock instead would
    // expire the test sessions.)
    await DocumentModel.updateOne({ _id: nda.id }, { $set: { dueDate: parseDateOnly(day(-3)) } });
    list = await waiting();
    expect(list.overdue).toBe(1);
    expect(list.items[0]).toMatchObject({
      id: nda.id,
      daysOverdue: 3,
      overdue: true,
      requestedFrom: { name: 'Ana Active', company: w.acme.client.name },
      client: { name: w.acme.client.name },
      project: { id: w.project.id },
      folder: { name: 'Contracts' },
    });
    expect(list.items[1]).toMatchObject({ name: 'BP template', daysOverdue: -1, overdue: false });
    const doc = (await w.pm.agent.get(`${base(w)}/documents/${nda.id}`)).body.document;
    expect(doc.request.overdue).toBe(true);

    // The contact's pending items and overdue count include the requests (FR-CLI-05).
    const contacts = (await w.pm.agent.get(`/api/v1/clients/${w.acme.client.id}/contacts`)).body
      .items;
    const ana = contacts.find((c: { name: string }) => c.name === 'Ana Active');
    expect(ana.pendingCount).toBeGreaterThanOrEqual(2);
    expect(ana.overdueCount).toBeGreaterThanOrEqual(1);

    // Outsiders don't see this project's requests; cancelled requests drop off.
    expect((await waiting(w.outsider.agent)).items).toEqual([]);
    await w.pm.agent
      .post(`${base(w)}/documents/${nda.id}/cancel`)
      .set(CSRF)
      .send({ reason: 'Received' });
    list = await waiting();
    expect(list.items.map((i: { name: string }) => i.name)).toEqual(['BP template']);
  });

  it('requests from a team member show in their "Requested from you" list (My tasks)', async () => {
    const w = await world(app);
    const memo = await ask(w.pm.agent, w, {
      name: 'Internal memo',
      folderId: await folderId(w, 'Phase A'),
      dueDate: day(0),
      requestedFrom: { kind: 'USER', id: w.member.user._id.toString() },
    });
    await requestFromContact(w.pm.agent, w);
    await DocumentModel.updateOne(
      { _id: memo.body.document.id },
      { $set: { dueDate: parseDateOnly(day(-1)) } },
    );
    const mineRes = await w.member.agent.get('/api/v1/document-requests/mine');
    expect(mineRes.status, JSON.stringify(mineRes.body)).toBe(200);
    const mine = mineRes.body;
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ name: 'Internal memo', daysOverdue: 1, overdue: true });
    expect(mine.overdue).toBe(1);
    expect((await w.pm.agent.get('/api/v1/document-requests/mine')).body.items).toEqual([]);
  });

  it('the Dashboard list needs Reports view', async () => {
    const w = await world(app);
    const { grant } = await import('./m2helpers.js');
    await grant(app, 'PROJECT_MANAGER', { reports: { view: false } });
    expect((await w.pm.agent.get('/api/v1/document-requests/waiting-on-client')).status).toBe(403);
  });
});

describe('FR-DOC-43: restricted folders', () => {
  async function setup() {
    const w = await world(app);
    const member2 = await signedInAs(app, 'MEMBER');
    const ids = [w.member, member2].map((x) => x.user._id.toString());
    expect((await w.pm.agent.patch(base(w)).set(CSRF).send({ memberIds: ids })).status).toBe(200);
    const contracts = await folderId(w, 'Contracts');
    const sub = (
      await w.pm.agent
        .post(`${base(w)}/folders`)
        .set(CSRF)
        .send({ name: 'Signed SOWs', parentId: contracts })
    ).body.folder.id;
    const doc = (
      await uploadDoc(w.member.agent, w, {
        name: 'SOW.pdf',
        folderId: contracts,
        status: 'SUBMITTED',
      })
    ).body.document;
    const subDoc = (
      await uploadDoc(w.member.agent, w, { name: 'SOW v2.pdf', folderId: sub, status: 'SUBMITTED' })
    ).body.document;
    const req = await requestFromContact(w.pm.agent, w);
    return { w, member2, contracts, sub, doc, subDoc, req };
  }
  const access = (agent: Agent, w: W, folder: string, body: object) =>
    agent
      .put(`${base(w)}/folders/${folder}/access`)
      .set(CSRF)
      .send(body);

  it('only the PM, Admins and picked members see a restricted folder, its sub-folders and documents', async () => {
    const { w, member2, contracts, sub, doc, subDoc, req } = await setup();
    const res = await access(w.pm.agent, w, contracts, {
      restricted: true,
      memberIds: [w.member.user._id.toString()],
    });
    expect(res.status).toBe(200);
    expect(
      await ActivityLogModel.exists({ action: 'folder_access_changed', entityId: contracts }),
    ).toBeTruthy();

    // PM, Admin and the picked member still see everything.
    for (const agent of [w.pm.agent, w.admin.agent, w.member.agent]) {
      const names = (await folders(agent, w)).map((f) => f.name);
      expect(names).toEqual(expect.arrayContaining(['Contracts', 'Signed SOWs']));
      expect((await agent.get(`${base(w)}/documents/${doc.id}`)).status).toBe(200);
    }
    const pmView = (await folders(w.pm.agent, w)).find((f) => f.id === contracts)!;
    expect(pmView).toMatchObject({
      restricted: true,
      allowedUserIds: [w.member.user._id.toString()],
      canRestrict: true,
    });
    expect((await folders(w.pm.agent, w)).find((f) => f.id === sub)!.restrictedByParent).toBe(true);
    // The picked member sees the folder but not who else is on it.
    expect(
      (await folders(w.member.agent, w)).find((f) => f.id === contracts)!.allowedUserIds,
    ).toEqual([]);

    // Everyone else: the folder, sub-folder and documents don't exist for them.
    for (const agent of [member2.agent, w.viewer.agent, w.pm2.agent]) {
      const names = (await folders(agent, w)).map((f) => f.name);
      expect(names).not.toContain('Contracts');
      expect(names).not.toContain('Signed SOWs');
      const list = (await agent.get(`${base(w)}/documents`)).body.items.map(
        (d: { id: string }) => d.id,
      );
      expect(list).not.toContain(doc.id);
      expect(list).not.toContain(subDoc.id);
      expect(list).not.toContain(req.id);
      expect((await agent.get(`${base(w)}/documents?q=SOW`)).body.items).toEqual([]);
      expect((await agent.get(`${base(w)}/documents?folderId=${contracts}`)).status).toBe(404);
      expect((await agent.get(`${base(w)}/documents/${doc.id}`)).status).toBe(404);
      expect((await agent.get(`${base(w)}/documents/${subDoc.id}/download`)).status).toBe(404);
    }
    // ...and can't put anything into it.
    const up = await docTicket(member2.agent, w, {
      name: 'x.pdf',
      folderId: contracts,
      status: 'SUBMITTED',
    });
    expect(up.t.status).toBe(400);
    expect(up.t.body.error.code).toBe('UNKNOWN_FOLDER');
    const fulfil = await docTicket(member2.agent, w, {
      name: 'x.pdf',
      folderId: contracts,
      status: 'SUBMITTED',
      fulfilsDocumentId: req.id,
    });
    expect(fulfil.t.status).toBe(400);
    const r2 = await ask(member2.agent, w, {
      name: 'X',
      folderId: sub,
      dueDate: day(3),
      requestedFrom: { kind: 'CONTACT', id: w.acme.active[0].id },
    });
    expect(r2.status).toBe(400);
    const sub2 = await member2.agent
      .post(`${base(w)}/folders`)
      .set(CSRF)
      .send({ name: 'Mine', parentId: contracts });
    expect(sub2.status).toBe(400);
    expect(
      (
        await member2.agent
          .patch(`${base(w)}/folders/${sub}`)
          .set(CSRF)
          .send({ name: 'Z' })
      ).status,
    ).toBeOneOf([403, 404]); // Members lack Edit on documents by default
    // Hidden requests don't show on member2's lists either.
    expect(
      (await member2.agent.get('/api/v1/document-requests/waiting-on-client')).body.items.filter(
        (i: { id: string }) => i.id === req.id,
      ),
    ).toEqual([]);

    // Lifting the restriction gives access back.
    expect((await access(w.pm.agent, w, contracts, { restricted: false })).status).toBe(200);
    expect((await member2.agent.get(`${base(w)}/documents/${doc.id}`)).status).toBe(200);
  });

  it('only the PM or an Admin can restrict; phase folders can’t be; only project members can be picked', async () => {
    const { w, member2, contracts } = await setup();
    expect(
      (await access(w.member.agent, w, contracts, { restricted: true, memberIds: [] })).status,
    ).toBe(403);
    expect(
      (await access(w.pm2.agent, w, contracts, { restricted: true, memberIds: [] })).status,
    ).toBe(403);
    const phaseA = await folderId(w, 'Phase A');
    const phase = await access(w.pm.agent, w, phaseA, { restricted: true, memberIds: [] });
    expect(phase.status).toBe(422);
    expect(phase.body.error.code).toBe('PHASE_FOLDER_OPEN');
    expect((await folders(w.pm.agent, w)).find((f) => f.id === phaseA)!.canRestrict).toBe(false);
    const outsider = await access(w.pm.agent, w, contracts, {
      restricted: true,
      memberIds: [w.outsider.user._id.toString()],
    });
    expect(outsider.status).toBe(400);
    expect(outsider.body.error.code).toBe('NOT_A_MEMBER');
    const ok = await access(w.admin.agent, w, contracts, {
      restricted: true,
      memberIds: [member2.user._id.toString()],
    });
    expect(ok.status).toBe(200);
  });
});
