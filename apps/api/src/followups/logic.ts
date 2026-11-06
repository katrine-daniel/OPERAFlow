import { zonedTimeToUtc } from '@operaflow/shared';

// ─────────────────────────────── Reply classification ───────────────────────────────

export interface ThreadMessage {
  id: string;
  internetMessageId?: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: Date;
  isDraft?: boolean;
  /** Lower-cased header names → values (only the ones needed for classification). */
  headers: Record<string, string>;
}

export type Classification =
  | 'ORIGINAL'
  | 'OWN_FOLLOW_UP'
  | 'QUALIFYING_REPLY'
  | 'OUT_OF_OFFICE'
  | 'AUTO_REPLY'
  | 'BOUNCE'
  | 'INTERNAL'
  | 'AMBIGUOUS';

export const domainOf = (email: string) => email.toLowerCase().split('@')[1] ?? '';
const addr = (s: string) => {
  const m = /<([^>]+)>/.exec(s);
  return (m ? m[1]! : s).trim().toLowerCase();
};

const OOO_SUBJECT = /^(automatic reply|auto(?:matic)?[- ]?reply|out of (the )?office|ooo\b|auto:|abwesenheit|absence|réponse automatique|respuesta automática|risposta automatica|not in the office|on leave)/i;
const BOUNCE_SUBJECT = /(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|subsystem)|returned mail|delivery has failed|failure notice|message not delivered)/i;
const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|bounce[s]?)@/i;

export interface ClassifyContext {
  /** The connected mailbox address. */
  mailbox: string;
  /** Domains considered internal (the company's own). */
  internalDomains: string[];
  /** External recipients of the tracked original email. */
  recipients: string[];
  originalMessageId: string;
}

/**
 * Decides what a message in a tracked thread means for the follow-up timer. Conservative by design:
 * anything automated never counts as a reply, and a reply from an unexpected sender is sent to a human.
 */
export function classifyMessage(m: ThreadMessage, ctx: ClassifyContext): Classification {
  const from = addr(m.from);
  const h = m.headers;
  if (m.id === ctx.originalMessageId) return 'ORIGINAL';
  if (from === ctx.mailbox.toLowerCase()) return 'OWN_FOLLOW_UP';

  const contentType = (h['content-type'] ?? '').toLowerCase();
  if (BOUNCE_SENDER.test(from) || contentType.includes('multipart/report') || contentType.includes('delivery-status') || BOUNCE_SUBJECT.test(m.subject)) {
    return 'BOUNCE';
  }

  const autoSubmitted = (h['auto-submitted'] ?? 'no').toLowerCase();
  const precedence = (h['precedence'] ?? '').toLowerCase();
  const isAuto = autoSubmitted !== 'no' || 'x-autoreply' in h || 'x-autorespond' in h || ['auto_reply', 'bulk', 'junk', 'list'].includes(precedence);
  if (OOO_SUBJECT.test(m.subject) || (h['x-auto-response-suppress'] && /oof/i.test(h['x-auto-response-suppress']))) return 'OUT_OF_OFFICE';
  if (isAuto) return 'AUTO_REPLY';

  if (ctx.internalDomains.includes(domainOf(from))) return 'INTERNAL';

  const recipients = ctx.recipients.map((r) => r.toLowerCase());
  if (recipients.includes(from)) return 'QUALIFYING_REPLY';
  // A colleague at the same supplier answering on the thread is a genuine reply too.
  if (recipients.some((r) => domainOf(r) === domainOf(from)) && !isFreemail(domainOf(from))) return 'QUALIFYING_REPLY';
  return 'AMBIGUOUS';
}

const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com']);
export const isFreemail = (domain: string) => FREEMAIL.has(domain);

// ─────────────────────────────── Business-hours scheduling ───────────────────────────────

export interface RuleWindow {
  delayHours: number;
  businessHoursOnly: boolean;
  businessStart: string; // HH:MM
  businessEnd: string; // HH:MM
  businessDays: number[]; // ISO 1..7
  timezone: string;
}

function localParts(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const isoDay = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!) + 1;
  return { y: +p.year!, m: +p.month!, d: +p.day!, minutes: +p.hour! * 60 + +p.minute!, isoDay };
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Earliest instant ≥ `at` that falls inside the rule's business window. */
export function nextBusinessInstant(at: Date, rule: RuleWindow): Date {
  if (!rule.businessHoursOnly) return at;
  const start = toMin(rule.businessStart);
  const end = toMin(rule.businessEnd);
  let cursor = at;
  for (let i = 0; i < 14; i++) {
    const p = localParts(cursor, rule.timezone);
    if (rule.businessDays.includes(p.isoDay)) {
      if (p.minutes < start) return zonedTimeToUtc(p.y, p.m, p.d, Math.floor(start / 60), start % 60, rule.timezone);
      if (p.minutes < end) return cursor;
    }
    // Jump to the start of the next local day.
    const nextDay = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    cursor = zonedTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 0, 0, rule.timezone);
  }
  throw new Error('Rule has no business days');
}

/** When the next follow-up becomes due after the last outbound message. */
export function nextFollowUpAt(lastOutboundAt: Date, rule: RuleWindow): Date {
  return nextBusinessInstant(new Date(lastOutboundAt.getTime() + rule.delayHours * 3600_000), rule);
}

export function isWithinBusinessHours(at: Date, rule: RuleWindow): boolean {
  return nextBusinessInstant(at, rule).getTime() === at.getTime();
}

// ─────────────────────────────── Templates ───────────────────────────────

export const TEMPLATE_VARIABLES = ['supplierName', 'originalSubject', 'originalSentDate', 'ownerName', 'followUpNumber'] as const;
type TemplateVars = Record<(typeof TEMPLATE_VARIABLES)[number], string>;

export function templateProblems(text: string): string[] {
  const used = [...text.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map((m) => m[1]!);
  return used.filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v)).map((v) => `Unknown placeholder {{${v}}}`);
}

export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, k: string) => (k in vars ? vars[k as keyof TemplateVars] : `{{${k}}}`));
}

export function replySubject(original: string): string {
  return /^re:/i.test(original.trim()) ? original.trim() : `RE: ${original.trim()}`;
}

// ─────────────────────────────── Recipient safety ───────────────────────────────

/**
 * Follow-ups go only to people who were on the original email AND are approved contacts of the linked supplier.
 * Returns the safe list; empty means a human must decide.
 */
export function safeRecipients(originalRecipients: string[], supplierContacts: string[]): string[] {
  const approved = new Set(supplierContacts.map((e) => e.toLowerCase()));
  return [...new Set(originalRecipients.map((e) => e.toLowerCase()))].filter((e) => approved.has(e));
}
