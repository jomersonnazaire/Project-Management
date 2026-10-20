import {
  DAR_MAX_PDF_BYTES,
  DAR_NOTIFY_RECENT,
  DAR_PASSWORD_ONLY,
  DAR_SEND_RATE_LIMITED,
  DAR_TOO_LARGE,
  type DarReportDto,
} from '@xc8/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityLogModel, NotificationModel, UserModel } from '../src/models/index.js';
import type * as DarExport from '../src/services/darExport.js';
import {
  GraphSendError,
  graphSendFailureReason,
  sendMailWithPdf,
} from '../src/services/graphMail.js';
import { darMailContent } from '../src/services/darSend.js';
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
async function startSend(agent: ReturnType<typeof request.agent>, savedId: string) {
  stateSeq += 1;
  const state = `mail-state-${stateSeq}-${Date.now()}`;
  loginUrlMock.mockResolvedValueOnce({
    url: `https://login.microsoftonline.com/mock-mail?state=${state}`,
    codeVerifier: 'verifier-mail-123456789012345678901234567890',
    state,
    nonce: `nonce-${stateSeq}`,
  });
  const res = await agent.post(`/api/v1/dar/saved/${savedId}/send`).set(CSRF).send({});
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
    expect(nl.body.error).toMatchObject({ code: 'SEND_UNAVAILABLE', message: DAR_PASSWORD_ONLY });
    expect((await failedAudit(s1))?.meta).toMatchObject({ reason: 'not_linked' });

    const { agent, member } = await setupLinkedMember();
    await UserModel.updateOne({ _id: member._id }, { $unset: { supervisorId: 1 } });
    const s2 = await saveReport(agent, '2026-10-13', '2026-10-13');
    const ns = await agent.post(`/api/v1/dar/saved/${s2}/send`).set(CSRF).send({});
    expect(ns.status).toBe(409);
    expect(ns.body.error.message).toBe('Ask an Admin to set your supervisor.');
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
    expect(done.headers.location).toBe('http://localhost:5173/dar/saved?send_error=too_large');
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
    expect(done.headers.location).toBe('http://localhost:5173/dar/saved?send_error=no_mailbox');
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
        'http://localhost:5173/dar/saved?send_error=wrong_account',
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
      'http://localhost:5173/dar/saved?send_error=consent_declined',
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
    expect(replay.headers.location).toBe('http://localhost:5173/dar/saved?send_error=send_failed');
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

    expect((await startSend(g1, s1)).res.status).toBe(200);
    const limited = await startSend(g1, s1);
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
