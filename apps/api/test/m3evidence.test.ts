import { MAX_UPLOAD_BYTES } from '@xc8/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityLogModel, DocumentModel, TaskModel, UploadModel } from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { resetRules, world, ptypeId } from './m2helpers.js';
import { FILES, completeWith, evidenceTicket, store, uploadEvidence } from './m3helpers.js';

/** Evidence uploads (doc 12 §3.2, TC-N03..N08). */
useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;

/** Member owns every task of the project. */
async function staffed(w: W) {
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items;
  for (const t of tasks) {
    const body: Record<string, unknown> = {
      version: t.version,
      ownerId: w.member.user._id.toString(),
    };
    if (t.party === 'CLIENT') body.clientContactId = w.acme.active[0].id;
    expect((await w.pm.agent.patch(`/api/v1/tasks/${t.id}`).set(CSRF).send(body)).status).toBe(200);
  }
  return (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
    phase: string;
  }[];
}

describe('TC-N03 / AC-39.1: allowed types', () => {
  it('accepts .pdf, .docx and .xlsx; refuses .png, .docm, .xlsm and links', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    for (const [name, data] of [
      ['report.pdf', FILES.pdf()],
      ['memo.docx', FILES.docx()],
      ['items.xlsx', FILES.xlsx()],
    ] as const) {
      const res = await uploadEvidence(w.member.agent, t1!.id, name, data);
      expect(res.status, name).toBe(201);
    }
    const task = (await w.member.agent.get(`/api/v1/tasks/${t1!.id}`)).body.task;
    expect(task.evidence.map((e: { name: string; type: string }) => [e.name, e.type])).toEqual([
      ['report.pdf', 'FILE'],
      ['memo.docx', 'FILE'],
      ['items.xlsx', 'FILE'],
    ]);
    expect(task.evidence[0]).toMatchObject({ mimeType: 'application/pdf', url: null });

    for (const name of ['screenshot.png', 'Macros.docm', 'Macros.xlsm']) {
      const res = await evidenceTicket(w.member.agent, t1!.id, name, 100);
      expect(res.status, name).toBe(422);
      expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    }
    expect(
      (await evidenceTicket(w.member.agent, t1!.id, 'Macros.xlsm', 100)).body.error.message,
    ).toBe("Macros.xlsm can't be added. Save it as .xlsx without macros.");
    const link = await w.member.agent
      .post(`/api/v1/tasks/${t1!.id}/evidence`)
      .set(CSRF)
      .send({ name: 'Doc', url: 'https://x.example/doc' });
    expect(link.status).toBe(422);
  });

  it('files are stored as documents in the task’s phase folder, linked to the task (FR-EVD-04, FR-DOC-17); same name twice keeps both (EC-60)', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    await uploadEvidence(w.member.agent, t1!.id, 'report.pdf', FILES.pdf());
    await uploadEvidence(w.member.agent, t1!.id, 'report.pdf', FILES.pdf());
    const folders = (await w.member.agent.get(`/api/v1/projects/${w.project.id}/folders`)).body
      .items;
    expect(folders.map((f: { name: string }) => f.name)).toEqual([
      'Contracts',
      'Phase A',
      'Phase B',
    ]);
    const phaseA = folders.find((f: { name: string }) => f.name === 'Phase A');
    expect(phaseA.documentCount).toBe(2);
    const docs = (
      await w.member.agent.get(`/api/v1/projects/${w.project.id}/documents?folderId=${phaseA.id}`)
    ).body.items;
    expect(docs.map((d: { name: string }) => d.name).sort()).toEqual([
      'report (2).pdf',
      'report.pdf',
    ]);
    expect(docs[0]).toMatchObject({ source: 'EVIDENCE', task: { id: t1!.id }, kind: 'PDF' });
    expect(docs[0].versions[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('FR-EVD-05: Viewers and non-owners can’t upload; Viewers can view and download', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    expect((await evidenceTicket(w.viewer.agent, t1!.id, 'a.pdf', 10)).status).toBe(403);
    expect((await evidenceTicket(w.pm2.agent, t1!.id, 'a.pdf', 10)).status).toBe(403);
    expect((await evidenceTicket(w.outsider.agent, t1!.id, 'a.pdf', 10)).status).toBe(404);
    const up = await uploadEvidence(w.member.agent, t1!.id, 'a.pdf', FILES.pdf());
    const ev = up.body.task.evidence[0].id;
    const dl = await w.viewer.agent.get(`/api/v1/tasks/${t1!.id}/evidence/${ev}/download`);
    expect(dl.status).toBe(200);
    expect(dl.body.fileName).toBe('a.pdf');
    // Signed links expire within 5 minutes (FR-DOC-41).
    const se = Number(
      new URL(dl.body.url.replace('memory://', 'http://x/')).searchParams.get('se'),
    );
    expect(se - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 1000);
  });
});

describe('TC-N04 / AC-39.2: the real type is checked from the content', () => {
  it('an .exe renamed report.pdf, a .zip renamed .docx and a .docm renamed .docx are refused', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    for (const [name, data] of [
      ['report.pdf', FILES.exe()],
      ['archive.docx', FILES.zipOnly()],
      ['sheet.xlsx', FILES.docx()],
      ['sneaky.docx', FILES.docm()],
    ] as const) {
      const res = await uploadEvidence(w.member.agent, t1!.id, name, data);
      expect(res.status, name).toBe(422);
      expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    }
    expect(
      (await uploadEvidence(w.member.agent, t1!.id, 'report.pdf', FILES.exe())).body.error.message,
    ).toBe("report.pdf isn't a real PDF, so it wasn't uploaded.");
    // Nothing recorded and the stored bytes are gone.
    expect(await DocumentModel.countDocuments({ projectId: w.project.id })).toBe(0);
    expect((await TaskModel.findById(t1!.id).lean())!.evidence).toHaveLength(0);
    expect([...store(app).blobs.keys()].filter((k) => k.includes(w.project.id))).toEqual([]);
  });
});

describe('TC-N05 / AC-39.3: size limit', () => {
  it('26,214,400 bytes is accepted; 26,214,401 gets 413; 0 bytes is refused', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    const exact = Buffer.alloc(MAX_UPLOAD_BYTES, 0x20);
    exact.write('%PDF-1.7\n', 0);
    const t = await evidenceTicket(w.member.agent, t1!.id, 'big.pdf', MAX_UPLOAD_BYTES);
    expect(t.status).toBe(201);
    expect((await completeWith(app, w.member.agent, t.body.uploads[0].id, exact)).status).toBe(201);

    const over = await evidenceTicket(
      w.member.agent,
      t1!.id,
      'Big_Export.xlsx',
      MAX_UPLOAD_BYTES + 1,
    );
    expect(over.status).toBe(413);
    expect(over.body.error.code).toBe('FILE_TOO_LARGE');

    // Declared small but stored too big: still 413 after upload, and the blob is deleted.
    const lie = await evidenceTicket(w.member.agent, t1!.id, 'lie.pdf', 100);
    const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x20);
    tooBig.write('%PDF-1.7\n', 0);
    const res = await completeWith(app, w.member.agent, lie.body.uploads[0].id, tooBig);
    expect(res.status).toBe(413);

    expect((await evidenceTicket(w.member.agent, t1!.id, 'empty.pdf', 0)).status).toBe(422);
    expect(
      (
        await w.member.agent
          .post(`/api/v1/tasks/${t1!.id}/evidence/uploads`)
          .set(CSRF)
          .send({
            files: Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.pdf`, size: 10 })),
          })
      ).status,
    ).toBe(400);
  });

  it('EC-59: an interrupted upload records nothing and can be retried', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    const t = await evidenceTicket(w.member.agent, t1!.id, 'a.pdf', 50);
    const id = t.body.uploads[0].id;
    const early = await w.member.agent.post(`/api/v1/uploads/${id}/complete`).set(CSRF).send({});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('UPLOAD_INCOMPLETE');
    expect(await DocumentModel.countDocuments({ projectId: w.project.id })).toBe(0);
    expect((await completeWith(app, w.member.agent, id, FILES.pdf())).status).toBe(201);
    // A ticket can't be completed by someone else, or twice.
    expect(
      (await w.pm.agent.post(`/api/v1/uploads/${id}/complete`).set(CSRF).send({})).status,
    ).toBe(404);
    expect(
      (await w.member.agent.post(`/api/v1/uploads/${id}/complete`).set(CSRF).send({})).status,
    ).toBe(404);
  });
});

describe('TC-N07: evidence of another project can’t be downloaded', () => {
  it('outsider gets 404; pm2 mixing their own task or project ids with another project’s evidence gets 404', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    const up = await uploadEvidence(w.member.agent, t1!.id, 'secret.pdf', FILES.pdf());
    const ev = up.body.task.evidence[0];
    // pm2's own project with their own task.
    const p2 = (
      await w.pm2.agent
        .post('/api/v1/projects')
        .set(CSRF)
        .send({
          projectTypeId: await ptypeId(),
          name: 'Other P',
          clientId: w.other.client.id,
          managerId: w.pm2.user._id.toString(),
          startDate: '2026-10-12',
          plannedEndDate: '2026-12-18',
          templateId: w.template.id,
        })
    ).body.project;
    const p2task = (await w.pm2.agent.get(`/api/v1/projects/${p2.id}/tasks`)).body.items[0];

    expect(
      (await w.outsider.agent.get(`/api/v1/tasks/${t1!.id}/evidence/${ev.id}/download`)).status,
    ).toBe(404);
    expect(
      (await w.pm2.agent.get(`/api/v1/tasks/${p2task.id}/evidence/${ev.id}/download`)).status,
    ).toBe(404);
    expect(
      (await w.pm2.agent.get(`/api/v1/projects/${p2.id}/documents/${ev.documentId}/download`))
        .status,
    ).toBe(404);
    expect(
      (
        await w.outsider.agent.get(
          `/api/v1/projects/${w.project.id}/documents/${ev.documentId}/download`,
        )
      ).status,
    ).toBe(404);
    // Blobs are private: the stored key isn't exposed, and only the signed link reaches it.
    expect(JSON.stringify(up.body)).not.toMatch(/projects\/[a-f0-9]{24}\/[a-f0-9]{24}/);
  });
});

describe('TC-N08 / Q-29: malware scanning', () => {
  it('the EICAR test file named test.pdf is refused, deleted and never downloadable', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    const res = await uploadEvidence(w.member.agent, t1!.id, 'test.pdf', FILES.eicar());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MALWARE_DETECTED');
    expect([...store(app).blobs.keys()].filter((k) => k.includes(w.project.id))).toEqual([]);
    expect(await DocumentModel.countDocuments({ projectId: w.project.id })).toBe(0);
    expect((await UploadModel.findOne({ fileName: 'test.pdf' }).lean())!.state).toBe('REJECTED');
    expect(await ActivityLogModel.exists({ action: 'upload_blocked_malware' })).toBeTruthy();
  });

  it('a file Defender for Storage later tags as malicious can’t be downloaded', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    const up = await uploadEvidence(w.member.agent, t1!.id, 'ok.pdf', FILES.pdf());
    const doc = await DocumentModel.findById(up.body.task.evidence[0].documentId).lean();
    const key = doc!.versions[0]!.blobKey;
    store(app).put(key, FILES.pdf(), { 'Malware Scanning scan result': 'Malicious' });
    const dl = await w.member.agent.get(
      `/api/v1/tasks/${t1!.id}/evidence/${up.body.task.evidence[0].id}/download`,
    );
    expect(dl.status).toBe(422);
    expect(dl.body.error.code).toBe('MALWARE_DETECTED');
  });
});

describe('FR-EVD-06/07: legacy links and locked evidence', () => {
  it('M2 link evidence stays readable as a LINK; files can’t be removed in For Review', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    await TaskModel.updateOne(
      { _id: t1!.id },
      {
        $set: { requiresApproval: true },
        $push: {
          evidence: {
            type: 'LINK',
            name: 'sharepoint',
            url: 'https://sp.example/x',
            at: new Date(),
          },
        },
      },
    );
    let task = (await w.member.agent.get(`/api/v1/tasks/${t1!.id}`)).body.task;
    expect(task.evidence[0]).toMatchObject({
      type: 'LINK',
      url: 'https://sp.example/x',
      documentId: null,
    });
    const up = await uploadEvidence(w.member.agent, t1!.id, 'signoff.pdf', FILES.pdf());
    const fileEv = up.body.task.evidence[1].id;
    for (const status of ['IN_PROGRESS', 'COMPLETED']) {
      task = (await w.member.agent.get(`/api/v1/tasks/${t1!.id}`)).body.task;
      const res = await w.member.agent
        .post(`/api/v1/tasks/${t1!.id}/status`)
        .set(CSRF)
        .send({ version: task.version, status });
      expect(res.status, status).toBe(200);
    }
    task = (await w.member.agent.get(`/api/v1/tasks/${t1!.id}`)).body.task;
    expect(task.status).toBe('FOR_REVIEW');
    const del = await w.member.agent.delete(`/api/v1/tasks/${t1!.id}/evidence/${fileEv}`).set(CSRF);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('EVIDENCE_LOCKED');
    // The reviewer (PM) is told it's waiting for review (FR-NTF-05).
    const n = (await w.pm.agent.get('/api/v1/notifications')).body.items;
    expect(n.map((x: { type: string }) => x.type)).toContain('FOR_REVIEW');
  });
});
