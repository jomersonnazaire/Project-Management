import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';
import { ClientContactModel, UserModel, type UserDoc } from '../models/index.js';
import { audit } from './audit.js';
import {
  type MicrosoftIdClaims,
  isAllowedEmailDomain,
  isAllowedMicrosoftMember,
  isAllowedTenant,
} from './microsoftAuth.js';

export type MicrosoftSignInFailure = {
  ok: false;
  reason: string;
};

export type MicrosoftSignInSuccess = { ok: true; user: UserDoc };

export type MicrosoftSignInResult = MicrosoftSignInSuccess | MicrosoftSignInFailure;

function refuse(reason: string): MicrosoftSignInFailure {
  return { ok: false, reason };
}

function ssoMeta(userId: UserDoc['_id'], claims: MicrosoftIdClaims, email: string) {
  return { userId: userId.toString(), msTid: claims.tid, email };
}

/**
 * Applies Microsoft sign-in rules 0–5: match, link, or create an internal user.
 * Caller must verify the ID token and nonce before invoking.
 */
export async function resolveMicrosoftSignIn(
  config: AppConfig,
  claims: MicrosoftIdClaims,
): Promise<MicrosoftSignInResult> {
  const email = claims.email?.trim().toLowerCase() ?? '';
  if (!email) return refuse('no_email');

  if (!isAllowedTenant(claims.tid, config)) {
    return refuse('tenant_not_allowed');
  }
  if (!isAllowedMicrosoftMember(claims, config)) {
    return refuse('not_tenant_member');
  }

  const byMs = await UserModel.findOne({ msOid: claims.oid, msTid: claims.tid });
  if (byMs) {
    if (!byMs.active) return refuse('deactivated');
    return { ok: true, user: byMs };
  }

  const existing = await UserModel.findOne({ email });
  if (existing) {
    if (!existing.active) return refuse('deactivated');
    if (!isAllowedEmailDomain(email, config)) {
      return refuse('link_denied');
    }
    existing.msOid = claims.oid;
    existing.msTid = claims.tid;
    await existing.save();
    await audit({
      actorId: existing._id,
      entityType: 'user',
      entityId: existing._id,
      action: 'sso_linked',
      meta: ssoMeta(existing._id, claims, email),
    });
    return { ok: true, user: existing };
  }

  if (!isAllowedEmailDomain(email, config)) {
    return refuse('domain_not_allowed');
  }
  if (await ClientContactModel.exists({ email })) {
    return refuse('client_contact');
  }

  const now = clockNow();
  const user = await UserModel.create({
    name: claims.name,
    email,
    systemRole: 'VIEWER',
    jobRole: null,
    active: true,
    mustChangePassword: false,
    passwordHash: null,
    authProvider: 'microsoft',
    msOid: claims.oid,
    msTid: claims.tid,
    lastLoginAt: now,
    failedLogins: 0,
    lockedUntil: null,
  });
  await audit({
    actorId: user._id,
    entityType: 'user',
    entityId: user._id,
    action: 'sso_user_created',
    meta: ssoMeta(user._id, claims, email),
  });
  return { ok: true, user };
}
