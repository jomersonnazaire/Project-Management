import {
  ACTION_EMAIL_NOT_LINKED,
  actionEmailMobileSchema,
  actionEmailSchema,
  type ActionEmailInput,
} from '@xc8/shared';
import type { Request, RequestHandler, Response } from 'express';
import { AUTHENTICATED, type RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import { UserModel } from '../models/index.js';
import { actionRecipients, startActionEmail } from '../services/actionEmail.js';
import { useMobileEmailReturn } from '../services/msSendReturn.js';
import { loadTask } from './tasks.js';

/**
 * Starts a follow-up email (services/actionEmail.ts). POST with the CSRF header
 * and Origin check like every write, its own per-user limiter (as DAR Send, D5). Refuses with
 * 409 when the flag is off or the actor isn't linked to Microsoft, so the email part can't be
 * forced over the API. The follow-up itself was already saved by its own route. Assignment and
 * added-to-project emails start from the task / project save instead, which works out who.
 */
export function actionEmailsRouter(
  config: AppConfig,
  registry: RouteRegistry,
  limiter: RequestHandler,
) {
  const r = registry.router('/action-emails');

  // From the app (bearer only): same checks, state kept server-side with the app's PKCE
  // challenge, result back through opstrack://auth/mail + /auth/mobile/mail/confirm.
  r.post('/mobile', AUTHENTICATED, limiter, async (req, res) => {
    const {
      code_challenge,
      code_challenge_method: _m,
      ...input
    } = parseBody(actionEmailMobileSchema, req);
    useMobileEmailReturn(res, code_challenge);
    await start(req, res, input);
  });

  r.post('/', AUTHENTICATED, limiter, async (req, res) => {
    await start(req, res, parseBody(actionEmailSchema, req));
  });

  async function start(req: Request, res: Response, input: ActionEmailInput) {
    if (!config.actionEmailEnabled) {
      throw conflict('Emails are switched off.', 'EMAIL_DISABLED');
    }
    const me = await UserModel.findById(currentUser(req)._id);
    if (!me) throw notFound();
    if (!me.msOid || !me.msTid) throw conflict(ACTION_EMAIL_NOT_LINKED, 'MICROSOFT_NOT_LINKED');
    const { task, project } = await loadTask(req, input.taskId);
    if (project.archived) throw conflict('This project is archived.', 'PROJECT_ARCHIVED');
    const item = task.followUps.find((f) => f._id.equals(input.followUpId));
    if (!item) throw notFound();
    if (!item.authorId?.equals(me._id)) {
      throw forbidden('Only the author can email a follow-up.');
    }
    if (item.emailedAt) throw conflict('This follow-up was already emailed.', 'ALREADY_EMAILED');
    const followUpId = input.followUpId;
    const people = await actionRecipients(
      input.kind,
      me._id,
      project,
      task.toObject() as never,
      [],
    );
    if (!people.length) throw conflict('Nobody to email.', 'NO_RECIPIENTS');

    const url = await startActionEmail(config, res, me, {
      kind: input.kind,
      projectId: project._id,
      taskId: task._id,
      followUpId,
      recipientIds: people.map((p) => p._id),
    });
    res.json({ url, recipients: people.length });
  }

  return r.router;
}
