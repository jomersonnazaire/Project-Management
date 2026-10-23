import { ACTION_EMAIL_NOT_LINKED, toDateOnly, type ActionEmailStartDto } from '@xc8/shared';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';
import { ProjectModel, TaskModel, UserModel } from '../models/index.js';
import { audit } from './audit.js';
import {
  escapeHtml,
  GraphSendError,
  graphSendFailureReason,
  GraphSendUnknownError,
  sendMailAsUser,
} from './graphMail.js';
import {
  consentReason,
  exchangeMicrosoftMailCode,
  hasMailSendScope,
  isAllowedMicrosoftMemberFromToken,
  isAllowedTenant,
  msalMailFailureReason,
} from './microsoftAuth.js';
import {
  consumeMicrosoftMailState,
  setMicrosoftActionEmailCookie,
  type ActionEmailKind,
  type MicrosoftActionEmailOAuthState,
} from './microsoftOAuthCookie.js';
import { buildMicrosoftLoginUrl } from './microsoftAuth.js';
import { mobileEmailChallenge, saveMobileActionState, sendResultRedirect } from './msSendReturn.js';
import { notify, projectRecipients } from './notify.js';

type Id = Types.ObjectId;

/**
 * Action emails (roadmap §4, first step of email notifications): after posting a follow-up,
 * assigning a task or adding project members, the actor can email the people concerned from
 * their OWN Outlook with delegated Graph Mail.Send, the same consent flow as DAR Send (#29).
 * POST /action-emails returns a Microsoft URL; the browser goes there and the shared
 * /auth/microsoft/callback sends one email per recipient. Nothing is stored: the code exchange
 * runs on a per-request MSAL client with no cache plugin (createMsalClient), so the access token
 * and the refresh token MSAL also gets (its default scopes include offline_access) live only in
 * that client's memory for that request and are never saved or reused. In-app notifications are
 * created by the action itself, unchanged; the email is extra and never replaces them.
 * Off unless EMAIL_NOTIFICATIONS_ENABLED (and Microsoft sign-in) are configured.
 */

/** FR-NTF-01 / AC-40.1: owner, every assignee, the reviewer and the PM (the author is dropped). */
export function followUpRecipientIds(
  task: {
    ownerId?: Id | null;
    assigneeIds?: Id[] | null;
    approval?: { reviewerId?: Id | null } | null;
  },
  project: { managerId?: Id | null },
): (Id | null | undefined)[] {
  return [task.ownerId, ...(task.assigneeIds ?? []), task.approval?.reviewerId, project.managerId];
}

type ProjectLike = { _id: Id; name: string; managerId?: Id | null; memberIds?: Id[] | null };
type TaskLike = {
  _id: Id;
  name: string;
  dueDate?: Date | null;
  ownerId?: Id | null;
  assigneeIds?: Id[] | null;
  approval?: { reviewerId?: Id | null } | null;
  followUps?: { _id: Id; authorId?: Id | null; note?: string | null; emailedAt?: Date | null }[];
};

/**
 * Who the email may go to, from the saved records only (never from the request): active users
 * currently on the project, never the actor (same rules as in-app notify()).
 * - FOLLOW_UP: exactly the in-app FOLLOW_UP recipients.
 * - TASK_ASSIGNED: the requested people who are now the task's owner or an assignee.
 * - PROJECT_ADDED: the requested people who are now project members.
 */
export async function actionRecipients(
  kind: ActionEmailKind,
  actorId: Id,
  project: ProjectLike,
  task: TaskLike | null,
  requested: string[],
) {
  let ids: (Id | null | undefined)[];
  if (kind === 'FOLLOW_UP') ids = followUpRecipientIds(task!, project);
  else {
    const allowed = new Set(
      (kind === 'TASK_ASSIGNED'
        ? [task!.ownerId, ...(task!.assigneeIds ?? [])]
        : (project.memberIds ?? [])
      )
        .filter(Boolean)
        .map(String),
    );
    ids = requested.filter((r) => allowed.has(r)).map((r) => new Types.ObjectId(r));
  }
  return projectRecipients({ project, actorId, recipients: ids });
}

/**
 * Starts the Microsoft consent round trip for an action email: the signed state cookie names
 * the kind, the item and the recipients (all worked out on the server). Returns the URL.
 */
export async function startActionEmail(
  config: AppConfig,
  res: Response,
  me: { _id: Id; email: string },
  item: {
    kind: ActionEmailKind;
    projectId: Id;
    taskId?: Id | null;
    followUpId?: string;
    recipientIds: Id[];
  },
): Promise<string> {
  const login = await buildMicrosoftLoginUrl(config, {
    scopes: ['Mail.Send'],
    loginHint: me.email,
  });
  const mailState = {
    codeVerifier: login.codeVerifier,
    state: login.state,
    nonce: login.nonce,
    userId: me._id.toString(),
    kind: item.kind,
    projectId: item.projectId.toString(),
    taskId: item.taskId ? item.taskId.toString() : '',
    followUpId: item.followUpId ?? '',
    recipientIds: item.recipientIds.map(String),
  };
  // Started from the app (POST /action-emails/mobile or emailReturn 'mobile'): state kept
  // server-side with the app's PKCE challenge; otherwise the web cookie, unchanged.
  const challenge = mobileEmailChallenge(res);
  if (challenge) await saveMobileActionState(mailState, challenge);
  else setMicrosoftActionEmailCookie(config, res, mailState);
  return login.url;
}

/**
 * People a save added to a project: the in-app ADDED_TO_PROJECT notice always goes to them (the
 * actor and inactive users excluded, as notify()). When the actor ticked "Email {name}", it also
 * starts the email to exactly those people. `added` is the server's own before/after diff.
 */
export async function membersAdded(
  config: AppConfig,
  res: Response,
  me: SaveActor,
  project: ProjectLike,
  added: Id[],
  emailOptIn: boolean | undefined,
): Promise<ActionEmailStartDto | null> {
  if (added.length)
    await notify({ type: 'ADDED_TO_PROJECT', project, actorId: me._id, recipients: added });
  return saveEmail(config, res, me, project, null, 'PROJECT_ADDED', added, emailOptIn);
}

type SaveActor = { _id: Id; email: string; msOid?: string | null; msTid?: string | null };

/**
 * The email part of a save that gave people something (a task, a place on a project): only when
 * ticked, only to `people` (the save's own before/after diff, re-checked against the saved
 * record), and it never blocks the save. Returns how it went, or null when not asked.
 */
export async function saveEmail(
  config: AppConfig,
  res: Response,
  me: SaveActor,
  project: ProjectLike,
  task: TaskLike | null,
  kind: 'PROJECT_ADDED' | 'TASK_ASSIGNED',
  people: (Id | string)[],
  emailOptIn: boolean | undefined,
): Promise<ActionEmailStartDto | null> {
  if (!emailOptIn) return null;
  if (!config.actionEmailEnabled) return noEmail('EMAIL_DISABLED', 'Emails are switched off.');
  if (!me.msOid || !me.msTid) return noEmail('MICROSOFT_NOT_LINKED', ACTION_EMAIL_NOT_LINKED);
  const to = people.length
    ? await actionRecipients(kind, me._id, project, task, people.map(String))
    : [];
  if (!to.length) return noEmail('NO_RECIPIENTS', 'Nobody to email.');
  const url = await startActionEmail(config, res, me, {
    kind,
    projectId: project._id,
    taskId: task?._id ?? null,
    recipientIds: to.map((p) => p._id),
  });
  return { url, error: null, message: null, recipients: to.length };
}

const noEmail = (
  error: NonNullable<ActionEmailStartDto['error']>,
  message: string,
): ActionEmailStartDto => ({ url: null, error, message, recipients: 0 });

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** The email for one recipient. Every value is escaped; the only link is the item's page. */
export function actionMailContent(
  config: AppConfig,
  kind: ActionEmailKind,
  input: {
    actorName: string;
    recipientName: string;
    project: { _id: Id; name: string };
    task: TaskLike | null;
    note?: string | null;
  },
) {
  const base = config.WEB_APP_URL.replace(/\/+$/, '');
  const pid = input.project._id.toString();
  const link = input.task
    ? `${base}/projects/${pid}?task=${input.task._id.toString()}`
    : `${base}/projects/${pid}`;
  const e = escapeHtml;
  const p = input.project.name;
  const t = input.task?.name ?? '';
  let subject: string;
  let lines: string[];
  if (kind === 'FOLLOW_UP') {
    subject = `[${p}] Follow-up on ${t}`;
    lines = [
      `<p>${e(input.note ?? '').replace(/\r?\n/g, '<br>')}</p>`,
      `<p style="color:#666">Follow-up by ${e(input.actorName)} on ${e(t)} · ${e(p)}</p>`,
    ];
  } else if (kind === 'TASK_ASSIGNED') {
    const due = input.task?.dueDate ? ` It's due on ${toDateOnly(input.task.dueDate)}.` : '';
    subject = `[${p}] You were assigned ${t}`;
    lines = [
      `<p>Hi ${e(input.recipientName)},</p>`,
      `<p>${e(input.actorName)} assigned you to ${e(t)} in ${e(p)}.${e(due)}</p>`,
    ];
  } else {
    subject = `[${p}] You were added to ${p}`;
    lines = [
      `<p>Hi ${e(input.recipientName)},</p>`,
      `<p>${e(input.actorName)} added you to the project ${e(p)}.</p>`,
    ];
  }
  const label = input.task ? 'Open the task in OpsTrack' : 'Open the project in OpsTrack';
  return {
    subject: oneLine(subject).slice(0, 250),
    html: [...lines, `<p><a href="${e(link)}">${label}</a></p>`].join('\n'),
  };
}

/** The Microsoft callback leg for an action email (state cookie already matched). */
export async function handleMicrosoftActionEmailCallback(
  config: AppConfig,
  req: Request,
  res: Response,
  st: MicrosoftActionEmailOAuthState,
  code: string,
  msError: string,
  errorDescription: string,
): Promise<void> {
  const userId = new Types.ObjectId(st.userId);
  const projectId = new Types.ObjectId(st.projectId);
  const taskId = st.taskId ? new Types.ObjectId(st.taskId) : null;
  const followUpId = st.followUpId ? new Types.ObjectId(st.followUpId) : null;
  const base = config.WEB_APP_URL.replace(/\/+$/, '');
  const back = (params: Record<string, string>, mobileExtra: Record<string, number> = {}) => {
    const q = new URLSearchParams({ ...(st.taskId ? { task: st.taskId } : {}), ...params });
    sendResultRedirect(
      res,
      `${base}/projects/${st.projectId}?${q.toString()}`,
      params,
      mobileExtra,
    );
  };
  const entity = taskId
    ? { entityType: 'task', entityId: taskId }
    : { entityType: 'project', entityId: projectId };
  const meta = { kind: st.kind, ...(st.followUpId ? { followUpId: st.followUpId } : {}) };
  // AC4: failures go to the audit log, never with the token, code or state.
  const failed = (reason: string, extra: Record<string, unknown> = {}) =>
    audit({
      actorId: userId,
      ...entity,
      projectId,
      action: 'action_email_failed',
      meta: { ...meta, reason, ...extra },
    });
  const fail = async (reason: string, extra: Record<string, unknown> = {}) => {
    await failed(reason, extra);
    back({ email_error: reason });
  };

  if (!consumeMicrosoftMailState(st.state)) return fail('send_failed', { detail: 'state_reused' });
  if (!config.actionEmailEnabled) return fail('not_enabled');
  if (msError) return fail(consentReason(msError, errorDescription));
  if (!code) return fail('send_failed');

  let token;
  try {
    token = await exchangeMicrosoftMailCode(config, code, st.codeVerifier, st.nonce);
  } catch (err) {
    return fail(msalMailFailureReason(err) ?? 'send_failed');
  }
  if (!hasMailSendScope(token.scopes)) return fail('consent_declined');

  const user = await UserModel.findById(userId);
  if (
    !user?.active ||
    !user.msOid ||
    !user.msTid ||
    user.msOid !== token.oid ||
    user.msTid !== token.tid ||
    !isAllowedTenant(token.tid, config) ||
    !isAllowedMicrosoftMemberFromToken(token)
  ) {
    return fail('wrong_account');
  }

  const project = await ProjectModel.findById(projectId).lean();
  const task = taskId ? await TaskModel.findOne({ _id: taskId, projectId }).lean() : null;
  if (!project || (taskId && !task)) return fail('not_found');
  if (project.archived) return fail('project_archived');
  const item = followUpId ? task?.followUps?.find((f) => f._id.equals(followUpId)) : null;
  if (st.kind === 'FOLLOW_UP' && (!item || !item.authorId?.equals(user._id))) {
    return fail('not_found');
  }

  const people = await actionRecipients(st.kind, user._id, project, task, st.recipientIds);
  // Only people chosen when the email was started, and still eligible now.
  const allowed = new Set(st.recipientIds);
  const to = people.filter((u) => allowed.has(u._id.toString()));
  if (!to.length) return fail('no_recipients');

  // A follow-up is emailed once: claim it before sending (double click, second tab, FE-11).
  if (st.kind === 'FOLLOW_UP') {
    const claimed = await TaskModel.updateOne(
      { _id: taskId, followUps: { $elemMatch: { _id: followUpId, emailedAt: null } } },
      { $set: { 'followUps.$.emailedAt': clockNow() } },
    );
    if (!claimed.modifiedCount) return fail('already_emailed');
  }

  let sent = 0;
  let unknown = 0;
  let lastReason = '';
  for (const r of to) {
    const address = r.email?.trim();
    if (!address?.includes('@')) {
      req.log?.warn({ kind: st.kind, recipientId: r._id.toString() }, 'Action email: no address');
      await failed('no_address', { recipientId: r._id.toString() });
      lastReason = 'no_address';
      continue;
    }
    const { subject, html } = actionMailContent(config, st.kind, {
      actorName: user.name,
      recipientName: r.name,
      project,
      task,
      note: item?.note,
    });
    try {
      await sendMailAsUser(token.accessToken, { subject, html, to: [address] });
      sent += 1;
    } catch (err) {
      if (err instanceof GraphSendUnknownError) {
        // Timeout or dropped connection after the request went out: it may have been sent.
        // Not a failure, and never retried here.
        unknown += 1;
        await audit({
          actorId: userId,
          ...entity,
          projectId,
          action: 'action_email_unknown',
          meta: {
            ...meta,
            reason: 'result_unavailable',
            recipientId: r._id.toString(),
            error: err.cause instanceof Error ? err.cause.name : 'Error',
          },
        });
        continue;
      }
      const extra =
        err instanceof GraphSendError
          ? { graphStatus: err.status, graphCode: err.code }
          : { error: (err as Error)?.name ?? 'Error' };
      lastReason =
        err instanceof GraphSendError
          ? graphSendFailureReason(err.status, err.code)
          : 'graph_unavailable';
      await failed(lastReason, { recipientId: r._id.toString(), ...extra });
    }
  }
  if (!sent && !unknown) {
    if (st.kind === 'FOLLOW_UP') {
      await TaskModel.updateOne(
        { _id: taskId, 'followUps._id': followUpId },
        { $set: { 'followUps.$.emailedAt': null } },
      );
    }
    back({ email_error: lastReason || 'send_failed' });
    return;
  }
  if (sent) {
    await audit({
      actorId: user._id,
      ...entity,
      projectId,
      action: 'action_email_sent',
      meta: { ...meta, recipients: sent, ...(unknown ? { unknown } : {}) },
    });
  }
  // Any unconfirmed email: say so (check Sent Items) rather than "sent" or "failed". A follow-up
  // stays marked as emailed, so it can't be emailed twice by accident.
  if (unknown) {
    back({ email_error: 'result_unavailable' }, { recipients: sent, unknown });
    return;
  }
  back(sent === to.length ? { email: 'sent' } : { email: 'partial' }, { recipients: sent });
}
