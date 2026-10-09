import {
  SYSTEM_ROLES,
  inviteUserSchema,
  listQuerySchema,
  updateUserSchema,
  type InviteResultDto,
  type SystemRole,
} from '@xc8/shared';
import type { FilterQuery, Types } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { conflictWith } from '../lib/http422.js';
import { paginate } from '../lib/pagination.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import { TeamModel, UserModel, type User, type UserDoc } from '../models/index.js';
import { audit } from '../services/audit.js';
import { notifyOwnerNeeded } from '../services/issues.js';
import { toUserDto } from '../services/dto.js';
import { revokeUserSessions } from '../services/sessions.js';
import { newToken, sha256 } from '../services/tokens.js';

/**
 * User administration (FR-USR-05, AC-02.3). Access per the `users` access rules (default and
 * locked: Admin). Fixed rule on top: only Admins can grant the Admin role or change, deactivate
 * or reissue links for Admin accounts, so a grant on `users` can't be used to take over an Admin.
 */
/** Doc 14 §5: an active internal user, not the user themself, and no loop (A→B→A). */
export async function assertValidSupervisor(userId: Types.ObjectId, supervisorId: string) {
  const fail = (message: string) =>
    badRequest(message, [{ path: 'supervisorId', message }], 'VALIDATION_ERROR');
  if (userId.equals(supervisorId)) throw fail("A user can't be their own supervisor.");
  const sup = await UserModel.findById(supervisorId).select('name active supervisorId').lean();
  if (!sup || !sup.active) throw fail('Choose an active user as supervisor.');
  let next = sup.supervisorId;
  const seen = new Set<string>([sup._id.toString()]);
  while (next && !seen.has(next.toString())) {
    if (next.equals(userId)) {
      throw fail(`${sup.name} already reports to this user, so they can't be their supervisor.`);
    }
    seen.add(next.toString());
    next = (await UserModel.findById(next).select('supervisorId').lean())?.supervisorId ?? null;
  }
}

export function usersRouter(config: AppConfig, registry: RouteRegistry) {
  const router = registry.router('/users');

  router.get('/', perm('users', 'view'), async (req, res) => {
    const q = parseQuery(listQuerySchema, req);
    const filter: FilterQuery<User> = {};
    if (q.q) {
      const re = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ name: re }, { email: re }];
    }
    if (q.role) {
      if (!(SYSTEM_ROLES as readonly string[]).includes(q.role)) throw badRequest('Unknown role.');
      filter.systemRole = q.role;
    }
    if (q.status === 'ACTIVE') Object.assign(filter, { active: true, passwordHash: { $ne: null } });
    else if (q.status === 'INVITED') Object.assign(filter, { active: true, passwordHash: null });
    else if (q.status === 'DEACTIVATED') filter.active = false;
    else if (q.status) throw badRequest('Unknown status.');

    const { skip, limit } = paginate(q.page, q.pageSize);
    const [items, total] = await Promise.all([
      UserModel.find(filter).select('+passwordHash').sort({ name: 1 }).skip(skip).limit(limit),
      UserModel.countDocuments(filter),
    ]);
    res.json({ items: items.map(toUserDto), page: q.page, pageSize: q.pageSize, total });
  });

  router.get('/:id', perm('users', 'view'), async (req, res) => {
    const user = await UserModel.findById(idParam(req)).select('+passwordHash');
    if (!user) throw notFound();
    res.json({ user: toUserDto(user) });
  });

  /** Invite a user (FR-AUTH-04). Returns a one-time setup link for the Admin to share. */
  router.post('/', perm('users', 'create'), async (req, res) => {
    const input = parseBody(inviteUserSchema, req);
    assertMayManageAdmins(currentUser(req), input.systemRole);
    await assertTeamsExist(input.teamIds);
    if (await UserModel.exists({ email: input.email })) {
      throw conflict('Email already in use', 'EMAIL_IN_USE');
    }
    const admin = currentUser(req);
    const token = newToken();
    const expiresAt = new Date(Date.now() + config.INVITE_TTL_HOURS * 3_600_000);
    let user: UserDoc;
    try {
      user = await UserModel.create({
        ...input,
        active: true,
        mustChangePassword: true,
        invite: { tokenHash: sha256(token), expiresAt, invitedBy: admin._id, purpose: 'INVITE' },
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw conflict('Email already in use', 'EMAIL_IN_USE');
      }
      throw err;
    }
    await audit({
      actorId: admin._id,
      entityType: 'user',
      entityId: user._id,
      action: 'user_invited',
      changes: [
        { field: 'systemRole', old: null, new: user.systemRole },
        { field: 'jobRole', old: null, new: user.jobRole },
      ],
    });
    const body: InviteResultDto = {
      user: toUserDto(user),
      inviteUrl: setupUrl(config, token),
      inviteExpiresAt: expiresAt.toISOString(),
      purpose: 'INVITE',
      replacedPrevious: false,
    };
    res.status(201).json(body);
  });

  router.patch('/:id', perm('users', 'edit'), async (req, res) => {
    const id = idParam(req);
    const input = parseBody(updateUserSchema, req);
    const admin = currentUser(req);
    const user = await UserModel.findById(id).select('+passwordHash +invite');
    if (!user) throw notFound();
    assertMayManageAdmins(admin, user.systemRole, input.systemRole);

    if (input.systemRole && input.systemRole !== user.systemRole) {
      // A user can't change their own role, Admins included (FR-USR-05, AC-02.4).
      if (user._id.equals(admin._id)) {
        throw forbidden("You can't change your own access role.", 'SELF_ROLE_CHANGE');
      }
      if (user.systemRole === 'ADMIN' && user.active) await assertNotLastAdmin(user);
    }
    if (input.teamIds) await assertTeamsExist(input.teamIds);
    if (input.supervisorId) await assertValidSupervisor(user._id, input.supervisorId);
    const emailChanged = input.email !== undefined && input.email !== user.email;
    if (emailChanged && (await UserModel.exists({ email: input.email, _id: { $ne: user._id } }))) {
      throw emailInUse();
    }

    const changes: { field: string; old: unknown; new: unknown }[] = [];
    for (const [field, value] of Object.entries(input) as [keyof typeof input, unknown][]) {
      const old = user.get(field);
      const same =
        field === 'teamIds'
          ? JSON.stringify((old as unknown[]).map(String)) === JSON.stringify(value)
          : field === 'supervisorId'
            ? String(old ?? null) === String(value ?? null)
            : old === value;
      if (!same) {
        changes.push({
          field,
          old:
            field === 'teamIds'
              ? (old as unknown[]).map(String)
              : field === 'supervisorId'
                ? ((old as Types.ObjectId | null)?.toString() ?? null)
                : old,
          new: value,
        });
        user.set(field, value);
      }
    }
    if (changes.length) {
      try {
        await user.save();
      } catch (err) {
        if ((err as { code?: number }).code === 11000) throw emailInUse();
        throw err;
      }
      // FR-USR-06: the password stays valid; the user's sessions end (an Admin changing their own
      // email keeps the current one) and any unused invite or reset link is cancelled.
      if (emailChanged) {
        await revokeUserSessions(
          user._id,
          user._id.equals(admin._id) ? req.auth?.sessionId : undefined,
        );
        const hadLink = !!user.invite?.tokenHash && user.invite.expiresAt > new Date();
        await UserModel.updateOne({ _id: user._id }, { $set: { invite: null } });
        if (hadLink) changes.push({ field: 'previousLink', old: 'unused', new: 'cancelled' });
      }
      await audit({
        actorId: admin._id,
        entityType: 'user',
        entityId: user._id,
        action: changes.some((c) => c.field === 'systemRole') ? 'role_changed' : 'user_updated',
        changes,
      });
    }
    res.json({ user: toUserDto(user) });
  });

  /** Deactivate (FR-AUTH-06). History is preserved; sessions are revoked immediately. */
  router.post('/:id/deactivate', perm('users', 'delete'), async (req, res) => {
    const admin = currentUser(req);
    const user = await UserModel.findById(idParam(req)).select('+passwordHash');
    if (!user) throw notFound();
    assertMayManageAdmins(admin, user.systemRole);
    if (user._id.equals(admin._id)) {
      throw conflict("You can't deactivate your own account.", 'SELF_DEACTIVATE');
    }
    if (user.active) {
      if (user.systemRole === 'ADMIN') await assertNotLastAdmin(user);
      user.active = false;
      user.deactivatedAt = new Date();
      await user.save();
      await revokeUserSessions(user._id);
      await audit({
        actorId: admin._id,
        entityType: 'user',
        entityId: user._id,
        action: 'user_deactivated',
        changes: [{ field: 'active', old: true, new: false }],
      });
      // EC-66: their open issues need a new owner; tell each project's PM.
      await notifyOwnerNeeded({ ownerIds: [user._id], actorId: admin._id });
    }
    res.json({ user: toUserDto(user) });
  });

  router.post('/:id/reactivate', perm('users', 'delete'), async (req, res) => {
    const admin = currentUser(req);
    const user = await UserModel.findById(idParam(req)).select('+passwordHash');
    if (!user) throw notFound();
    assertMayManageAdmins(admin, user.systemRole);
    if (!user.active) {
      user.active = true;
      user.deactivatedAt = null;
      user.failedLogins = 0;
      user.lockedUntil = null;
      await user.save();
      await audit({
        actorId: admin._id,
        entityType: 'user',
        entityId: user._id,
        action: 'user_reactivated',
        changes: [{ field: 'active', old: false, new: true }],
      });
    }
    res.json({ user: toUserDto(user) });
  });

  /**
   * Issues a new single-use link (FR-AUTH-04/05, AC-02.6): "New invite link" for users who
   * haven't set a password yet (expires after INVITE_TTL_HOURS), "Copy reset link" for active
   * users (expires after RESET_TTL_HOURS). Email delivery is deferred, so the Admin shares it.
   * A user holds at most one link: storing the new hash cancels any earlier unused link.
   */
  router.post('/:id/invite', perm('users', 'edit'), async (req, res) => {
    const admin = currentUser(req);
    const user = await UserModel.findById(idParam(req)).select('+passwordHash +invite');
    if (!user) throw notFound();
    assertMayManageAdmins(admin, user.systemRole);
    if (!user.active) throw conflict('Reactivate this user first.', 'USER_DEACTIVATED');
    const purpose = user.passwordHash ? 'RESET' : 'INVITE';
    const ttlHours = purpose === 'RESET' ? config.RESET_TTL_HOURS : config.INVITE_TTL_HOURS;
    const now = new Date();
    const replacedPrevious = !!user.invite?.tokenHash && user.invite.expiresAt > now;
    const token = newToken();
    const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { invite: { tokenHash: sha256(token), expiresAt, invitedBy: admin._id, purpose } } },
    );
    await audit({
      actorId: admin._id,
      entityType: 'user',
      entityId: user._id,
      action: purpose === 'RESET' ? 'password_reset_link_issued' : 'invite_reissued',
      ...(replacedPrevious
        ? { changes: [{ field: 'previousLink', old: 'unused', new: 'cancelled' }] }
        : {}),
    });
    const body: InviteResultDto = {
      user: toUserDto(user),
      inviteUrl: setupUrl(config, token),
      inviteExpiresAt: expiresAt.toISOString(),
      purpose,
      replacedPrevious,
    };
    res.json(body);
  });

  return router.router;
}

/** 409 with a field error so the form can show it under Email. */
function emailInUse() {
  return conflictWith('Email already in use', 'EMAIL_IN_USE', [
    { path: 'email', message: 'Another user already has this email.' },
  ]);
}

/** Only Admins may create, change or remove Admin accounts or grant the Admin role. */
function assertMayManageAdmins(actor: UserDoc, targetRole: string, newRole?: string) {
  if (actor.systemRole === 'ADMIN') return;
  if (targetRole === 'ADMIN' || newRole === 'ADMIN') {
    throw forbidden('Only Admins can manage Admin accounts.', 'FORBIDDEN');
  }
}

function setupUrl(config: AppConfig, token: string) {
  // Token in the fragment so it never reaches server or proxy logs.
  return `${config.WEB_APP_URL.replace(/\/+$/, '')}/setup-password#token=${token}`;
}

async function assertTeamsExist(teamIds: string[]) {
  if (!teamIds.length) return;
  const unique = [...new Set(teamIds)];
  const count = await TeamModel.countDocuments({ _id: { $in: unique }, archived: false });
  if (count !== unique.length) throw badRequest('One or more teams were not found.');
}

/** At least one active Admin must remain (EC-26). */
async function assertNotLastAdmin(user: UserDoc) {
  const others = await UserModel.countDocuments({
    _id: { $ne: user._id },
    systemRole: 'ADMIN' satisfies SystemRole,
    active: true,
  });
  if (others === 0) {
    throw conflict('At least one active Admin is required.', 'LAST_ADMIN');
  }
}
