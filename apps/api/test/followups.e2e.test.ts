import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@operaflow/db';
import { MailClientFactory } from '../src/followups/mail-client.factory';
import type { MailboxClient, OutgoingReply } from '../src/followups/mail-client';
import type { ThreadMessage } from '../src/followups/logic';
import { createTestApp, createUser, login, ORIGIN, resetDatabase } from './helpers';

/** In-memory mailbox standing in for Gmail/Graph (test double only). */
class FakeMailbox implements MailboxClient {
  threads = new Map<string, ThreadMessage[]>();
  drafts = new Map<string, OutgoingReply>();
  sent: OutgoingReply[] = [];
  failSends = 0;
  private n = 0;

  reset() {
    this.threads.clear();
    this.drafts.clear();
    this.sent = [];
    this.failSends = 0;
    this.n = 0;
  }
  add(threadId: string, m: Partial<ThreadMessage> & { from: string; date: Date }) {
    const list = this.threads.get(threadId) ?? [];
    list.push({ id: `m${++this.n}`, to: [], cc: [], subject: 'RE: December rates', headers: {}, ...m });
    this.threads.set(threadId, list);
    return list[list.length - 1]!;
  }
  async listRecentSent() {
    return [...this.threads.entries()].map(([threadId, ms]) => ({ threadId, messageId: ms[0]!.id, subject: ms[0]!.subject, to: ms[0]!.to, cc: ms[0]!.cc, sentAt: ms[0]!.date.toISOString() }));
  }
  async getThread(threadId: string) {
    return [...(this.threads.get(threadId) ?? [])];
  }
  async createReplyDraft(r: OutgoingReply) {
    if (this.failSends > 0) {
      this.failSends--;
      throw new Error('Provider unavailable (503)');
    }
    const draftId = `d${++this.n}`;
    this.drafts.set(draftId, r);
    return { draftId };
  }
  async sendDraft(draftId: string) {
    const r = this.drafts.get(draftId)!;
    this.drafts.delete(draftId);
    return this.sendReply(r);
  }
  async sendReply(r: OutgoingReply) {
    if (this.failSends > 0) {
      this.failSends--;
      throw new Error('Provider unavailable (503)');
    }
    this.sent.push(r);
    const m = this.add(r.threadId, { from: r.from, to: r.to, subject: r.subject, date: new Date() });
    return { messageId: m.id };
  }
}

const fake = new FakeMailbox();
const prisma = new PrismaClient();
let app: INestApplication;
let svc: import('../src/followups/followups.service').FollowupsService;
let ids: { integration: string; supplier: string; bare: string; rule: string; template: string };
let owner: string;
let other: string;
let manager: string;
let admin: string;

const http = () => request(app.getHttpServer());
const post = (path: string, cookie: string, body: object = {}) => http().post(path).set('Origin', ORIGIN).set('Cookie', cookie).send(body);

// Tue 10 Nov 2026 10:00 Dubai. 24h rule, business hours 09-18 Mon-Fri Dubai.
const SENT_AT = new Date('2026-11-10T06:00:00Z');
const DUE = new Date('2026-11-11T06:30:00Z');

beforeAll(async () => {
  app = await createTestApp([{ provide: MailClientFactory, useValue: { forIntegration: () => fake, storeSecret: (s: string) => s, providerOf: () => 'google' } }]);
  const { FollowupsService } = await import('../src/followups/followups.service');
  svc = app.get(FollowupsService);
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  fake.reset();
  await resetDatabase(prisma);
  const o = await createUser(prisma, 'OPS_STAFF', 'owner@agency.com');
  const x = await createUser(prisma, 'OPS_STAFF', 'other@agency.com');
  const m = await createUser(prisma, 'OPS_MANAGER', 'mgr@agency.com');
  const a = await createUser(prisma, 'ADMIN', 'admin@agency.com');
  [owner, other, manager, admin] = await Promise.all([login(app, o.email), login(app, x.email), login(app, m.email), login(app, a.email)]);
  const integ = await prisma.integration.create({ data: { kind: 'GMAIL', name: 'res', mailboxAddress: 'res@agency.com', mode: 'LIVE', status: 'CONNECTED', encryptedSecret: 'test' } });
  const sup = await prisma.supplier.create({ data: { code: 'HG', name: 'Hotel Group', type: 'HOTEL_DIRECT', contacts: { create: [{ email: 'rates@hotelgroup.com', isPrimary: true }] } } });
  const bare = await prisma.supplier.create({ data: { code: 'NC', name: 'No Contacts Ltd', type: 'WHOLESALER' } });
  const tpl = await prisma.followUpTemplate.create({ data: { name: 'Std', subjectTemplate: '{{originalSubject}}', bodyTemplate: 'Dear {{supplierName}}, following up (#{{followUpNumber}}). {{ownerName}}' } });
  const rule = await prisma.followUpRule.create({ data: { name: '24h', delayHours: 24, maxFollowUps: 2, timezone: 'Asia/Dubai', templateId: tpl.id } });
  ids = { integration: integ.id, supplier: sup.id, bare: bare.id, rule: rule.id, template: tpl.id };
  fake.add('t1', { from: 'Reservations <res@agency.com>', to: ['rates@hotelgroup.com'], cc: ['boss@agency.com', 'stranger@elsewhere.com'], subject: 'December rates', date: SENT_AT, internetMessageId: '<orig@agency.com>' });
});

async function track(supplierId = ids.supplier) {
  return post('/followups/conversations', owner, { integrationId: ids.integration, threadId: 't1', messageId: 'm1', supplierId, ruleId: ids.rule });
}

describe('tracking a conversation', () => {
  it('only tracks when a recipient is an approved supplier contact, and never targets anyone else', async () => {
    const bad = await track(ids.bare);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('approved contact');

    const ok = await track();
    expect(ok.status).toBe(201);
    expect(ok.body.recipients).toEqual(['rates@hotelgroup.com']); // internal boss and unknown stranger excluded
    expect(ok.body.nextFollowUpAt).toBe('2026-11-11T06:00:00.000Z'); // +24h, inside Wed business hours
    expect((await track()).status).toBe(409); // same thread twice
  });
});

describe('draft-review mode (default)', () => {
  it('drafts once when due, waits for approval, and sends exactly what was reviewed', async () => {
    const { body: conv } = await track();
    expect(await svc.tick(new Date('2026-11-11T05:00:00Z'))).toMatchObject({ checked: 1 }); // not yet due
    expect(await prisma.followUpExecution.count()).toBe(0);

    await svc.tick(DUE);
    await svc.tick(new Date(DUE.getTime() + 60_000)); // second tick must not duplicate
    const execs = await prisma.followUpExecution.findMany();
    expect(execs).toHaveLength(1);
    expect(execs[0]).toMatchObject({ status: 'AWAITING_APPROVAL', sequence: 1, recipients: ['rates@hotelgroup.com'], subject: 'RE: December rates' });
    expect(execs[0]!.body).toContain('Dear Hotel Group, following up (#1)');
    expect(fake.drafts.size).toBe(1);
    expect(fake.sent).toHaveLength(0);
    expect(await prisma.notification.count({ where: { type: 'followup.draft_ready' } })).toBe(1);

    expect((await post(`/followups/executions/${execs[0]!.id}/approve`, other)).status).toBe(403); // not the owner
    const ok = await post(`/followups/executions/${execs[0]!.id}/approve`, owner);
    expect(ok.body).toEqual({ status: 'SENT' });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ to: ['rates@hotelgroup.com'], inReplyToInternetId: '<orig@agency.com>' });

    const after = await prisma.emailConversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(after).toMatchObject({ status: 'TRACKING', followUpCount: 1 });
    expect(await prisma.auditLog.count({ where: { action: 'followup.sent' } })).toBe(1);
  });

  it('stops on a genuine reply, and does not send an approved draft after the supplier answered', async () => {
    const { body: conv } = await track();
    await svc.tick(DUE);
    const exec = await prisma.followUpExecution.findFirstOrThrow();
    fake.add('t1', { from: 'Anna <anna@hotelgroup.com>', date: new Date('2026-11-11T07:00:00Z') });
    const res = await post(`/followups/executions/${exec.id}/approve`, owner);
    expect(res.body).toMatchObject({ status: 'NOT_SENT', reason: expect.stringContaining('replied') });
    expect(fake.sent).toHaveLength(0);
    expect((await prisma.emailConversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe('REPLIED');
    expect((await prisma.followUpExecution.findUniqueOrThrow({ where: { id: exec.id } })).status).toBe('CANCELLED');
    await svc.tick(new Date('2026-11-20T06:00:00Z'));
    expect(await prisma.followUpExecution.count()).toBe(1);
    expect(await prisma.notification.count({ where: { type: 'followup.replied' } })).toBe(1);
  });

  it('ignores out-of-office auto replies but escalates bounces and unknown senders', async () => {
    const { body: conv } = await track();
    fake.add('t1', { from: 'rates@hotelgroup.com', subject: 'Automatic reply: December rates', date: new Date('2026-11-10T06:01:00Z') });
    await svc.tick(DUE);
    expect((await prisma.emailConversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe('AWAITING_APPROVAL');
    const ooo = await prisma.emailMessage.findFirstOrThrow({ where: { classification: 'OUT_OF_OFFICE' } });
    expect(ooo.direction).toBe('INBOUND');

    fake.add('t1', { from: 'MAILER-DAEMON@mx.hotelgroup.com', subject: 'Undeliverable: December rates', date: new Date('2026-11-11T07:00:00Z') });
    await svc.tick(new Date('2026-11-11T08:00:00Z'));
    const c = await prisma.emailConversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.status).toBe('NEEDS_REVIEW');
    expect(c.pausedReason).toMatch(/bounce/i);
  });

  it('waits for business hours instead of sending at the weekend', async () => {
    const { body: conv } = await track();
    await prisma.emailConversation.update({ where: { id: conv.id }, data: { nextFollowUpAt: new Date('2026-11-14T06:00:00Z') } }); // Saturday
    expect(await svc.tick(new Date('2026-11-14T06:05:00Z'))).toMatchObject({ WAITING_FOR_BUSINESS_HOURS: 1 });
    expect(await prisma.followUpExecution.count()).toBe(0);
    expect((await prisma.emailConversation.findUniqueOrThrow({ where: { id: conv.id } })).nextFollowUpAt!.toISOString()).toBe('2026-11-16T05:00:00.000Z');
  });
});

describe('auto-send mode', () => {
  it('requires administrator approval, sends without a draft, retries failures, and stops at the maximum', async () => {
    expect((await post(`/followups/rules/${ids.rule}/approve-autosend`, manager)).status).toBe(403);
    // The database itself refuses AUTO_SEND without a recorded approval.
    await expect(prisma.followUpRule.update({ where: { id: ids.rule }, data: { sendMode: 'AUTO_SEND' } })).rejects.toThrow(/autosend_approval_chk/);
    expect((await post(`/followups/rules/${ids.rule}/approve-autosend`, admin)).status).toBe(200);
    await prisma.followUpRule.update({ where: { id: ids.rule }, data: { maxFollowUps: 1 } });

    const { body: conv } = await track();
    fake.failSends = 1;
    expect(await svc.tick(DUE)).toMatchObject({ FAILED: 1 });
    expect((await prisma.followUpExecution.findFirstOrThrow()).status).toBe('FAILED');
    expect(await svc.tick(new Date(DUE.getTime() + 600_000))).toMatchObject({ SENT: 1 });
    const exec = await prisma.followUpExecution.findFirstOrThrow();
    expect(exec).toMatchObject({ status: 'SENT', attempts: 2, providerDraftId: null });
    expect(fake.sent).toHaveLength(1);

    // Next interval passes without a reply → exhausted after the single allowed follow-up.
    await svc.tick(new Date('2026-11-13T06:00:00Z'));
    expect((await prisma.emailConversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe('EXHAUSTED');
    expect(fake.sent).toHaveLength(1);
  });

  it('editing an auto-send rule revokes its approval', async () => {
    await post(`/followups/rules/${ids.rule}/approve-autosend`, admin);
    const res = await http().patch(`/followups/rules/${ids.rule}`).set('Origin', ORIGIN).set('Cookie', manager).send({ delayHours: 48 });
    expect(res.body).toMatchObject({ sendMode: 'DRAFT_REVIEW', autoSendApprovedById: null });
  });
});

describe('manual controls', () => {
  it('pause/resume/cancel are owner-or-manager actions and paused threads are not processed', async () => {
    const { body: conv } = await track();
    expect((await post(`/followups/conversations/${conv.id}/pause`, other, { reason: 'x' })).status).toBe(403);
    expect((await post(`/followups/conversations/${conv.id}/pause`, owner, { reason: 'Supplier on holiday' })).body.status).toBe('PAUSED');
    await svc.tick(DUE);
    expect(await prisma.followUpExecution.count()).toBe(0);
    expect((await post(`/followups/conversations/${conv.id}/resume`, manager)).body.status).toBe('TRACKING');
    expect((await post(`/followups/conversations/${conv.id}/cancel`, owner)).body.status).toBe('CANCELLED');
  });

  it('rejects templates with unknown placeholders', async () => {
    const res = await post('/followups/templates', manager, { name: 'Bad', subjectTemplate: 'Hi', bodyTemplate: 'Dear {{supplierNmae}}, any update?' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('supplierNmae');
  });
});
