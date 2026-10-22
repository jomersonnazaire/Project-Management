import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';
import { SavedReportModel, UserModel } from '../models/index.js';
import { audit } from './audit.js';
import { recordDarSent } from './dar.js';
import {
  buildDarCc,
  GraphSendError,
  graphSendFailureReason,
  resolveDarSupervisor,
  sendDarReportEmail,
} from './darSend.js';
import {
  consentReason,
  exchangeMicrosoftMailCode,
  hasMailSendScope,
  isAllowedMicrosoftMemberFromToken,
  isAllowedTenant,
  msalMailFailureReason,
} from './microsoftAuth.js';
import { consumeMicrosoftMailState, type MicrosoftMailOAuthState } from './microsoftOAuthCookie.js';

function darSendRedirect(config: AppConfig, res: Response, params: Record<string, string>) {
  const q = new URLSearchParams(params);
  res.redirect(`${config.WEB_APP_URL}/dar/saved?${q.toString()}`);
}

async function failSend(
  config: AppConfig,
  res: Response,
  reason: string,
  userId: Types.ObjectId | null,
  savedId: Types.ObjectId | null,
  meta: Record<string, unknown> = {},
) {
  if (userId && savedId) {
    await audit({
      actorId: userId,
      entityType: 'savedReport',
      entityId: savedId,
      action: 'report_send_failed',
      meta: { reason, ...meta },
    });
  }
  darSendRedirect(config, res, { send_error: reason });
}

export async function handleMicrosoftDarMailCallback(
  config: AppConfig,
  req: Request,
  res: Response,
  mail: MicrosoftMailOAuthState,
  code: string,
  msError: string,
  errorDescription: string,
): Promise<void> {
  const savedId = new Types.ObjectId(mail.savedReportId);
  const userId = new Types.ObjectId(mail.userId);

  if (!consumeMicrosoftMailState(mail.state)) {
    await failSend(config, res, 'send_failed', userId, savedId, { detail: 'state_reused' });
    return;
  }

  if (!config.msEnabled) {
    await failSend(config, res, 'not_enabled', userId, savedId);
    return;
  }

  if (msError) {
    await failSend(config, res, consentReason(msError, errorDescription), userId, savedId);
    return;
  }

  if (!code) {
    await failSend(config, res, 'send_failed', userId, savedId);
    return;
  }

  let token;
  try {
    token = await exchangeMicrosoftMailCode(config, code, mail.codeVerifier, mail.nonce);
  } catch (err) {
    const reason = msalMailFailureReason(err) ?? 'send_failed';
    await failSend(config, res, reason, userId, savedId);
    return;
  }

  if (!hasMailSendScope(token.scopes)) {
    await failSend(config, res, 'consent_declined', userId, savedId);
    return;
  }

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
    await failSend(config, res, 'wrong_account', userId, savedId);
    return;
  }

  const saved = await SavedReportModel.findOne({ _id: savedId, userId: user._id }).lean();
  if (!saved) {
    await failSend(config, res, 'not_found', userId, savedId);
    return;
  }

  const supervisor = await resolveDarSupervisor(user);
  if (!supervisor) {
    await failSend(config, res, 'no_supervisor', userId, savedId);
    return;
  }
  const cc = buildDarCc(user, supervisor.email, user.email);

  let bytes: number;
  try {
    ({ bytes } = await sendDarReportEmail(token.accessToken, user, saved as never, supervisor, cc));
  } catch (err) {
    if (err instanceof GraphSendError) {
      const reason = graphSendFailureReason(err.status, err.code);
      await failSend(config, res, reason, userId, savedId, {
        graphStatus: err.status,
        graphCode: err.code,
      });
      return;
    }
    req.log?.warn({ err }, 'DAR Graph send failed');
    await failSend(config, res, 'graph_unavailable', userId, savedId);
    return;
  }
  // The mail is out: from here on nothing may turn this into a "failed" send. If recording the
  // sent fields fails, the report_sent audit entry below still proves it (read as a fallback).
  try {
    await recordDarSent(saved._id, user._id, 1 + cc.length, clockNow());
  } catch (err) {
    req.log?.warn({ err }, 'DAR sent status not recorded');
  }
  const range = `${saved.from} to ${saved.to}`;
  await audit({
    actorId: user._id,
    entityType: 'savedReport',
    entityId: saved._id,
    action: 'report_sent',
    meta: { to: supervisor.email, cc, range, bytes },
  });
  darSendRedirect(config, res, { sent: saved._id.toString() });
}
