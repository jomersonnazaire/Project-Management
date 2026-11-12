import { MENTION_LIMIT_MESSAGE, mentionExcerpt, type MessageDto } from '@xc8/shared';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppMarkerModel,
  CONVERSATION_READ_CUTOFF,
  ConversationReadModel,
  MessageModel,
  NotificationModel,
  UserModel,
} from '../src/models/index.js';
import { ensureConversationReadCutoff } from '../src/services/conversationRead.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/** CR-24: Conversation unread, last-read and @mentions (FR-CNV-09..15, FR-NTF-14/15, L-1..L-4). */
useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

const tick = () => new Promise((r) => setTimeout(r, 5));
const msgs = (w: W) => `/api/v1/projects/${w.project.id}/messages`;
const tok = (u: { user: { _id: Types.ObjectId } } | string) =>
  `<@${typeof u === 'string' ? u : u.user._id.toString()}>`;
async function post(agent: Agent, w: W, text: string, status = 201) {
  await tick();
  const res = await agent.post(msgs(w)).set(CSRF).send({ text });
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as { message: MessageDto; error?: { message: string } };
}
const unreadDetail = async (agent: Agent, w: W) =>
  (await agent.get(`/api/v1/projects/${w.project.id}`)).body.project.conversationUnread as number;
const unreadList = async (agent: Agent, w: W) =>
  (
    (await agent.get('/api/v1/projects')).body.items as {
      id: string;
      conversationUnread?: number;
    }[]
  ).find((p) => p.id === w.project.id)?.conversationUnread;
const mentionsFor = async (agent: Agent) =>
  ((await agent.get('/api/v1/notifications')).body.items as Record<string, unknown>[]).filter(
    (n) => n.type === 'CONVERSATION_MENTION',
  );

describe('CR-24 L-3 / Q-177 / Q-179: mention tokens and the team check', () => {
  it('saves only active PM / team-member ids (not the author); every token stays; the message still saves', async () => {
    const w = await world(app);
    const off = w.outsider; // put on the team, then deactivated
    await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [w.member.user._id.toString(), off.user._id.toString()] });
    await UserModel.updateOne({ _id: off.user._id }, { $set: { active: false } });
    const ghost = new Types.ObjectId().toString();
    const text = `Hi ${tok(w.pm)} ${tok(w.member)} ${tok(off)} ${tok(w.viewer)} ${tok(w.pm2)} ${tok(ghost)}`;
    const { message } = await post(w.member.agent, w, text);
    expect(message.text).toBe(text);
    const saved = await MessageModel.findById(message.id).lean();
    // (c) the author's own token isn't saved; (d) non-members and deactivated aren't either.
    expect(saved!.mentionIds.map(String)).toEqual([w.pm.user._id.toString()]);
    const m = (id: string) => message.mentions!.find((x) => x.id === id);
    expect(m(w.pm.user._id.toString())).toMatchObject({ chip: true, active: true });
    // Self-mention: your chip.
    expect(m(w.member.user._id.toString())).toMatchObject({ chip: true });
    // (d) an existing user who isn't mentionable: plain "@Name".
    expect(m(w.viewer.user._id.toString())).toMatchObject({
      chip: false,
      name: w.viewer.user.name,
    });
    expect(m(w.pm2.user._id.toString())).toMatchObject({ chip: false });
    expect(m(off.user._id.toString())).toMatchObject({ chip: false, active: false });
    // (e) no user: not listed, so the web shows "Unknown user".
    expect(m(ghost)).toBeUndefined();
    // Rendering uses the current name; a deactivated person reads as inactive.
    await UserModel.updateOne({ _id: w.pm.user._id }, { $set: { name: 'Renamed PM' } });
    await UserModel.updateOne({ _id: w.pm.user._id }, { $set: { active: false } });
    const [again] = (await w.member.agent.get(msgs(w))).body.items as MessageDto[];
    expect(again!.mentions!.find((x) => x.id === w.pm.user._id.toString())).toEqual({
      id: w.pm.user._id.toString(),
      name: 'Renamed PM',
      active: false,
      chip: true,
    });
  });

  it('L-4: more than 10 distinct people is refused with the exact message; repeats count once', async () => {
    const w = await world(app);
    const ids = Array.from({ length: 11 }, () => new Types.ObjectId().toString());
    const res = await w.member.agent
      .post(msgs(w))
      .set(CSRF)
      .send({ text: ids.map(tok).join(' ') });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      message: MENTION_LIMIT_MESSAGE,
      code: 'MENTION_LIMIT',
    });
    expect(MENTION_LIMIT_MESSAGE).toBe('You can mention up to 10 people.');
    const ten = ids.slice(0, 10).map(tok).join(' ');
    await post(w.member.agent, w, `${ten} ${tok(ids[0]!)} ${tok(w.pm)}`, 422);
    await post(w.member.agent, w, `${ten} ${tok(ids[0]!)}`);
  });
});

describe('CR-24 FR-NTF-14 / Q-178 / L-2: CONVERSATION_MENTION', () => {
  it('only the mentioned team member is notified, once, with the send-time excerpt and a link to the message', async () => {
    const w = await world(app);
    const { message } = await post(
      w.pm.agent,
      w,
      `${tok(w.member)} ${tok(w.member)} ${tok(w.pm)} ${tok(w.outsider)} please check the cutover`,
    );
    const [n, ...rest] = await mentionsFor(w.member.agent);
    expect(rest).toEqual([]);
    expect(n).toMatchObject({
      actor: { id: w.pm.user._id.toString() },
      project: { id: w.project.id },
      messageId: message.id,
      excerpt: `@${w.member.user.name} @${w.member.user.name} @${w.pm.user.name} @${w.outsider.user.name} please check the cutover`,
      link: `/projects/${w.project.id}/conversation?message=${message.id}`,
      read: false,
    });
    // Self-mention, non-members and other readers: nothing.
    for (const a of [w.pm, w.outsider, w.viewer, w.pm2])
      expect(await mentionsFor(a.agent)).toEqual([]);
    // No email or Teams channel exists for it (FR-NTF-15): only the in-app row.
    expect(
      await NotificationModel.countDocuments({
        type: 'CONVERSATION_MENTION',
        projectId: w.project.id,
      }),
    ).toBe(1);
    // The excerpt is taken at send time: a rename doesn't rewrite it.
    await UserModel.updateOne({ _id: w.member.user._id }, { $set: { name: 'Later Name' } });
    expect((await mentionsFor(w.member.agent))[0]!.excerpt).toBe(n!.excerpt);
  });

  it('a deactivated team member gets no notification (EC-237, EC-241)', async () => {
    const w = await world(app);
    await UserModel.updateOne({ _id: w.member.user._id }, { $set: { active: false } });
    const { message } = await post(w.pm.agent, w, `${tok(w.member)} hi`);
    expect((await MessageModel.findById(message.id).lean())!.mentionIds).toEqual([]);
    expect(
      await NotificationModel.countDocuments({
        type: 'CONVERSATION_MENTION',
        projectId: w.project.id,
      }),
    ).toBe(0);
  });

  it('EC-228: hiding the message drops its mention notification', async () => {
    const w = await world(app);
    const { message } = await post(w.pm.agent, w, `${tok(w.member)} hi`);
    expect(await mentionsFor(w.member.agent)).toHaveLength(1);
    await w.admin.agent
      .post(`${msgs(w)}/${message.id}/hide`)
      .set(CSRF)
      .send({ reason: 'x' });
    expect(await mentionsFor(w.member.agent)).toHaveLength(0);
  });

  it('the excerpt is at most 140 code points and never splits a character', () => {
    const long = `${'a'.repeat(138)}😀😀😀 tail`;
    const e = mentionExcerpt(long, () => undefined);
    expect([...e]).toHaveLength(140);
    expect(e.endsWith('😀…')).toBe(true);
    expect(mentionExcerpt('  short \n text ', () => undefined)).toBe('short text');
  });
});

describe('CR-24 FR-CNV-09..15: unread counts and last-read', () => {
  it('counts other people’s visible messages after last-read, never your own; opening clears it', async () => {
    const w = await world(app);
    await post(w.member.agent, w, 'one');
    await post(w.member.agent, w, `two ${tok(w.member)}`);
    // AC-80.9: your own messages (even a self-mention) never count.
    expect(await unreadDetail(w.member.agent, w)).toBe(0);
    expect(await unreadList(w.member.agent, w)).toBe(0);
    expect(await unreadDetail(w.pm.agent, w)).toBe(2);
    expect(await unreadList(w.pm.agent, w)).toBe(2);
    // AC-80.8: a Viewer who can read the project sees the count too.
    expect(await unreadDetail(w.viewer.agent, w)).toBe(2);
    // The divider point before the first open: nothing read yet.
    expect((await w.pm.agent.get(msgs(w))).body.lastReadAt).toBeNull();
    // AC-80.2: opening sets last-read on the server, for every device.
    const seen = await w.pm.agent
      .post(`${msgs(w)}/seen`)
      .set(CSRF)
      .send({});
    expect(seen.body).toEqual({ unread: 0 });
    expect(await unreadList(w.pm.agent, w)).toBe(0);
    expect((await w.pm.agent.get(msgs(w))).body.lastReadAt).not.toBeNull();
    // AC-80.3: a new post counts again for others, not for its author.
    const { message } = await post(w.member.agent, w, 'three');
    expect(await unreadDetail(w.pm.agent, w)).toBe(1);
    // FR-CNV-11: posting reads the thread for the author.
    await post(w.pm.agent, w, 'reply');
    expect(await unreadDetail(w.pm.agent, w)).toBe(0);
    await post(w.member.agent, w, 'four');
    expect(await unreadDetail(w.pm.agent, w)).toBe(1);
    // AC-80.5: a hidden message drops out.
    expect(await unreadDetail(w.viewer.agent, w)).toBe(5);
    await w.admin.agent
      .post(`${msgs(w)}/${message.id}/hide`)
      .set(CSRF)
      .send({ reason: 'x' });
    expect(await unreadDetail(w.viewer.agent, w)).toBe(4);
  });

  it('FR-ARF-08: the counts-only check returns one batch for visible projects only', async () => {
    const w = await world(app);
    await post(w.member.agent, w, 'one');
    const hiddenProject = new Types.ObjectId().toString();
    const res = await w.pm.agent.get(
      `/api/v1/projects/conversation-unread?ids=${w.project.id},${hiddenProject}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ counts: { [w.project.id]: 1 } });
    // Someone who can't see the project gets nothing for it.
    const out = await w.outsider.agent.get(
      `/api/v1/projects/conversation-unread?ids=${w.project.id}`,
    );
    expect(out.body).toEqual({ counts: {} });
    expect((await w.pm.agent.get('/api/v1/projects/conversation-unread?ids=nope')).status).toBe(
      400,
    );
  });

  it('L-1 / EC-238: last-read only moves forward ($max) and never past now', async () => {
    const w = await world(app);
    const a = await post(w.member.agent, w, 'one');
    await post(w.member.agent, w, 'two');
    const seen = (at: string) =>
      w.pm.agent
        .post(`${msgs(w)}/seen`)
        .set(CSRF)
        .send({ at });
    // Read up to the first message only (the newest one shown by a watching tab).
    expect((await seen(a.message.at)).body).toEqual({ unread: 1 });
    // A stale write can't move it back.
    expect((await seen(new Date(0).toISOString())).body).toEqual({ unread: 1 });
    const row = await ConversationReadModel.findOne({ userId: w.pm.user._id }).lean();
    expect(row!.lastReadAt.toISOString()).toBe(a.message.at);
    // A future time is clamped to now.
    await seen(new Date(Date.now() + 86_400_000).toISOString());
    const after = await ConversationReadModel.findOne({ userId: w.pm.user._id }).lean();
    expect(after!.lastReadAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await unreadDetail(w.pm.agent, w)).toBe(0);
  });

  it('Q-170: messages before the release cutoff count as read; the cutoff is written once', async () => {
    const w = await world(app);
    await post(w.member.agent, w, 'before');
    await AppMarkerModel.deleteOne({ _id: CONVERSATION_READ_CUTOFF });
    await tick();
    const cutoff = await ensureConversationReadCutoff();
    expect((await ensureConversationReadCutoff()).getTime()).toBe(cutoff.getTime());
    expect(await unreadDetail(w.pm.agent, w)).toBe(0);
    expect((await w.pm.agent.get(msgs(w))).body.lastReadAt).toBe(cutoff.toISOString());
    await post(w.member.agent, w, 'after');
    expect(await unreadDetail(w.pm.agent, w)).toBe(1);
    await AppMarkerModel.deleteOne({ _id: CONVERSATION_READ_CUTOFF });
  });
});
