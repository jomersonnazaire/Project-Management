import type { Express } from 'express';
import type { TemplateInput } from '@xc8/shared';
import type request from 'supertest';
import { expect } from 'vitest';
import { AccessRuleModel } from '../src/models/index.js';
import { CSRF, createUser, login, signedInAs } from './helpers.js';

type Agent = ReturnType<typeof request.agent>;

/** A small template: Phase A (a1, a2 → a1), Phase B (a3 → a2, client party, needs approval). */
export const SMALL_TEMPLATE: TemplateInput = {
  name: 'Small Template',
  type: 'GENERAL_IT',
  description: 'For tests',
  phases: [
    { id: 'pa', name: 'Phase A' },
    { id: 'pb', name: 'Phase B' },
  ],
  activities: [
    {
      id: 'a1',
      phaseId: 'pa',
      name: 'Kickoff',
      estHours: 8,
      offsetDays: 0,
      durationDays: 2,
      deliverable: 'Minutes',
    },
    {
      id: 'a2',
      phaseId: 'pa',
      name: 'Design',
      estHours: 16,
      offsetDays: 2,
      durationDays: 3,
      dependsOn: ['a1'],
    },
    {
      id: 'a3',
      phaseId: 'pb',
      name: 'Client sign-off',
      party: 'CLIENT',
      offsetDays: 5,
      durationDays: 1,
      dependsOn: ['a2'],
      requiresApproval: true,
      mandatory: true,
    },
  ],
};

export async function publishedTemplate(admin: Agent, body: TemplateInput = SMALL_TEMPLATE) {
  const created = await admin.post('/api/v1/templates').set(CSRF).send(body);
  expect(created.status).toBe(201);
  const pub = await admin
    .post(`/api/v1/templates/${created.body.template.id}/publish`)
    .set(CSRF)
    .send({});
  expect(pub.status).toBe(200);
  return pub.body.template as { id: string; version: number; templateKey: string };
}

let n = 0;
export async function clientWithContacts(admin: Agent) {
  n += 1;
  const client = (
    await admin
      .post('/api/v1/clients')
      .set(CSRF)
      .send({ name: `Client ${n} ${Date.now()}` })
  ).body.client;
  const c1 = (
    await admin
      .post(`/api/v1/clients/${client.id}/contacts`)
      .set(CSRF)
      .send({ name: 'Ana Active', position: 'CFO', email: 'ana@client.example' })
  ).body.contact;
  const c2 = (
    await admin.post(`/api/v1/clients/${client.id}/contacts`).set(CSRF).send({ name: 'Ben Active' })
  ).body.contact;
  const c3 = (
    await admin
      .post(`/api/v1/clients/${client.id}/contacts`)
      .set(CSRF)
      .send({ name: 'Cara Inactive' })
  ).body.contact;
  await admin.post(`/api/v1/contacts/${c3.id}/deactivate`).set(CSRF).send({});
  return { client, active: [c1, c2], inactive: c3 };
}

/** Admin, PM (manager), PM2, Member (on the project), Outsider, Viewer, a client and a project. */
export async function world(app: Express) {
  const admin = await signedInAs(app, 'ADMIN');
  const pm = await signedInAs(app, 'PROJECT_MANAGER');
  const pm2 = await signedInAs(app, 'PROJECT_MANAGER');
  const member = await signedInAs(app, 'MEMBER');
  const outsider = await signedInAs(app, 'MEMBER');
  const viewer = await signedInAs(app, 'VIEWER');
  const template = await publishedTemplate(admin.agent);
  const acme = await clientWithContacts(admin.agent);
  const other = await clientWithContacts(admin.agent);
  const res = await pm.agent
    .post('/api/v1/projects')
    .set(CSRF)
    .send({
      name: 'Rollout P',
      clientId: acme.client.id,
      managerId: pm.user._id.toString(),
      memberIds: [member.user._id.toString()],
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: template.id,
    });
  expect(res.status).toBe(201);
  return {
    admin,
    pm,
    pm2,
    member,
    outsider,
    viewer,
    template,
    acme,
    other,
    project: res.body.project,
  };
}

export async function grant(
  app: Express,
  role: string,
  permissions: Record<string, Record<string, boolean>>,
) {
  const admin = await createUser({ systemRole: 'ADMIN' });
  const agent = await login(app, admin.email);
  const current = await agent.get('/api/v1/access-rules');
  const version = current.body.roles.find((r: { role: string }) => r.role === role).version;
  const res = await agent
    .put(`/api/v1/access-rules/${role}`)
    .set(CSRF)
    .send({ version, permissions });
  expect(res.status).toBe(200);
}

export const resetRules = () => AccessRuleModel.deleteMany({});
