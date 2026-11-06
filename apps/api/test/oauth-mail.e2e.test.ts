import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@operaflow/db';
import { buildRawReply, GmailClient, GraphClient } from '../src/followups/mail-client';
import { createTestApp, createUser, login, resetDatabase } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;
let admin: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  Object.assign(process.env, {
    GOOGLE_OAUTH_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
    APP_BASE_URL: 'https://ops.example.test',
  });
  const { resetEnvCache } = await import('../src/config/env');
  resetEnvCache();
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  admin = await login(app, (await createUser(prisma, 'ADMIN')).email);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function startFlow() {
  return request(app.getHttpServer()).get('/integrations/oauth/google/start').set('Cookie', admin);
}

describe('mailbox OAuth (Google)', () => {
  it('redirects to Google with PKCE, offline access and gmail.modify only', async () => {
    const res = await startFlow();
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location!);
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe('https://ops.example.test/api/integrations/oauth/google/callback');
    expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/gmail.modify');
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).join()).toMatch(/of_oauth=.*HttpOnly/i);
  });

  it('rejects a callback whose state does not match', async () => {
    const start = await startFlow();
    const cookie = ([] as string[]).concat(start.headers['set-cookie']!).find((c) => c.startsWith('of_oauth='))!.split(';')[0]!;
    const res = await request(app.getHttpServer()).get('/integrations/oauth/google/callback?code=abc&state=forged').set('Cookie', `${admin}; ${cookie}`);
    expect(res.headers.location).toContain('oauth_error=state_mismatch');
    expect(await prisma.integration.count()).toBe(0);
  });

  it('stores the refresh token encrypted and the mailbox address reported by Google', async () => {
    const start = await startFlow();
    const state = new URL(start.headers.location!).searchParams.get('state')!;
    const cookie = ([] as string[]).concat(start.headers['set-cookie']!).find((c) => c.startsWith('of_oauth='))!.split(';')[0]!;
    const calls: { url: string; body?: string }[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-SECRET-1', expires_in: 3600 }), { status: 200 });
      if (url.includes('/users/me/profile')) return new Response(JSON.stringify({ emailAddress: 'Reservations@Agency.com' }), { status: 200 });
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;

    const res = await request(app.getHttpServer()).get(`/integrations/oauth/google/callback?code=auth-code&state=${state}`).set('Cookie', `${admin}; ${cookie}`);
    expect(res.headers.location).toBe('https://ops.example.test/integrations?connected=reservations%40agency.com');
    const tokenCall = calls.find((c) => c.url.startsWith('https://oauth2.googleapis.com/token'))!;
    expect(tokenCall.body).toContain('code_verifier=');
    expect(tokenCall.body).toContain('grant_type=authorization_code');

    const integ = await prisma.integration.findFirstOrThrow();
    expect(integ).toMatchObject({ kind: 'GMAIL', mailboxAddress: 'reservations@agency.com', mode: 'LIVE', status: 'CONNECTED' });
    expect(integ.encryptedSecret).not.toContain('rt-SECRET-1');
    expect(await prisma.auditLog.count({ where: { action: 'integration.mailbox_connected' } })).toBe(1);
  });

  it('is limited to integration managers', async () => {
    const staff = await login(app, (await createUser(prisma, 'OPS_STAFF')).email);
    expect((await request(app.getHttpServer()).get('/integrations/oauth/google/start').set('Cookie', staff)).status).toBe(403);
  });
});

describe('provider adapters (HTTP contract, mocked network)', () => {
  const reply = {
    threadId: 'thr-1',
    replyToMessageId: 'msg-1',
    inReplyToInternetId: '<orig@agency.com>',
    from: 'res@agency.com',
    to: ['rates@hotelgroup.com'],
    subject: 'RE: Rates\r\nBcc: attacker@evil.com',
    body: 'Dear Hotel, any update? — Zoë',
  };

  it('builds a threaded Gmail reply and strips header-injection attempts', () => {
    const raw = Buffer.from(buildRawReply(reply), 'base64url').toString('utf8');
    expect(raw).toContain('In-Reply-To: <orig@agency.com>');
    expect(raw).toContain('To: rates@hotelgroup.com');
    expect(raw).not.toMatch(/^Bcc:/m);
    const body = raw.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Dear Hotel, any update? — Zoë');
  });

  it('Gmail: sends with threadId and retries once after a 401 with a fresh token', async () => {
    const seen: { url: string; auth: string; body: string }[] = [];
    let n = 0;
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), auth: String((init?.headers as Record<string, string>).authorization), body: String(init?.body ?? '') });
      return ++n === 1 ? new Response('expired', { status: 401 }) : new Response(JSON.stringify({ id: 'sent-1' }), { status: 200 });
    }) as typeof fetch;
    const tokens = vi.fn(async (force?: boolean) => (force ? 'fresh' : 'stale'));
    const res = await new GmailClient(tokens).sendReply(reply);
    expect(res.messageId).toBe('sent-1');
    expect(seen.map((s) => s.auth)).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(seen[1]!.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(JSON.parse(seen[1]!.body)).toMatchObject({ threadId: 'thr-1' });
  });

  it('Graph: creates a reply draft, overrides recipients and body, then sends', async () => {
    const seen: { method: string; url: string; body: string }[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url: String(input), body: String(init?.body ?? '') });
      if (String(input).endsWith('/createReply')) return new Response(JSON.stringify({ id: 'draft-9', conversationId: 'thr-1' }), { status: 201 });
      if (String(input).endsWith('/send')) return new Response(null, { status: 202 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await new GraphClient(async () => 'tok').sendReply(reply);
    expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([
      'POST /v1.0/me/messages/msg-1/createReply',
      'PATCH /v1.0/me/messages/draft-9',
      'POST /v1.0/me/messages/draft-9/send',
    ]);
    const patch = JSON.parse(seen[1]!.body);
    expect(patch.toRecipients).toEqual([{ emailAddress: { address: 'rates@hotelgroup.com' } }]);
    expect(patch.ccRecipients).toEqual([]);
    expect(patch.subject).toBe('RE: Rates Bcc: attacker@evil.com');
  });
});
