import { listQuerySchema, teamSchema } from '@xc8/shared';
import { perm, type RouteRegistry } from '../access/registry.js';
import { conflict, notFound } from '../lib/errors.js';
import { idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import { TeamModel, UserModel } from '../models/index.js';
import { audit } from '../services/audit.js';
import { toTeamDto } from '../services/dto.js';

/** Teams (FR-USR-04, AC-03.1). Access per the `teams` access rules (default: Admin only). */
export function teamsRouter(registry: RouteRegistry) {
  const router = registry.router('/teams');

  router.get('/', perm('teams', 'view'), async (req, res) => {
    const q = parseQuery(listQuerySchema, req);
    const filter = q.includeArchived === 'true' ? {} : { archived: false };
    const teams = await TeamModel.find(filter).sort({ name: 1 }).lean();
    const counts = await UserModel.aggregate<{ _id: unknown; n: number }>([
      { $match: { active: true } },
      { $unwind: '$teamIds' },
      { $group: { _id: '$teamIds', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ items: teams.map((t) => toTeamDto(t, byId.get(t._id.toString()) ?? 0)) });
  });

  router.post('/', perm('teams', 'create'), async (req, res) => {
    const { name } = parseBody(teamSchema, req);
    if (await TeamModel.exists({ nameKey: name.toLowerCase() })) {
      throw conflict('A team with this name already exists.', 'TEAM_NAME_IN_USE');
    }
    const team = await TeamModel.create({ name, nameKey: name.toLowerCase() });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'team',
      entityId: team._id,
      action: 'team_created',
    });
    res.status(201).json({ team: toTeamDto(team) });
  });

  router.patch('/:id', perm('teams', 'edit'), async (req, res) => {
    const { name } = parseBody(teamSchema, req);
    const team = await TeamModel.findById(idParam(req));
    if (!team) throw notFound();
    if (name !== team.name) {
      const clash = await TeamModel.exists({ nameKey: name.toLowerCase(), _id: { $ne: team._id } });
      if (clash) throw conflict('A team with this name already exists.', 'TEAM_NAME_IN_USE');
      const old = team.name;
      team.name = name;
      team.nameKey = name.toLowerCase();
      await team.save();
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'team',
        entityId: team._id,
        action: 'team_renamed',
        changes: [{ field: 'name', old, new: name }],
      });
    }
    res.json({ team: toTeamDto(team) });
  });

  // Teams are archived rather than deleted, so archive/unarchive count as Delete.
  for (const [path, archived] of [
    ['archive', true],
    ['unarchive', false],
  ] as const) {
    router.post(`/:id/${path}`, perm('teams', 'delete'), async (req, res) => {
      const team = await TeamModel.findById(idParam(req));
      if (!team) throw notFound();
      // AC-03.2 (warn about open tasks) applies once tasks exist (later milestone).
      if (team.archived !== archived) {
        team.archived = archived;
        await team.save();
        await audit({
          actorId: currentUser(req)._id,
          entityType: 'team',
          entityId: team._id,
          action: archived ? 'team_archived' : 'team_unarchived',
          changes: [{ field: 'archived', old: !archived, new: archived }],
        });
      }
      res.json({ team: toTeamDto(team), openTasks: [] });
    });
  }

  return router.router;
}
