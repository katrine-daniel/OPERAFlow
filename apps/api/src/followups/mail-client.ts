import type { ThreadMessage } from './logic';

export interface SentMessageSummary {
  threadId: string;
  messageId: string;
  subject: string;
  to: string[];
  cc: string[];
  sentAt: string;
}

export interface OutgoingReply {
  threadId: string;
  /** Provider id of the message being replied to (Graph needs it; Gmail uses threading headers). */
  replyToMessageId: string;
  inReplyToInternetId?: string | null;
  from: string;
  to: string[];
  subject: string;
  body: string;
}

/** Everything the follow-up engine needs from a mailbox. Implemented for Gmail and Microsoft Graph. */
export interface MailboxClient {
  listRecentSent(limit: number): Promise<SentMessageSummary[]>;
  getThread(threadId: string): Promise<ThreadMessage[]>;
  createReplyDraft(reply: OutgoingReply): Promise<{ draftId: string }>;
  sendDraft(draftId: string, threadId: string): Promise<{ messageId: string }>;
  sendReply(reply: OutgoingReply): Promise<{ messageId: string }>;
}

export class MailProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

/** Strips CR/LF so user-controlled values can never inject extra headers. */
export const headerSafe = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

function encodeHeaderWord(v: string) {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

/** RFC 5322 plain-text reply, used by the Gmail API (raw, base64url). */
export function buildRawReply(r: OutgoingReply): string {
  const ref = r.inReplyToInternetId ? headerSafe(r.inReplyToInternetId) : null;
  const lines = [
    `From: ${headerSafe(r.from)}`,
    `To: ${r.to.map(headerSafe).join(', ')}`,
    `Subject: ${encodeHeaderWord(headerSafe(r.subject))}`,
    ...(ref ? [`In-Reply-To: ${ref}`, `References: ${ref}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(r.body, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n'),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

export type AccessTokenProvider = (forceRefresh?: boolean) => Promise<string>;

/** JSON fetch with timeout, bearer auth and a single token refresh on 401. */
export async function apiFetch<T>(token: AccessTokenProvider, url: string, init: RequestInit = {}, expectJson = true): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers, authorization: `Bearer ${await token(attempt > 0)}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 && attempt === 0) continue;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new MailProviderError(`${init.method ?? 'GET'} ${new URL(url).pathname} → ${res.status} ${text.slice(0, 300)}`, res.status);
    }
    if (!expectJson || res.status === 202 || res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  throw new MailProviderError('Unauthorized after token refresh', 401);
}

// ─────────────────────────────── Gmail ───────────────────────────────

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate: string;
  payload?: { headers?: { name: string; value: string }[] };
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const META = ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence', 'Content-Type', 'X-Auto-Response-Suppress'];
const metaQs = META.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join('&');
const splitAddrs = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase())
    .filter((s) => s.includes('@'));

function gmailToThreadMessage(m: GmailMessage): ThreadMessage {
  const headers = Object.fromEntries((m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  return {
    id: m.id,
    internetMessageId: headers['message-id'] ?? null,
    from: headers.from ?? '',
    to: splitAddrs(headers.to),
    cc: splitAddrs(headers.cc),
    subject: headers.subject ?? '',
    date: new Date(Number(m.internalDate)),
    isDraft: m.labelIds?.includes('DRAFT') ?? false,
    headers,
  };
}

export class GmailClient implements MailboxClient {
  constructor(private readonly token: AccessTokenProvider) {}

  async listRecentSent(limit: number): Promise<SentMessageSummary[]> {
    const list = await apiFetch<{ messages?: { id: string }[] }>(this.token, `${GMAIL}/messages?labelIds=SENT&maxResults=${Math.min(limit, 50)}`);
    const out: SentMessageSummary[] = [];
    for (const { id } of list.messages ?? []) {
      const rawMsg = await apiFetch<GmailMessage>(this.token, `${GMAIL}/messages/${id}?format=metadata&${metaQs}`);
      const m = gmailToThreadMessage(rawMsg);
      out.push({ threadId: rawMsg.threadId, messageId: m.id, subject: m.subject, to: m.to, cc: m.cc, sentAt: m.date.toISOString() });
    }
    return out;
  }

  async getThread(threadId: string): Promise<ThreadMessage[]> {
    const t = await apiFetch<{ messages?: GmailMessage[] }>(this.token, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=metadata&${metaQs}`);
    return (t.messages ?? []).map(gmailToThreadMessage).filter((m) => !m.isDraft);
  }

  async createReplyDraft(r: OutgoingReply) {
    const d = await apiFetch<{ id: string }>(this.token, `${GMAIL}/drafts`, { method: 'POST', body: JSON.stringify({ message: { raw: buildRawReply(r), threadId: r.threadId } }) });
    return { draftId: d.id };
  }

  async sendDraft(draftId: string) {
    const m = await apiFetch<{ id: string }>(this.token, `${GMAIL}/drafts/send`, { method: 'POST', body: JSON.stringify({ id: draftId }) });
    return { messageId: m.id };
  }

  async sendReply(r: OutgoingReply) {
    const m = await apiFetch<{ id: string }>(this.token, `${GMAIL}/messages/send`, { method: 'POST', body: JSON.stringify({ raw: buildRawReply(r), threadId: r.threadId }) });
    return { messageId: m.id };
  }
}

// ─────────────────────────────── Microsoft Graph ───────────────────────────────

interface GraphMessage {
  id: string;
  conversationId: string;
  subject?: string;
  isDraft?: boolean;
  sentDateTime?: string;
  receivedDateTime?: string;
  internetMessageId?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  internetMessageHeaders?: { name: string; value: string }[];
}

const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const addrs = (r?: { emailAddress?: { address?: string } }[]) => (r ?? []).map((x) => (x.emailAddress?.address ?? '').toLowerCase()).filter(Boolean);

function graphToThreadMessage(m: GraphMessage): ThreadMessage {
  return {
    id: m.id,
    internetMessageId: m.internetMessageId ?? null,
    from: m.from?.emailAddress?.address ?? '',
    to: addrs(m.toRecipients),
    cc: addrs(m.ccRecipients),
    subject: m.subject ?? '',
    date: new Date(m.receivedDateTime ?? m.sentDateTime ?? 0),
    isDraft: m.isDraft ?? false,
    headers: Object.fromEntries((m.internetMessageHeaders ?? []).map((h) => [h.name.toLowerCase(), h.value])),
  };
}

export class GraphClient implements MailboxClient {
  constructor(private readonly token: AccessTokenProvider) {}

  async listRecentSent(limit: number): Promise<SentMessageSummary[]> {
    const sel = 'id,conversationId,subject,toRecipients,ccRecipients,sentDateTime,internetMessageId';
    const res = await apiFetch<{ value: GraphMessage[] }>(this.token, `${GRAPH}/mailFolders/sentitems/messages?$top=${Math.min(limit, 50)}&$select=${sel}&$orderby=sentDateTime desc`);
    return res.value.map((m) => ({ threadId: m.conversationId, messageId: m.id, subject: m.subject ?? '', to: addrs(m.toRecipients), cc: addrs(m.ccRecipients), sentAt: m.sentDateTime ?? '' }));
  }

  async getThread(threadId: string): Promise<ThreadMessage[]> {
    const sel = 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft,internetMessageId,internetMessageHeaders';
    const filter = encodeURIComponent(`conversationId eq '${threadId.replace(/'/g, "''")}'`);
    const res = await apiFetch<{ value: GraphMessage[] }>(this.token, `${GRAPH}/messages?$filter=${filter}&$select=${sel}&$top=100`);
    return res.value.map(graphToThreadMessage).filter((m) => !m.isDraft).sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private async prepareDraft(r: OutgoingReply): Promise<string> {
    const draft = await apiFetch<GraphMessage>(this.token, `${GRAPH}/messages/${encodeURIComponent(r.replyToMessageId)}/createReply`, { method: 'POST', body: '{}' });
    await apiFetch(this.token, `${GRAPH}/messages/${encodeURIComponent(draft.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        subject: headerSafe(r.subject),
        toRecipients: r.to.map((address) => ({ emailAddress: { address } })),
        ccRecipients: [],
        body: { contentType: 'Text', content: r.body },
      }),
    });
    return draft.id;
  }

  async createReplyDraft(r: OutgoingReply) {
    return { draftId: await this.prepareDraft(r) };
  }

  async sendDraft(draftId: string) {
    await apiFetch(this.token, `${GRAPH}/messages/${encodeURIComponent(draftId)}/send`, { method: 'POST' }, false);
    return { messageId: draftId };
  }

  async sendReply(r: OutgoingReply) {
    return this.sendDraft(await this.prepareDraft(r));
  }
}
