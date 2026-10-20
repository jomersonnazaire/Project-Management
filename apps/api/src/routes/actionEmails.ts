import { ACTION_EMAIL_NOT_LINKED, actionEmailSchema } from '@xc8/shared';
import type { RequestHandler } from 'express';
import type { Types } from 'mongoose';
import { AUTHENTICATED, type RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import { UserModel } from '../models/index.js';
import { actionRecipients } from '../services/actionEmail.js';
import { buildMicrosoftLoginUrl } from '../services/microsoftAuth.js';
import { setMicrosoftActionEmailCookie } from '../services/microsoftOAuthCookie.js';
import { canAddProjectMembers } from '../services/scope.js';
import { loadProject } from './projects.js';
import { loadTask, taskCan, type TaskDoc } from './tasks.js';

/**
 * Starts an action email (services/actionEmail.ts). POST with the CSRF header and Origin check
 * like every write, its own per-user limiter (as DAR Send, D5). Refuses with 409 when the flag is
 * off or the actor isn't linked to Microsoft, so the email part can't be forced over the API.
 * The action itself (follow-up, assignment, member add) was already saved by its own route.
 */
export function actionEmailsRouter(
  config: AppConfig,
  registry: RouteRegistry,
  limiter: RequestHandler,
) {
  const r = registry.router('/action-emails');

  r.post('/', AUTHENTICATED, limiter, async (req, res) => {
    const input = parseBody(actionEmailSchema, req);
    if (!config.actionEmailEnabled) {
      throw conflict('Emails are switched off.', 'EMAIL_DISABLED');
    }
    const me = await UserModel.findById(currentUser(req)._id);
    if (!me) throw notFound();
    if (!me.msOid || !me.msTid) throw conflict(ACTION_EMAIL_NOT_LINKED, 'MICROSOFT_NOT_LINKED');
    const perms = currentPermissions(req);

    let project;
    let task = null;
    let followUpId = '';
    let requested: string[] = [];
    if (input.kind === 'PROJECT_ADDED') {
      project = await loadProject(req, 'view', input.projectId);
      if (!canAddProjectMembers(me, perms, project)) throw forbidden();
      requested = input.userIds;
    } else {
      ({ task, project } = await loadTask(req, input.taskId));
      if (project.archived) throw conflict('This project is archived.', 'PROJECT_ARCHIVED');
      if (input.kind === 'FOLLOW_UP') {
        const item = task.followUps.find((f) => f._id.equals(input.followUpId));
        if (!item) throw notFound();
        if (!item.authorId?.equals(me._id)) {
          throw forbidden('Only the author can email a follow-up.');
        }
        if (item.emailedAt)
          throw conflict('This follow-up was already emailed.', 'ALREADY_EMAILED');
        followUpId = input.followUpId;
      } else {
        if (!taskCan(me, perms, project, task.toObject() as TaskDoc).plan) throw forbidden();
        requested = input.userIds;
      }
    }
    const people = await actionRecipients(
      input.kind,
      me._id,
      project,
      task ? (task.toObject() as never) : null,
      requested,
    );
    if (!people.length) throw conflict('Nobody to email.', 'NO_RECIPIENTS');

    const login = await buildMicrosoftLoginUrl(config, {
      scopes: ['Mail.Send'],
      loginHint: me.email,
    });
    setMicrosoftActionEmailCookie(config, res, {
      codeVerifier: login.codeVerifier,
      state: login.state,
      nonce: login.nonce,
      userId: me._id.toString(),
      kind: input.kind,
      projectId: (project._id as Types.ObjectId).toString(),
      taskId: task ? task._id.toString() : '',
      followUpId,
      recipientIds: people.map((p) => p._id.toString()),
    });
    res.json({ url: login.url, recipients: people.length });
  });

  return r.router;
}
