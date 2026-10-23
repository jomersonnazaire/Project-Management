import {
  DAR_MAX_PDF_BYTES,
  DAR_NOTIFY_RECENT,
  DAR_PASSWORD_ONLY,
  DAR_SEND_RATE_LIMITED,
  DAR_SEND_UNCONFIRMED,
  DAR_TOO_LARGE,
  darResendConfirmMessage,
  darSendError,
  type DarReportDto,
} from '@xc8/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestTime } from '../src/lib/clock.js';
import {
  ActivityLogModel,
  NotificationModel,
  SavedReportModel,
  UserModel,
} from '../src/models/index.js';
import type * as DarExport from '../src/services/darExport.js';
import {
  GraphSendError,
  graphSendFailureReason,
  GraphSendUnknownError,
  sendMailAsUser,
  sendMailWithPdf,
} from '../src/services/graphMail.js';
import { buildDarCc, darMailContent } from '../src/services/darSend.js';
import { consentReason, msalMailFailureReason } from '../src/services/microsoftAuth.js';
import { MS_MAIL_COOKIE } from '../src/services/microsoftOAuthCookie.js';
import { CSRF, PASSWORD, createUser, login, makeApp, useDatabase } from './helpers.js';
useDatabase();

const MS_ENV: Record<string, string> = {
  MS_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  MS_CLIENT_ID: 'client-id-ms-test',
  MS_CLIENT_SECRET: 'ms-test-client-secret-32chars-minimum!!',
  MS_REDIRECT_URI: 'http://localhost:5173/api/auth/microsoft/callback',
  MS_ALLOWED_TENANT_IDS: '11111111-1111-1111-1111-111111111111',
  MS_ALLOWED_DOMAINS: 'xceler8.example',
  EDGE_PROXY_SECRET: 'edge-secret-for-ms-oauth-tests-0123456789ab',
};

const OID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TID = '11111111-1111-1111-1111-111111111111';
const MOCK_TOKEN = 'mock-mail-access-token-not-stored';

const loginUrlMock = vi.fn();
const mailExchangeMock = vi.fn();

const pdfMock = vi.fn<(...args: unknown[]) => Promise<Buffer> | null>(() => null);

vi.mock('../src/services/darExport.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof DarExport;
  return {
    ...actual,
    darToPdf: (...args: Parameters<typeof actual.darToPdf>) =>
      pdfMock(...args) ?? actual.darToPdf(...args),
  };
});

vi.mock('../src/services/microsoftAuth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    buildMicrosoftLoginUrl: (...args: unknown[]) => loginUrlMock(...args),
    exchangeMicrosoftMailCode: (...args: unknown[]) => mailExchangeMock(...args),
  };
});

async function saveReport(agent: ReturnType<typeof request.agent>, from: string, to: string) {
  const res = await agent.post('/api/v1/dar/saved').set(CSRF).send({ from, to });
  expect(res.status).toBe(201);
  return res.body.item.id as string;
}

let stateSeq = 0;

/** POST /send (with CSRF) and return the signed mail cookie and state it set. */
async function startSend(
  agent: ReturnType<typeof request.agent>,
  savedId: string,
  body: Record<string, unknown> = {},
) {
  stateSeq += 1;
  const state = `mail-state-${stateSeq}-${Date.now()}`;
  loginUrlMock.mockResolvedValueOnce({
    url: `https://login.microsoftonline.com/mock-mail?state=${state}`,
    codeVerifier: 'verifier-mail-123456789012345678901234567890',
    state,
    nonce: `nonce-${stateSeq}`,
  });
  const res = await agent.post(`/api/v1/dar/saved/${savedId}/send`).set(CSRF).send(body);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const raw = (Array.isArray(setCookie) ? setCookie : [setCookie ?? '']).join('; ');
  const cookie = /xc8_ms_mail=([^;]+)/.exec(raw)?.[1] ?? '';
  return { res, state, cookie };
}

function callback(a: Parameters<typeof request>[0], cookie: string, query: Record<string, string>) {
  const cb = request(a).get('/api/v1/auth/microsoft/callback').query(query);
  if (cookie) cb.set('Cookie', `${MS_MAIL_COOKIE}=${cookie}`);
  return cb;
}

const goodToken = (over: Record<string, unknown> = {}) => ({
  oid: OID,
  tid: TID,
  acct: 0,
  idp: `https://sts.windows.net/${TID}/`,
  accessToken: MOCK_TOKEN,
  scopes: ['Mail.Send'],
  ...over,
});

const graph202 = () =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));

const failedAudit = (savedId: string) =>
  ActivityLogModel.findOne({ action: 'report_send_failed', entityId: savedId }).lean();

async function setupLinkedMember() {
  const supervisor = await createUser({ email: 'sup@xceler8.example', name: 'Supervisor Sam' });
  const member = await createUser({
    email: 'mem@xceler8.example',
    systemRole: 'MEMBER',
  });
  await UserModel.updateOne(
    { _id: member._id },
    {
      $set: {
        supervisorId: supervisor._id,
        reportCc: ['cc1@xceler8.example', 'mem@xceler8.example'],
        msOid: OID,
        msTid: TID,
        authProvider: 'microsoft',
      },
    },
  );
  const a = makeApp(MS_ENV);
  const agent = await login(a, member.email, PASSWORD);
  return { a, agent, member, supervisor };
}

describe('DAR Send (Microsoft Mail.Send)', () => {
  beforeEach(async () => {
    loginUrlMock.mockReset();
    mailExchangeMock.mockReset();
    await ActivityLogModel.deleteMany({
      action: { $in: ['report_sent', 'report_send_failed', 'dar_supervisor_notified'] },
    });
    await NotificationModel.deleteMany({ type: 'DAR_READY' });
    // Fixed fixture emails and msOid/msTid are reused across tests.
    await UserModel.deleteMany({});
  });

  it('consentReason maps Microsoft errors', () => {
    expect(consentReason('access_denied', 'AADSTS65004: declined')).toBe('consent_declined');
    expect(consentReason('consent_required')).toBe('consent_declined');
    expect(consentReason('access_denied', 'AADSTS90094 admin')).toBe('admin_consent_required');
    expect(consentReason('access_denied', 'AADSTS65001')).toBe('admin_consent_required');
    expect(consentReason('server_error')).toBe('send_failed');
  });

  it('msalMailFailureReason maps MSAL errors', () => {
    expect(
      msalMailFailureReason({ errorCode: 'invalid_grant', errorMessage: 'AADSTS65001: x' }),
    ).toBe('admin_consent_required');
    expect(msalMailFailureReason(new Error('AADSTS90094: admin'))).toBe('admin_consent_required');
    expect(msalMailFailureReason({ errorCode: 'consent_required' })).toBe('consent_declined');
    expect(msalMailFailureReason(new Error('AADSTS65004: declined'))).toBe('consent_declined');
    expect(msalMailFailureReason(new Error('access_denied'))).toBe('consent_declined');
    expect(msalMailFailureReason(new Error('network down'))).toBeNull();
  });

  it('graphSendFailureReason maps no-mailbox errors', () => {
    expect(graphSendFailureReason(404, 'MailboxNotEnabledForRESTAPI')).toBe('no_mailbox');
    expect(graphSendFailureReason(400, 'MailboxNotSupportedForRESTAPI')).toBe('no_mailbox');
    expect(graphSendFailureReason(404, 'ResourceNotFound')).toBe('no_mailbox');
    expect(graphSendFailureReason(403, 'ErrorAccessDenied')).toBe('send_forbidden');
  });

  it('mail content: one date when start equals end, prefix shown once', () => {
    const report = {
      from: '2026-10-13',
      to: '2026-10-13',
      shownTo: '2026-10-13',
      totalActivities: 2,
      totalRendered: '03:30',
    } as DarReportDto;
    const { subject, html } = darMailContent('Mem Ber', report);
    expect(subject).toBe('DAR – Mem Ber – Oct 13, 2026');
    expect(html).toContain('<p><strong>Generated range:</strong> Oct 13, 2026</p>');
    expect(html.match(/Generated range:/g)).toHaveLength(1);
  });

  it('mail content: a real range uses the range format (and the shown end date)', () => {
    const base = { totalActivities: 5, totalRendered: '40:00' };
    const week = darMailContent('Mem Ber', {
      ...base,
      from: '2026-10-13',
      to: '2026-10-17',
      shownTo: null,
    } as DarReportDto);
    expect(week.subject).toBe('DAR – Mem Ber – Oct 13 to Oct 17, 2026');
    expect(week.html).toContain('<p><strong>Generated range:</strong> Oct 13 to Oct 17, 2026</p>');
    expect(week.html.match(/Generated range:/g)).toHaveLength(1);

    const shown = darMailContent('Mem Ber', {
      ...base,
      from: '2026-10-13',
      to: '2026-10-20',
      shownTo: '2026-10-16',
    } as DarReportDto);
    expect(shown.subject).toBe('DAR – Mem Ber – Oct 13 to Oct 16, 2026');

    const years = darMailContent('Mem Ber', {
      ...base,
      from: '2026-12-29',
      to: '2027-01-02',
      shownTo: null,
    } as DarReportDto);
    expect(years.subject).toBe('DAR – Mem Ber – Dec 29, 2026 to Jan 2, 2027');
    expect(years.html).toContain(
      '<p><strong>Generated range:</strong> Dec 29, 2026 to Jan 2, 2027</p>',
    );
  });

  it('PDF limit is 2.5 MB raw: over it is refused without calling Graph, at it is sent', async () => {
    expect(DAR_MAX_PDF_BYTES).toBe(2.5 * 1024 * 1024);
    const input = {
      subject: 's',
      html: '<p>x</p>',
      to: 'sup@xceler8.example',
      cc: [],
      fileName: 'dar.pdf',
    };
    const fetchSpy = graph202();
    const send = sendMailWithPdf('token', { ...input, pdf: Buffer.alloc(DAR_MAX_PDF_BYTES + 1) });
    await expect(send).rejects.toBeInstanceOf(GraphSendError);
    await expect(send).rejects.toMatchObject({
      status: 413,
      code: 'too_large',
      message: DAR_TOO_LARGE,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await sendMailWithPdf('token', { ...input, pdf: Buffer.alloc(DAR_MAX_PDF_BYTES) });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('send-status: ms off, not linked, no supervisor, ok', async () => {
    const off = makeApp({ ...MS_ENV, EDGE_PROXY_SECRET: '' });
    const u = await createUser();
    const agent = await login(off, u.email, PASSWORD);
    expect((await agent.get('/api/v1/dar/send-status')).body.reason).toBe('ms_disabled');

    const { agent: linked, member } = await setupLinkedMember();
    const ok = await linked.get('/api/v1/dar/send-status');
    expect(ok.body.enabled).toBe(true);
    expect(ok.body.to.email).toBe('sup@xceler8.example');
    expect(ok.body.cc).toEqual(['cc1@xceler8.example']);

    await UserModel.updateOne({ _id: member._id }, { $unset: { supervisorId: 1 } });
    expect((await linked.get('/api/v1/dar/send-status')).body.reason).toBe('no_supervisor');

    const plain = await createUser({ email: 'plain@xceler8.example' });
    const sup = await createUser({ email: 'sup2@xceler8.example' });
    await UserModel.updateOne({ _id: plain._id }, { $set: { supervisorId: sup._id } });
    const pa = await login(makeApp(MS_ENV), plain.email, PASSWORD);
    const nl = await pa.get('/api/v1/dar/send-status');
    expect(nl.body.reason).toBe('not_linked');
    expect(nl.body.canNotify).toBe(true);

    // Not linked is reported before no supervisor.
    await UserModel.updateOne({ _id: plain._id }, { $unset: { supervisorId: 1 } });
    expect((await pa.get('/api/v1/dar/send-status')).body.reason).toBe('not_linked');
  });

  it('happy path: POST returns the URL, callback sends once to To/CC, audit sent', async () => {
    const { a, agent, member } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { res: start, state, cookie } = await startSend(agent, savedId);
    expect(start.status).toBe(200);
    expect(start.body).toEqual({
      url: `https://login.microsoftonline.com/mock-mail?state=${state}`,
    });
    expect(loginUrlMock.mock.calls[0]?.[1]).toMatchObject({
      scopes: ['Mail.Send'],
      loginHint: member.email,
    });
    expect(cookie).toBeTruthy();

    mailExchangeMock.mockResolvedValueOnce(goodToken());
    const fetchSpy = graph202();
    const done = await callback(a, cookie, { code: 'mail-code', state });
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe(`http://localhost:5173/dar/saved?sent=${savedId}`);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
    const body = JSON.parse(String(init?.body));
    expect(body.saveToSentItems).toBe(true);
    // Recipients come from the server: supervisor on To, reportCc minus the sender on CC.
    expect(body.message.toRecipients).toEqual([
      { emailAddress: { address: 'sup@xceler8.example' } },
    ]);
    expect(body.message.ccRecipients).toEqual([
      { emailAddress: { address: 'cc1@xceler8.example' } },
    ]);
    expect(body.message.from).toBeUndefined();
    expect(body.message.bccRecipients).toBeUndefined();
    expect(body.message.subject).toBe(`DAR – ${member.name} – Oct 13, 2026`);
    expect(body.message.body.content).toContain(
      '<p><strong>Generated range:</strong> Oct 13, 2026</p>',
    );
    expect(body.message.body.content.match(/Generated range:/g)).toHaveLength(1);
    expect(body.message.attachments).toHaveLength(1);
    expect(body.message.attachments[0]['@odata.type']).toContain('fileAttachment');
    expect(body.message.attachments[0].name).toBe('DAR_2026-10-13.pdf');
    expect(
      Buffer.from(body.message.attachments[0].contentBytes, 'base64').slice(0, 4).toString(),
    ).toBe('%PDF');

    const audit = await ActivityLogModel.findOne({ action: 'report_sent', entityId: savedId });
    expect(audit?.meta).toMatchObject({ to: 'sup@xceler8.example', cc: ['cc1@xceler8.example'] });
    const users = await UserModel.find().lean();
    expect(JSON.stringify(users)).not.toContain(MOCK_TOKEN);
    fetchSpy.mockRestore();
  });

  it('AC-57.6: uses the current supervisor and CC, not the saved copy', async () => {
    const { a, agent, member } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const newSup = await createUser({ email: 'newsup@xceler8.example', name: 'New Sup' });
    await UserModel.updateOne(
      { _id: member._id },
      {
        $set: {
          supervisorId: newSup._id,
          reportCc: [
            'CC2@xceler8.example',
            'cc2@xceler8.example',
            'newsup@xceler8.example',
            'mem@xceler8.example',
          ],
        },
      },
    );
    const { state, cookie } = await startSend(agent, savedId);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    const fetchSpy = graph202();
    const done = await callback(a, cookie, { code: 'c', state });
    expect(done.headers.location).toContain(`sent=${savedId}`);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body));
    expect(body.message.toRecipients).toEqual([
      { emailAddress: { address: 'newsup@xceler8.example' } },
    ]);
    expect(body.message.ccRecipients).toEqual([
      { emailAddress: { address: 'cc2@xceler8.example' } },
    ]);
    fetchSpy.mockRestore();
  });

  it('CC outside our domain is never blocked: shown on send-status and sent on CC (Jomerson, Oct 22)', async () => {
    const { a, agent, member } = await setupLinkedMember();
    // MS_ALLOWED_DOMAINS is xceler8.example; that list only governs Microsoft sign-in.
    await UserModel.updateOne(
      { _id: member._id },
      { $set: { reportCc: ['cc1@xceler8.example', 'Partner@Client.example.org'] } },
    );
    const status = await agent.get('/api/v1/dar/send-status');
    expect(status.body.enabled).toBe(true);
    expect(status.body.cc).toEqual(['cc1@xceler8.example', 'partner@client.example.org']);

    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, savedId);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    const fetchSpy = graph202();
    const done = await callback(a, cookie, { code: 'c', state });
    expect(done.headers.location).toContain(`sent=${savedId}`);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body));
    expect(body.message.ccRecipients).toEqual([
      { emailAddress: { address: 'cc1@xceler8.example' } },
      { emailAddress: { address: 'partner@client.example.org' } },
    ]);
    const audit = await ActivityLogModel.findOne({ action: 'report_sent', entityId: savedId });
    expect(audit?.meta).toMatchObject({
      cc: ['cc1@xceler8.example', 'partner@client.example.org'],
    });
    fetchSpy.mockRestore();
  });

  it('buildDarCc keeps outside-domain addresses (only drops To, the sender and repeats)', () => {
    const cc = buildDarCc(
      {
        reportCc: ['a@client.example.org', 'sup@xceler8.example', 'A@client.example.org'],
      } as never,
      'sup@xceler8.example',
      'mem@xceler8.example',
    );
    expect(cc).toEqual(['a@client.example.org']);
  });

  it('D1: Send is not a GET, and the POST needs the CSRF header and an allowed Origin', async () => {
    const { agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const get = await agent
      .get(`/api/v1/dar/saved/${savedId}/send`)
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site');
    expect(get.status).toBe(404);
    expect(get.headers.location).toBeUndefined();

    const noHeader = await agent.post(`/api/v1/dar/saved/${savedId}/send`).send({});
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe('CSRF_REJECTED');

    const foreign = await agent
      .post(`/api/v1/dar/saved/${savedId}/send`)
      .set(CSRF)
      .set('Origin', 'https://evil.example')
      .send({});
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('CSRF_REJECTED');

    const extra = await agent
      .post(`/api/v1/dar/saved/${savedId}/send`)
      .set(CSRF)
      .send({ to: 'attacker@evil.example' });
    expect(extra.status).toBe(400);
    expect(loginUrlMock).not.toHaveBeenCalled();
    expect(
      await ActivityLogModel.exists({ action: 'report_send_failed', entityId: savedId }),
    ).toBeNull();
  });

  it('AC-57.2 / another user: unsaved or foreign ids get 404 on send and notify', async () => {
    const { agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const other = await createUser({ email: 'other@xceler8.example' });
    const sup = await createUser({ email: 'othersup@xceler8.example' });
    await UserModel.updateOne({ _id: other._id }, { $set: { supervisorId: sup._id } });
    const oa = await login(makeApp(MS_ENV), other.email, PASSWORD);
    expect((await oa.post(`/api/v1/dar/saved/${savedId}/send`).set(CSRF).send({})).status).toBe(
      404,
    );
    expect(
      (await oa.post(`/api/v1/dar/saved/${savedId}/notify-supervisor`).set(CSRF).send({})).status,
    ).toBe(404);
    // A report id that was never saved.
    expect(
      (await agent.post('/api/v1/dar/saved/652f00000000000000000000/send').set(CSRF).send({}))
        .status,
    ).toBe(404);
    expect(loginUrlMock).not.toHaveBeenCalled();
    expect(await NotificationModel.countDocuments({ type: 'DAR_READY' })).toBe(0);
  });

  it('D6: early refusals (not linked, no supervisor, MS off) answer 409 and are audited', async () => {
    const plain = await createUser({ email: 'plain@xceler8.example' });
    const sup = await createUser({ email: 'plainsup@xceler8.example' });
    await UserModel.updateOne({ _id: plain._id }, { $set: { supervisorId: sup._id } });
    const pa = await login(makeApp(MS_ENV), plain.email, PASSWORD);
    const s1 = await saveReport(pa, '2026-10-13', '2026-10-13');
    const nl = await pa.post(`/api/v1/dar/saved/${s1}/send`).set(CSRF).send({});
    expect(nl.status).toBe(409);
    expect(nl.body.error).toMatchObject({
      code: 'SEND_UNAVAILABLE',
      message: `Your report wasn't sent. ${DAR_PASSWORD_ONLY}`,
    });
    expect((await failedAudit(s1))?.meta).toMatchObject({ reason: 'not_linked' });

    const { agent, member } = await setupLinkedMember();
    await UserModel.updateOne({ _id: member._id }, { $unset: { supervisorId: 1 } });
    const s2 = await saveReport(agent, '2026-10-13', '2026-10-13');
    const ns = await agent.post(`/api/v1/dar/saved/${s2}/send`).set(CSRF).send({});
    expect(ns.status).toBe(409);
    expect(ns.body.error.message).toBe(
      "Your report wasn't sent. Ask an Admin to set your supervisor.",
    );
    expect((await failedAudit(s2))?.meta).toMatchObject({ reason: 'no_supervisor' });

    const off = makeApp({ ...MS_ENV, EDGE_PROXY_SECRET: '' });
    const oa = await login(off, member.email, PASSWORD);
    const s3 = await saveReport(oa, '2026-10-13', '2026-10-13');
    expect((await oa.post(`/api/v1/dar/saved/${s3}/send`).set(CSRF).send({})).status).toBe(409);
    expect((await failedAudit(s3))?.meta).toMatchObject({ reason: 'not_enabled' });
    expect(loginUrlMock).not.toHaveBeenCalled();
  });

  it('AC-57.3: a PDF over 2.5 MB is refused at the callback, nothing sent, audited', async () => {
    const { a, agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, savedId);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    pdfMock.mockImplementationOnce(async () => Buffer.alloc(DAR_MAX_PDF_BYTES + 1));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const done = await callback(a, cookie, { code: 'c', state });
    expect(done.headers.location).toBe(
      `http://localhost:5173/dar/saved?send_error=too_large&report=${savedId}`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await failedAudit(savedId))?.meta).toMatchObject({
      reason: 'too_large',
      graphStatus: 413,
    });
    expect(await ActivityLogModel.exists({ action: 'report_sent' })).toBeNull();
    fetchSpy.mockRestore();
  });

  it('AC-57.7: Graph says no mailbox: one call, no_mailbox, audited', async () => {
    const { a, agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, savedId);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'MailboxNotEnabledForRESTAPI' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const done = await callback(a, cookie, { code: 'c', state });
    expect(done.headers.location).toBe(
      `http://localhost:5173/dar/saved?send_error=no_mailbox&report=${savedId}`,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await failedAudit(savedId))?.meta).toMatchObject({
      reason: 'no_mailbox',
      graphStatus: 404,
      graphCode: 'MailboxNotEnabledForRESTAPI',
    });
    fetchSpy.mockRestore();
  });

  it('wrong account (oid, tid or guest) is refused before Graph', async () => {
    const { a, agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const over of [
      { oid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { tid: '22222222-2222-2222-2222-222222222222' },
      { acct: 1 },
    ]) {
      const { state, cookie } = await startSend(agent, savedId);
      mailExchangeMock.mockResolvedValueOnce(goodToken(over));
      const done = await callback(a, cookie, { code: 'c', state });
      expect(done.headers.location).toBe(
        `http://localhost:5173/dar/saved?send_error=wrong_account&report=${savedId}`,
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      await ActivityLogModel.countDocuments({
        action: 'report_send_failed',
        'meta.reason': 'wrong_account',
      }),
    ).toBe(3);
    fetchSpy.mockRestore();
  });

  it('a token without Mail.Send is treated as consent declined', async () => {
    const { a, agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, savedId);
    mailExchangeMock.mockResolvedValueOnce(goodToken({ scopes: ['openid', 'profile'] }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const done = await callback(a, cookie, { code: 'c', state });
    expect(done.headers.location).toBe(
      `http://localhost:5173/dar/saved?send_error=consent_declined&report=${savedId}`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await failedAudit(savedId))?.meta).toMatchObject({ reason: 'consent_declined' });
    fetchSpy.mockRestore();
  });

  it('consent declined at Microsoft: no Graph, audited', async () => {
    const { a, agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, savedId);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await callback(a, cookie, { error: 'access_denied', state });
    expect(res.headers.location).toMatch(/send_error=consent_declined/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mailExchangeMock).not.toHaveBeenCalled();
    expect((await failedAudit(savedId))?.meta).toMatchObject({ reason: 'consent_declined' });
    fetchSpy.mockRestore();
  });

  it('tampered, missing or mismatched mail cookie sends nothing', async () => {
    const { a, agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, savedId);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const [payload] = cookie.split('.');
    const forged = JSON.parse(Buffer.from(decodeURIComponent(payload!), 'base64url').toString());
    forged.savedReportId = '652f00000000000000000000';
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${cookie.split('.')[1]}`;
    for (const c of [tampered, '', `${cookie.slice(0, -2)}xx`]) {
      const res = await callback(a, c, { code: 'c', state });
      expect(res.headers.location).toBe('http://localhost:5173/login?error=ms_signin_failed');
    }
    // Right cookie, wrong state.
    const wrong = await callback(a, cookie, { code: 'c', state: 'not-the-state' });
    expect(wrong.headers.location).toBe('http://localhost:5173/login?error=ms_signin_failed');
    expect(mailExchangeMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('a replayed callback (same cookie and state) sends nothing the second time', async () => {
    const { a, agent } = await setupLinkedMember();
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, savedId);
    mailExchangeMock.mockResolvedValue(goodToken());
    const fetchSpy = graph202();
    expect((await callback(a, cookie, { code: 'c', state })).headers.location).toContain('sent=');
    const replay = await callback(a, cookie, { code: 'c', state });
    expect(replay.headers.location).toBe(
      `http://localhost:5173/dar/saved?send_error=send_failed&report=${savedId}`,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mailExchangeMock).toHaveBeenCalledTimes(1);
    expect((await failedAudit(savedId))?.meta).toMatchObject({ detail: 'state_reused' });
    fetchSpy.mockRestore();
  });

  it('D5: Send has its own per-user limiter, separate from sign-in', async () => {
    const supervisor = await createUser({ email: 'sup@xceler8.example' });
    const mk = async (email: string) => {
      const u = await createUser({ email });
      await UserModel.updateOne(
        { _id: u._id },
        {
          $set: {
            supervisorId: supervisor._id,
            msOid: email === 'm1@xceler8.example' ? OID : 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            msTid: TID,
          },
        },
      );
      return u;
    };
    const m1 = await mk('m1@xceler8.example');
    const m2 = await mk('m2@xceler8.example');
    // The sign-in bucket allows 2 requests: the two logins below use it up.
    const a = makeApp({ ...MS_ENV, DAR_SEND_RATE_LIMIT_MAX: '2', AUTH_RATE_LIMIT_MAX: '2' });
    const g1 = await login(a, m1.email, PASSWORD);
    const g2 = await login(a, m2.email, PASSWORD);
    const s1 = await saveReport(g1, '2026-10-13', '2026-10-13');
    const s2 = await saveReport(g2, '2026-10-13', '2026-10-13');

    const first = await startSend(g1, s1);
    expect(first.res.status).toBe(200);
    // The Send leg of the callback doesn't count against (or get blocked by) sign-in.
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    const fetchSpy = graph202();
    const cb = await callback(a, first.cookie, { code: 'c', state: first.state });
    expect(cb.headers.location).toContain(`sent=${s1}`);
    fetchSpy.mockRestore();

    // Sent a moment ago: a re-send needs confirmResend (it still counts against the limiter).
    expect((await startSend(g1, s1, { confirmResend: true })).res.status).toBe(200);
    const limited = await startSend(g1, s1, { confirmResend: true });
    expect(limited.res.status).toBe(429);
    expect(limited.res.body.error).toMatchObject({
      code: 'DAR_SEND_RATE_LIMITED',
      message: DAR_SEND_RATE_LIMITED,
    });
    // Another user has their own bucket.
    expect((await startSend(g2, s2)).res.status).toBe(200);
    // Sign-in has its own bucket too (used up by the two logins, not by Send).
    const signIn = await request(a)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: m1.email, password: PASSWORD });
    expect(signIn.status).toBe(429);
    expect(signIn.body.error.message).toMatch(/Too many sign-in attempts/);
  });

  it('notify supervisor: DAR_READY, audit, linked user 409', async () => {
    const supervisor = await createUser({ email: 'supn@xceler8.example' });
    const member = await createUser({ email: 'memn@xceler8.example' });
    await UserModel.updateOne({ _id: member._id }, { $set: { supervisorId: supervisor._id } });
    const a = makeApp(MS_ENV);
    const agent = await login(a, member.email, PASSWORD);
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const ok = await agent
      .post(`/api/v1/dar/saved/${savedId}/notify-supervisor`)
      .set(CSRF)
      .send({});
    expect(ok.status).toBe(200);
    expect(ok.body.notified).toBe(1);
    const n = await NotificationModel.findOne({ userId: supervisor._id, type: 'DAR_READY' });
    expect(n?.message).toContain('exported PDF');
    expect(n?.link).toBeNull();

    await UserModel.updateOne({ _id: member._id }, { $set: { msOid: OID, msTid: TID } });
    expect(
      (await agent.post(`/api/v1/dar/saved/${savedId}/notify-supervisor`).set(CSRF).send({}))
        .status,
    ).toBe(409);
  });

  it('notify: no supervisor or inactive supervisor 409, body must be empty', async () => {
    const member = await createUser({ email: 'memx@xceler8.example' });
    const a = makeApp(MS_ENV);
    const agent = await login(a, member.email, PASSWORD);
    const savedId = await saveReport(agent, '2026-10-13', '2026-10-13');
    const post = (body: object = {}) =>
      agent.post(`/api/v1/dar/saved/${savedId}/notify-supervisor`).set(CSRF).send(body);

    const none = await post();
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('NO_SUPERVISOR');

    const sup = await createUser({ email: 'inactive-sup@xceler8.example', active: false });
    await UserModel.updateOne({ _id: member._id }, { $set: { supervisorId: sup._id } });
    const inactive = await post();
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe('NO_SUPERVISOR');

    await UserModel.updateOne({ _id: sup._id }, { $set: { active: true } });
    expect((await post({ to: 'someone@evil.example' })).status).toBe(400);
    expect(await NotificationModel.countDocuments({ type: 'DAR_READY' })).toBe(0);
  });

  it('D7: notify is limited to one notice per report per hour', async () => {
    const supervisor = await createUser({ email: 'supd@xceler8.example' });
    const member = await createUser({ email: 'memd@xceler8.example' });
    await UserModel.updateOne({ _id: member._id }, { $set: { supervisorId: supervisor._id } });
    const agent = await login(makeApp(MS_ENV), member.email, PASSWORD);
    const s1 = await saveReport(agent, '2026-10-13', '2026-10-13');
    const s2 = await saveReport(agent, '2026-10-14', '2026-10-14');
    const post = (id: string) =>
      agent.post(`/api/v1/dar/saved/${id}/notify-supervisor`).set(CSRF).send({});

    expect((await post(s1)).status).toBe(200);
    const again = await post(s1);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'NOTIFY_RECENT', message: DAR_NOTIFY_RECENT });
    // Two presses at once still give one notice.
    const both = await Promise.all([post(s2), post(s2)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await NotificationModel.countDocuments({ userId: supervisor._id, type: 'DAR_READY' }),
    ).toBe(2);

    // After an hour, notifying again works.
    await ActivityLogModel.updateMany(
      { action: 'dar_supervisor_notified', entityId: s1 },
      { $set: { at: new Date(Date.now() - 61 * 60 * 1000) } },
    );
    expect((await post(s1)).status).toBe(200);
  });
});

describe('DAR sent status on saved reports', () => {
  beforeEach(async () => {
    loginUrlMock.mockReset();
    mailExchangeMock.mockReset();
    await ActivityLogModel.deleteMany({
      action: { $in: ['report_sent', 'report_send_failed', 'dar_supervisor_notified'] },
    });
    await UserModel.deleteMany({});
  });
  afterEach(() => setTestTime(null));
  // Times near the real clock, so sessions stay valid whenever the suite runs.
  const soon = (minutes: number) => {
    const d = new Date(Math.floor(Date.now() / 60_000) * 60_000 + minutes * 60_000);
    return d.toISOString();
  };

  const listItem = async (agent: ReturnType<typeof request.agent>, id: string, q = '') => {
    const res = await agent.get(`/api/v1/dar/saved${q}`);
    expect(res.status).toBe(200);
    return (res.body.items as { id: string }[]).find((i) => i.id === id) as
      Record<string, unknown> | undefined;
  };

  async function sendOk(
    a: Parameters<typeof request>[0],
    agent: ReturnType<typeof request.agent>,
    id: string,
    body: Record<string, unknown> = {},
  ) {
    const { state, cookie } = await startSend(agent, id, body);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    const fetchSpy = graph202();
    const done = await callback(a, cookie, { code: 'c', state });
    fetchSpy.mockRestore();
    return done;
  }

  it('a new report is "not sent": the list and the item return null sent fields', async () => {
    const { agent } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    expect(await listItem(agent, id)).toMatchObject({
      sentAt: null,
      sentBy: null,
      sentRecipientCount: null,
    });
    const one = await agent.get(`/api/v1/dar/saved/${id}`);
    expect(one.body.item).toMatchObject({ sentAt: null, sentBy: null, sentRecipientCount: null });
  });

  it('a successful send records sentAt, sentBy and the recipient count; a re-send updates sentAt', async () => {
    const { a, agent, member } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const t1 = soon(1);
    setTestTime(t1);
    const done = await sendOk(a, agent, id);
    expect(done.headers.location).toBe(`http://localhost:5173/dar/saved?sent=${id}`);
    // To (supervisor) + 1 CC (the sender's own address is dropped from CC).
    const expected = {
      sentAt: t1,
      sentBy: member._id.toString(),
      sentRecipientCount: 2,
    };
    expect(await listItem(agent, id)).toMatchObject(expected);
    expect((await agent.get(`/api/v1/dar/saved/${id}`)).body.item).toMatchObject(expected);
    // Only the count is stored on the report, never the addresses.
    const doc = await SavedReportModel.findById(id).lean();
    expect(JSON.stringify({ ...doc, report: null })).not.toContain('@xceler8.example');

    const t2 = soon(6);
    setTestTime(t2);
    await sendOk(a, agent, id, { confirmResend: true });
    expect(await listItem(agent, id)).toMatchObject({ sentAt: t2 });
  });

  it('a failed send records nothing and keeps an earlier successful send', async () => {
    const { a, agent } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, id);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: 403 }),
      );
    const done = await callback(a, cookie, { code: 'c', state });
    fetchSpy.mockRestore();
    expect(done.headers.location).toContain('send_error=');
    expect(await listItem(agent, id)).toMatchObject({ sentAt: null, sentRecipientCount: null });
    expect((await SavedReportModel.findById(id).lean())?.sentAt ?? null).toBeNull();

    // Consent declined after a good send: the good send stays.
    const t1 = soon(1);
    setTestTime(t1);
    await sendOk(a, agent, id);
    const again = await startSend(agent, id, { confirmResend: true });
    expect(again.res.status).toBe(200);
    await callback(a, again.cookie, { error: 'access_denied', state: again.state });
    expect(await listItem(agent, id)).toMatchObject({ sentAt: t1 });
  });

  it('the mail is out even if recording fails: success redirect, audit fallback shows it sent', async () => {
    const { a, agent } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const spy = vi.spyOn(SavedReportModel, 'updateOne').mockRejectedValueOnce(new Error('db blip'));
    const done = await sendOk(a, agent, id);
    spy.mockRestore();
    expect(done.headers.location).toBe(`http://localhost:5173/dar/saved?sent=${id}`);
    expect((await SavedReportModel.findById(id).lean())?.sentAt ?? null).toBeNull();
    expect(await listItem(agent, id)).toMatchObject({ sentRecipientCount: 2 });
    expect((await listItem(agent, id))?.sentAt).toEqual(expect.any(String));
  });

  it('reports sent before this change: a report_sent audit entry fills the status on read', async () => {
    const { agent, member } = await setupLinkedMember();
    const old = await saveReport(agent, '2026-10-13', '2026-10-13');
    const failed = await saveReport(agent, '2026-10-14', '2026-10-14');
    const at = new Date('2026-10-20T02:00:00.000Z');
    await ActivityLogModel.create([
      {
        actorId: member._id,
        entityType: 'savedReport',
        entityId: old,
        action: 'report_sent',
        meta: { to: 'sup@xceler8.example', cc: ['a@x.example', 'b@x.example'] },
        at: new Date('2026-10-19T02:00:00.000Z'),
      },
      {
        actorId: member._id,
        entityType: 'savedReport',
        entityId: old,
        action: 'report_sent',
        meta: { to: 'sup@xceler8.example', cc: ['a@x.example'] },
        at,
      },
      {
        actorId: member._id,
        entityType: 'savedReport',
        entityId: failed,
        action: 'report_send_failed',
        meta: { reason: 'no_mailbox' },
        at,
      },
    ]);
    expect(await listItem(agent, old)).toMatchObject({
      sentAt: at.toISOString(),
      sentBy: member._id.toString(),
      sentRecipientCount: 2,
    });
    expect(await listItem(agent, failed)).toMatchObject({ sentAt: null });
  });

  it('the sent filter returns only sent or only not-sent reports', async () => {
    const { a, agent } = await setupLinkedMember();
    const s = await saveReport(agent, '2026-10-13', '2026-10-13');
    const n = await saveReport(agent, '2026-10-14', '2026-10-14');
    await sendOk(a, agent, s);
    const ids = async (q: string) =>
      ((await agent.get(`/api/v1/dar/saved${q}`)).body.items as { id: string }[]).map((i) => i.id);
    expect(await ids('?sent=SENT')).toEqual([s]);
    expect(await ids('?sent=NOT_SENT')).toEqual([n]);
    expect((await ids('?sent=ALL')).sort()).toEqual([s, n].sort());
    expect((await agent.get('/api/v1/dar/saved?sent=maybe')).status).toBe(400);
  });
});

describe('DAR Send: Graph timeout is "unknown", not failed (no duplicate sends)', () => {
  const timeout = () =>
    vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      );
  const list = async (agent: ReturnType<typeof request.agent>, id: string) =>
    ((await agent.get('/api/v1/dar/saved')).body.items as { id: string }[]).find(
      (i) => i.id === id,
    ) as Record<string, unknown>;

  beforeEach(async () => {
    loginUrlMock.mockReset();
    mailExchangeMock.mockReset();
    await ActivityLogModel.deleteMany({
      action: { $in: ['report_sent', 'report_send_failed', 'report_send_unknown'] },
    });
    await UserModel.deleteMany({});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setTestTime(null);
  });

  it('graphMail: timeout or dropped connection → GraphSendUnknownError; connect refused → GraphSendError', async () => {
    const input = { subject: 's', html: '<p>x</p>', to: ['sup@xceler8.example'] };
    timeout();
    await expect(sendMailAsUser('t', input)).rejects.toBeInstanceOf(GraphSendUnknownError);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
    );
    await expect(sendMailAsUser('t', input)).rejects.toBeInstanceOf(GraphSendUnknownError);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
    );
    const refused = await sendMailWithPdf('t', {
      ...input,
      to: 'sup@xceler8.example',
      cc: [],
      fileName: 'dar.pdf',
      pdf: Buffer.from('%PDF'),
    }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(GraphSendError);
    expect(graphSendFailureReason((refused as GraphSendError).status, '')).toBe(
      'graph_unavailable',
    );
    expect(darSendError('result_unavailable')).toBe(DAR_SEND_UNCONFIRMED);
    expect(DAR_SEND_UNCONFIRMED).toBe(
      "We couldn't confirm the send. Check your Outlook Sent Items before sending again.",
    );
  });

  it('timeout: result_unavailable redirect, state unknown (not failed, not sent), audited without the token', async () => {
    const { a, agent, member } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const t0 = new Date('2026-10-22T03:00:00.000Z');
    setTestTime(t0);
    const { state, cookie } = await startSend(agent, id);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    const spy = timeout();
    const done = await callback(a, cookie, { code: 'c', state });
    expect(spy).toHaveBeenCalledTimes(1); // never retried by the server
    expect(done.headers.location).toBe(
      `http://localhost:5173/dar/saved?send_error=result_unavailable&report=${id}`,
    );
    expect(await failedAudit(id)).toBeNull();
    const unknown = await ActivityLogModel.findOne({
      action: 'report_send_unknown',
      entityId: id,
    }).lean();
    expect(unknown?.actorId?.toString()).toBe(member._id.toString());
    expect(unknown?.meta).toMatchObject({ reason: 'result_unavailable', error: 'TimeoutError' });
    expect(JSON.stringify(unknown)).not.toContain(MOCK_TOKEN);
    expect(await ActivityLogModel.countDocuments({ action: 'report_sent', entityId: id })).toBe(0);
    const doc = await SavedReportModel.findById(id).lean();
    expect(doc?.sendUnknownAt?.toISOString()).toBe(t0.toISOString());
    expect(doc?.sentAt ?? null).toBeNull();
    expect(await list(agent, id)).toMatchObject({
      sentAt: null,
      sendUnknownAt: t0.toISOString(),
    });
  });

  it('CR-16: a report with an unknown send always needs confirmResend, with no time window', async () => {
    const { a, agent } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const t0 = new Date('2026-10-22T03:00:00.000Z');
    setTestTime(t0);
    const first = await startSend(agent, id);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    timeout();
    await callback(a, first.cookie, { code: 'c', state: first.state });
    vi.restoreAllMocks();

    setTestTime(new Date(t0.getTime() + 14 * 60_000));
    const blocked = await startSend(agent, id);
    expect(blocked.res.status).toBe(409);
    expect(blocked.res.body.error).toEqual({
      code: 'ALREADY_SENT_OR_UNKNOWN',
      message: darResendConfirmMessage('unknown', t0.toISOString(), {
        from: '2026-10-13',
        to: '2026-10-13',
      }),
      details: { state: 'unknown', lastAttemptAt: t0.toISOString() },
    });
    // Refused before Microsoft: no mail cookie, no login URL used.
    expect(blocked.cookie).toBe('');
    expect(blocked.res.body.url).toBeUndefined();

    // Only `true` is a confirm; other values are refused by the strict body.
    const bad = await agent
      .post(`/api/v1/dar/saved/${id}/send`)
      .set(CSRF)
      .send({ confirmResend: 'yes' });
    expect(bad.status).toBe(400);
    const notConfirmed = await startSend(agent, id, { confirmResend: false });
    expect(notConfirmed.res.status).toBe(409);

    const confirmed = await startSend(agent, id, { confirmResend: true });
    expect(confirmed.res.status).toBe(200);
    expect(confirmed.res.body.url).toMatch(/^https:\/\/login\.microsoftonline\.com\//);

    // No 15-minute window: 15 minutes or hours later it still asks.
    for (const later of [15 * 60_000, 3 * 3_600_000]) {
      setTestTime(new Date(t0.getTime() + later));
      const res = (await startSend(agent, id)).res;
      expect(res.status, `+${later} ms`).toBe(409);
      expect(res.body.error.details).toEqual({
        state: 'unknown',
        lastAttemptAt: t0.toISOString(),
      });
    }
    // Weeks old (backdated on the record; the session would not survive a clock jump).
    const old = new Date(t0.getTime() - 30 * 86_400_000);
    await SavedReportModel.updateOne({ _id: id }, { $set: { sendUnknownAt: old } });
    const stale = (await startSend(agent, id)).res;
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toEqual({
      state: 'unknown',
      lastAttemptAt: old.toISOString(),
    });
    expect((await startSend(agent, id, { confirmResend: true })).res.status).toBe(200);
  });

  it('a confirmed send after an unknown one clears it; a re-send of a sent report needs the confirm, however long ago', async () => {
    const { a, agent } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const t0 = new Date('2026-10-22T03:00:00.000Z');
    setTestTime(t0);
    const first = await startSend(agent, id);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    timeout();
    await callback(a, first.cookie, { code: 'c', state: first.state });
    vi.restoreAllMocks();

    const t1 = new Date(t0.getTime() + 2 * 60_000);
    setTestTime(t1);
    const second = await startSend(agent, id, { confirmResend: true });
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    graph202();
    const ok = await callback(a, second.cookie, { code: 'c', state: second.state });
    expect(ok.headers.location).toBe(`http://localhost:5173/dar/saved?sent=${id}`);
    expect(await list(agent, id)).toMatchObject({
      sentAt: t1.toISOString(),
      sendUnknownAt: null,
    });
    expect((await SavedReportModel.findById(id).lean())?.sendUnknownAt ?? null).toBeNull();

    setTestTime(new Date(t1.getTime() + 60_000));
    const again = await startSend(agent, id);
    expect(again.res.status).toBe(409);
    expect(again.res.body.error.details).toEqual({
      state: 'sent',
      lastAttemptAt: t1.toISOString(),
    });
    expect(again.res.body.error.message).toBe(
      darResendConfirmMessage('sent', t1.toISOString(), { from: '2026-10-13', to: '2026-10-13' }),
    );
    // 2026-10-22T03:02Z is 11:02 AM on Oct 22 in Manila.
    expect(again.res.body.error.message).toBe(
      'Already sent on Oct 22, 2026, 11:02 AM: report for Oct 13, 2026. Send it again?',
    );

    // Sent weeks ago (backdated on the record): still the confirm, with that date.
    const old = new Date('2026-09-01T02:00:00.000Z');
    await SavedReportModel.updateOne({ _id: id }, { $set: { sentAt: old } });
    const weekLater = await startSend(agent, id);
    expect(weekLater.res.status).toBe(409);
    expect(weekLater.res.body.error).toEqual({
      code: 'ALREADY_SENT_OR_UNKNOWN',
      message: 'Already sent on Sep 1, 2026, 10:00 AM: report for Oct 13, 2026. Send it again?',
      details: { state: 'sent', lastAttemptAt: old.toISOString() },
    });
  });

  it('a report sent before the sent fields existed (audit fallback) also needs the confirm', async () => {
    const { agent, member } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const at = new Date('2026-09-30T16:30:00.000Z'); // 12:30 AM on Oct 1 in Manila
    await ActivityLogModel.create({
      actorId: member._id,
      entityType: 'savedReport',
      entityId: id,
      action: 'report_sent',
      at,
      meta: { to: 'sup@xceler8.example', cc: [], range: 'x', bytes: 1 },
    });
    const res = (await startSend(agent, id)).res;
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'ALREADY_SENT_OR_UNKNOWN',
      message: 'Already sent on Oct 1, 2026, 12:30 AM: report for Oct 13, 2026. Send it again?',
      details: { state: 'sent', lastAttemptAt: at.toISOString() },
    });
    expect((await startSend(agent, id, { confirmResend: true })).res.status).toBe(200);
  });

  it('a definite failure (Graph 403, connection refused) records nothing and never blocks a re-send', async () => {
    const { a, agent } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const first = await startSend(agent, id);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: 403 }),
    );
    expect(
      (await callback(a, first.cookie, { code: 'c', state: first.state })).headers.location,
    ).toContain('send_error=send_forbidden');
    vi.restoreAllMocks();

    const second = await startSend(agent, id);
    expect(second.res.status).toBe(200);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
    );
    expect(
      (await callback(a, second.cookie, { code: 'c', state: second.state })).headers.location,
    ).toContain('send_error=graph_unavailable');
    const doc = await SavedReportModel.findById(id).lean();
    expect(doc?.sendUnknownAt ?? null).toBeNull();
    expect(doc?.sentAt ?? null).toBeNull();
    expect(await ActivityLogModel.countDocuments({ action: 'report_send_unknown' })).toBe(0);
    expect((await startSend(agent, id)).res.status).toBe(200);
  });
});

describe('DAR Send result for the web banner (recipients as sent)', () => {
  beforeEach(async () => {
    loginUrlMock.mockReset();
    mailExchangeMock.mockReset();
    await ActivityLogModel.deleteMany({
      action: { $in: ['report_sent', 'report_send_failed', 'report_send_unknown'] },
    });
    await UserModel.deleteMany({});
  });
  afterEach(() => vi.restoreAllMocks());

  it('GET /dar/saved/:id/send-result returns who it went to at send time, not today’s supervisor', async () => {
    const { a, agent, member, supervisor } = await setupLinkedMember();
    const cc1 = await createUser({ email: 'cc1@xceler8.example', name: 'Cee One' });
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    expect((await agent.get(`/api/v1/dar/saved/${id}/send-result`)).status).toBe(404);

    const { state, cookie } = await startSend(agent, id);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    graph202();
    const done = await callback(a, cookie, { code: 'c', state });
    expect(done.headers.location).toBe(`http://localhost:5173/dar/saved?sent=${id}`);

    const log = await ActivityLogModel.findOne({ action: 'report_sent', entityId: id }).lean();
    expect(log?.meta).toMatchObject({
      to: 'sup@xceler8.example',
      toName: 'Supervisor Sam',
      cc: ['cc1@xceler8.example'],
      ccNames: ['Cee One'],
    });

    // The supervisor changes afterwards: the result still names who it was sent to.
    const other = await createUser({ email: 'sup2@xceler8.example', name: 'Other Sup' });
    await UserModel.updateOne({ _id: member._id }, { $set: { supervisorId: other._id } });
    await UserModel.updateOne({ _id: cc1._id }, { $set: { name: 'Renamed Cee' } });
    const res = await agent.get(`/api/v1/dar/saved/${id}/send-result`);
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({
      from: '2026-10-13',
      to: '2026-10-13',
      recipient: { name: 'Supervisor Sam', email: supervisor.email },
      cc: [{ name: 'Cee One', email: 'cc1@xceler8.example' }],
    });
    expect(typeof res.body.result.sentAt).toBe('string');
  });

  it('older report_sent entries without names fall back to the user’s name, then the address', async () => {
    const { agent, member } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    await ActivityLogModel.create({
      actorId: member._id,
      entityType: 'savedReport',
      entityId: id,
      action: 'report_sent',
      meta: { to: 'sup@xceler8.example', cc: ['outside@xceler8.example'], range: 'x', bytes: 1 },
    });
    const res = await agent.get(`/api/v1/dar/saved/${id}/send-result`);
    expect(res.body.result.recipient).toEqual({
      name: 'Supervisor Sam',
      email: 'sup@xceler8.example',
    });
    expect(res.body.result.cc).toEqual([
      { name: 'outside@xceler8.example', email: 'outside@xceler8.example' },
    ]);
  });

  it('send-result is owner-only (404 for anyone else)', async () => {
    const { a, agent } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, id);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    graph202();
    await callback(a, cookie, { code: 'c', state });
    const outsider = await createUser({ email: 'outsider@xceler8.example', systemRole: 'MEMBER' });
    const oa = await login(a, outsider.email, PASSWORD);
    expect((await oa.get(`/api/v1/dar/saved/${id}/send-result`)).status).toBe(404);
  });

  it('a failed send redirects with the report id (for the Retry banner); SEND_UNAVAILABLE never shows a raw code', async () => {
    const { a, agent } = await setupLinkedMember();
    const id = await saveReport(agent, '2026-10-13', '2026-10-13');
    const { state, cookie } = await startSend(agent, id);
    mailExchangeMock.mockResolvedValueOnce(goodToken());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: 403 }),
    );
    const done = await callback(a, cookie, { code: 'c', state });
    expect(done.headers.location).toBe(
      `http://localhost:5173/dar/saved?send_error=send_forbidden&report=${id}`,
    );

    const off = makeApp({ ...MS_ENV, EDGE_PROXY_SECRET: '' });
    const oa = await login(off, 'mem@xceler8.example', PASSWORD);
    const r = await oa.post(`/api/v1/dar/saved/${id}/send`).set(CSRF).send({});
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe(
      "Your report wasn't sent. Sending reports isn't turned on. Export the report and send it yourself.",
    );
    expect(r.body.error.message).not.toMatch(/not_enabled|ms_disabled/);
  });
});
