import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type EmailConversation, type FollowUpExecution, type FollowUpRule, type Integration } from '@operaflow/db';
import { hasPermission } from '@operaflow/shared';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../common/auth-context';
import { MailClientFactory } from './mail-client.factory';
import type { MailboxClient } from './mail-client';
import {
  classifyMessage,
  domainOf,
  isWithinBusinessHours,
  nextBusinessInstant,
  nextFollowUpAt,
  renderTemplate,
  replySubject,
  safeRecipients,
  type Classification,
  type ThreadMessage,
} from './logic';

const ACTIVE: EmailConversation['status'][] = ['TRACKING', 'FOLLOWUP_DUE'];
const MAX_SEND_ATTEMPTS = 3;
const STALE_SENDING_MS = 15 * 60_000;

type ConvFull = EmailConversation & {
  integration: Integration;
  rule: (FollowUpRule & { template: { subjectTemplate: string; bodyTemplate: string } }) | null;
  supplier: { name: string; contacts: { email: string }[] } | null;
  owner: { id: string; name: string };
};

const convInclude = {
  integration: true,
  rule: { include: { template: { select: { subjectTemplate: true, bodyTemplate: true } } } },
  supplier: { select: { name: true, contacts: { select: { email: true } } } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.EmailConversationInclude;

export interface TrackInput {
  integrationId: string;
  threadId: string;
  messageId: string;
  supplierId: string;
  ruleId: string;
}

@Injectable()
export class FollowupsService {
  private readonly logger = new Logger(FollowupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClientFactory,
    private readonly audit: AuditService,
  ) {}

  private internalDomains(mailbox: string) {
    return [...new Set([domainOf(mailbox), ...env().INTERNAL_EMAIL_DOMAINS])];
  }

  private notify(userId: string, type: string, title: string, conversationId: string, severity = 'info') {
    return this.prisma.notification.create({ data: { userId, type, severity, title, link: `/follow-ups/${conversationId}` } });
  }

  assertCanAct(conv: { ownerId: string }, user: AuthUser) {
    // Staff manage their own threads; managers and admins can manage any.
    if (conv.ownerId !== user.id && !hasPermission(user.role, 'suppliers:manage')) throw new ForbiddenException('Only the owner or a manager can change this follow-up');
  }

  async listSent(integrationId: string, user: AuthUser) {
    const integ = await this.prisma.integration.findUnique({ where: { id: integrationId } });
    if (!integ) throw new NotFoundException();
    const sent = await this.mail.forIntegration(integ).listRecentSent(25);
    const tracked = new Set((await this.prisma.emailConversation.findMany({ where: { integrationId }, select: { providerThreadId: true } })).map((c) => c.providerThreadId));
    const contacts = await this.prisma.supplierContact.findMany({ where: { email: { in: sent.flatMap((s) => [...s.to, ...s.cc]) } }, select: { email: true, supplierId: true } });
    void user;
    return sent.map((s) => ({
      ...s,
      alreadyTracked: tracked.has(s.threadId),
      suggestedSupplierId: contacts.find((c) => s.to.includes(c.email) || s.cc.includes(c.email))?.supplierId ?? null,
    }));
  }

  /** Starts tracking a thread. Everything is read back from the mailbox; nothing from the browser is trusted. */
  async track(input: TrackInput, actor: AuthUser, meta: RequestMeta) {
    const [integ, supplier, rule] = await Promise.all([
      this.prisma.integration.findUnique({ where: { id: input.integrationId } }),
      this.prisma.supplier.findUnique({ where: { id: input.supplierId }, include: { contacts: true } }),
      this.prisma.followUpRule.findUnique({ where: { id: input.ruleId } }),
    ]);
    if (!integ || !['GMAIL', 'MICROSOFT_GRAPH'].includes(integ.kind)) throw new BadRequestException('Choose a connected mailbox');
    if (!supplier || !supplier.isActive) throw new BadRequestException('Choose an active supplier');
    if (!rule || !rule.isActive) throw new BadRequestException('Choose an active follow-up rule');
    const mailbox = integ.mailboxAddress!.toLowerCase();

    const thread = await this.mail.forIntegration(integ).getThread(input.threadId);
    const original = thread.find((m) => m.id === input.messageId);
    if (!original) throw new BadRequestException('The selected message was not found in that thread');
    if (!original.from.toLowerCase().includes(mailbox)) throw new BadRequestException('Only emails sent from the connected mailbox can be tracked');

    const internal = this.internalDomains(mailbox);
    const external = [...new Set([...original.to, ...original.cc].map((e) => e.toLowerCase()))].filter((e) => !internal.includes(domainOf(e)));
    const recipients = safeRecipients(external, supplier.contacts.map((c) => c.email));
    if (!recipients.length) {
      throw new BadRequestException(`None of the recipients (${external.join(', ') || 'none'}) is an approved contact of ${supplier.name}. Add the contact under Suppliers first.`);
    }

    try {
      const conv = await this.prisma.emailConversation.create({
        data: {
          integrationId: integ.id,
          providerThreadId: input.threadId,
          originalMessageId: original.id,
          originalInternetMessageId: original.internetMessageId ?? null,
          subject: original.subject.slice(0, 500),
          supplierId: supplier.id,
          ownerId: actor.id,
          ruleId: rule.id,
          recipients,
          originalSentAt: original.date,
          nextFollowUpAt: nextFollowUpAt(original.date, rule),
        },
      });
      await this.audit.log({ actorId: actor.id, action: 'followup.tracking_started', entityType: 'email_conversation', entityId: conv.id, metadata: { supplier: supplier.code, rule: rule.name, recipients }, meta });
      // Apply anything already in the thread (e.g. the supplier replied before tracking started).
      const full = await this.prisma.emailConversation.findUniqueOrThrow({ where: { id: conv.id }, include: convInclude });
      await this.applyThread(full, thread);
      return this.prisma.emailConversation.findUniqueOrThrow({ where: { id: conv.id } });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This thread is already being tracked');
      throw err;
    }
  }

  /** Records new messages and moves the conversation according to what they mean. Returns the deciding classification. */
  private async applyThread(conv: ConvFull, thread: ThreadMessage[]): Promise<Classification | null> {
    const ctx = {
      mailbox: conv.integration.mailboxAddress!,
      internalDomains: this.internalDomains(conv.integration.mailboxAddress!),
      recipients: conv.recipients,
      originalMessageId: conv.originalMessageId,
    };
    const known = new Set((await this.prisma.emailMessage.findMany({ where: { conversationId: conv.id }, select: { providerMessageId: true } })).map((m) => m.providerMessageId));
    const fresh = thread.filter((m) => !known.has(m.id) && m.date >= conv.originalSentAt);
    let decisive: Classification | null = null;
    let lastReplyAt: Date | null = null;

    for (const m of fresh) {
      const c = classifyMessage(m, ctx);
      await this.prisma.emailMessage.create({
        data: {
          conversationId: conv.id,
          providerMessageId: m.id,
          direction: c === 'ORIGINAL' || c === 'OWN_FOLLOW_UP' ? 'OUTBOUND' : 'INBOUND',
          fromAddress: m.from.slice(0, 254),
          subject: m.subject.slice(0, 500),
          classification: c,
          receivedAt: m.date,
        },
      }).catch((err) => {
        if (!isUniqueViolation(err)) throw err;
      });
      if (c === 'QUALIFYING_REPLY') {
        decisive = 'QUALIFYING_REPLY';
        lastReplyAt = m.date;
      } else if ((c === 'BOUNCE' || c === 'AMBIGUOUS') && decisive !== 'QUALIFYING_REPLY') {
        decisive = c;
      }
    }

    if (decisive === 'QUALIFYING_REPLY') {
      await this.prisma.$transaction([
        this.prisma.emailConversation.update({ where: { id: conv.id }, data: { status: 'REPLIED', lastExternalReplyAt: lastReplyAt, nextFollowUpAt: null } }),
        this.prisma.followUpExecution.updateMany({
          where: { conversationId: conv.id, status: { in: ['SCHEDULED', 'DRAFT_CREATED', 'AWAITING_APPROVAL', 'FAILED'] } },
          data: { status: 'CANCELLED', skipReason: 'Supplier replied' },
        }),
      ]);
      await this.notify(conv.ownerId, 'followup.replied', `${conv.supplier?.name ?? 'Supplier'} replied: ${conv.subject}`, conv.id);
      await this.audit.log({ action: 'followup.reply_detected', entityType: 'email_conversation', entityId: conv.id });
    } else if (decisive === 'BOUNCE' || decisive === 'AMBIGUOUS') {
      const reason = decisive === 'BOUNCE' ? 'Delivery failure (bounce) received' : 'Reply from an unexpected sender — please review';
      await this.prisma.emailConversation.update({ where: { id: conv.id }, data: { status: 'NEEDS_REVIEW', pausedReason: reason, nextFollowUpAt: null } });
      await this.notify(conv.ownerId, 'followup.needs_review', `${reason}: ${conv.subject}`, conv.id, 'warning');
    }
    await this.prisma.emailConversation.update({ where: { id: conv.id }, data: { lastCheckedAt: new Date() } });
    return decisive;
  }

  /** Checks one conversation's thread and, if due, prepares or sends the next follow-up. */
  async process(conversationId: string, now = new Date()): Promise<string> {
    const conv = await this.prisma.emailConversation.findUniqueOrThrow({ where: { id: conversationId }, include: convInclude });
    if (!ACTIVE.includes(conv.status)) return conv.status;
    const client = this.mail.forIntegration(conv.integration);
    const decisive = await this.applyThread(conv, await client.getThread(conv.providerThreadId));
    if (decisive) return decisive === 'QUALIFYING_REPLY' ? 'REPLIED' : 'NEEDS_REVIEW';
    if (!conv.rule || !conv.nextFollowUpAt || conv.nextFollowUpAt > now) return conv.status;
    return this.dispatch(conv, client, now);
  }

  private async dispatch(conv: ConvFull, client: MailboxClient, now: Date): Promise<string> {
    const rule = conv.rule!;
    if (!isWithinBusinessHours(now, rule)) {
      await this.prisma.emailConversation.update({ where: { id: conv.id }, data: { nextFollowUpAt: nextBusinessInstant(now, rule) } });
      return 'WAITING_FOR_BUSINESS_HOURS';
    }
    const sequence = conv.followUpCount + 1;
    if (sequence > rule.maxFollowUps) {
      await this.prisma.emailConversation.update({ where: { id: conv.id }, data: { status: 'EXHAUSTED', nextFollowUpAt: null } });
      await this.notify(conv.ownerId, 'followup.exhausted', `No reply after ${rule.maxFollowUps} follow-up(s): ${conv.subject}`, conv.id, 'warning');
      return 'EXHAUSTED';
    }
    const recipients = safeRecipients(conv.recipients, conv.supplier?.contacts.map((c) => c.email) ?? []);
    if (!recipients.length) {
      await this.prisma.emailConversation.update({ where: { id: conv.id }, data: { status: 'NEEDS_REVIEW', pausedReason: 'No approved supplier contact left among the recipients', nextFollowUpAt: null } });
      return 'NEEDS_REVIEW';
    }

    const vars = {
      supplierName: conv.supplier?.name ?? '',
      originalSubject: conv.subject,
      originalSentDate: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: rule.timezone }).format(conv.originalSentAt),
      ownerName: conv.owner.name,
      followUpNumber: String(sequence),
    };
    const subject = replySubject(renderTemplate(rule.template.subjectTemplate, vars)).slice(0, 500);
    const body = renderTemplate(rule.template.bodyTemplate, vars);

    // One execution per (conversation, sequence): the unique index makes a duplicate follow-up impossible.
    let exec = await this.prisma.followUpExecution.findUnique({ where: { conversationId_sequence: { conversationId: conv.id, sequence } } });
    if (!exec) {
      try {
        exec = await this.prisma.followUpExecution.create({
          data: { conversationId: conv.id, sequence, idempotencyKey: `${conv.id}:${sequence}`, scheduledFor: conv.nextFollowUpAt ?? now, recipients, subject, body },
        });
      } catch (err) {
        if (isUniqueViolation(err)) return 'ALREADY_IN_PROGRESS';
        throw err;
      }
    } else if (exec.status !== 'SCHEDULED' && !(exec.status === 'FAILED' && exec.attempts < MAX_SEND_ATTEMPTS)) {
      return exec.status;
    }

    const autoSend = rule.sendMode === 'AUTO_SEND' && Boolean(rule.autoSendApprovedById && rule.autoSendApprovedAt);
    const reply = {
      threadId: conv.providerThreadId,
      replyToMessageId: conv.originalMessageId,
      inReplyToInternetId: conv.originalInternetMessageId,
      from: conv.integration.mailboxAddress!,
      to: recipients,
      subject,
      body,
    };
    const claim = await this.prisma.followUpExecution.updateMany({
      where: { id: exec.id, status: { in: ['SCHEDULED', 'FAILED'] } },
      data: { status: 'SENDING', attempts: { increment: 1 }, attemptedAt: new Date(), subject, body, recipients },
    });
    if (claim.count === 0) return 'ALREADY_IN_PROGRESS';

    try {
      if (autoSend) {
        const sent = await client.sendReply(reply);
        await this.markSent(conv, exec, sent.messageId, null, now);
        return 'SENT';
      }
      const draft = await client.createReplyDraft(reply);
      await this.prisma.$transaction([
        this.prisma.followUpExecution.update({ where: { id: exec.id }, data: { status: 'AWAITING_APPROVAL', providerDraftId: draft.draftId, lastError: null } }),
        this.prisma.emailConversation.update({ where: { id: conv.id }, data: { status: 'AWAITING_APPROVAL' } }),
      ]);
      await this.notify(conv.ownerId, 'followup.draft_ready', `Follow-up #${sequence} drafted for review: ${conv.subject}`, conv.id);
      return 'AWAITING_APPROVAL';
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      const exhausted = exec.attempts + 1 >= MAX_SEND_ATTEMPTS;
      await this.prisma.followUpExecution.update({ where: { id: exec.id }, data: { status: 'FAILED', lastError: message } });
      await this.prisma.emailConversation.update({
        where: { id: conv.id },
        data: exhausted ? { status: 'NEEDS_REVIEW', pausedReason: `Follow-up failed ${MAX_SEND_ATTEMPTS} times: ${message}`.slice(0, 500) } : { status: 'FOLLOWUP_DUE' },
      });
      if (exhausted) await this.notify(conv.ownerId, 'followup.failed', `Follow-up could not be sent: ${conv.subject}`, conv.id, 'error');
      this.logger.warn(`follow-up ${exec.id} failed: ${message}`);
      return 'FAILED';
    }
  }

  private async markSent(conv: ConvFull, exec: FollowUpExecution, messageId: string, approvedById: string | null, now: Date) {
    const count = conv.followUpCount + 1;
    await this.prisma.$transaction([
      this.prisma.followUpExecution.update({ where: { id: exec.id }, data: { status: 'SENT', sentAt: now, providerMessageId: messageId, approvedById, lastError: null } }),
      this.prisma.emailConversation.update({
        where: { id: conv.id },
        // After the last allowed follow-up we still wait one more interval for a reply before marking EXHAUSTED.
        data: { status: 'TRACKING', followUpCount: count, nextFollowUpAt: nextFollowUpAt(now, conv.rule!) },
      }),
    ]);
    await this.audit.log({ actorId: approvedById, action: 'followup.sent', entityType: 'email_conversation', entityId: conv.id, metadata: { sequence: exec.sequence, recipients: exec.recipients, autoSend: !approvedById } });
  }

  /** Reviewer approves a drafted follow-up. The thread is re-checked first: if the supplier replied meanwhile, nothing is sent. */
  async approve(executionId: string, actor: AuthUser, meta: RequestMeta) {
    const exec = await this.prisma.followUpExecution.findUnique({ where: { id: executionId } });
    if (!exec) throw new NotFoundException();
    const conv = await this.prisma.emailConversation.findUniqueOrThrow({ where: { id: exec.conversationId }, include: convInclude });
    this.assertCanAct(conv, actor);
    if (exec.status !== 'AWAITING_APPROVAL') throw new BadRequestException(`This follow-up is ${exec.status.toLowerCase().replace('_', ' ')}`);

    const client = this.mail.forIntegration(conv.integration);
    const decisive = await this.applyThread(conv, await client.getThread(conv.providerThreadId));
    if (decisive === 'QUALIFYING_REPLY') return { status: 'NOT_SENT', reason: 'The supplier has replied in the meantime' };
    if (decisive) return { status: 'NOT_SENT', reason: 'The thread needs review (bounce or unexpected sender)' };

    const claim = await this.prisma.followUpExecution.updateMany({ where: { id: exec.id, status: 'AWAITING_APPROVAL' }, data: { status: 'SENDING', attempts: { increment: 1 }, attemptedAt: new Date(), approvedById: actor.id } });
    if (claim.count === 0) throw new ConflictException('Already being sent');
    try {
      const sent = exec.providerDraftId
        ? await client.sendDraft(exec.providerDraftId, conv.providerThreadId)
        : await client.sendReply({ threadId: conv.providerThreadId, replyToMessageId: conv.originalMessageId, inReplyToInternetId: conv.originalInternetMessageId, from: conv.integration.mailboxAddress!, to: exec.recipients, subject: exec.subject ?? replySubject(conv.subject), body: exec.body ?? '' });
      await this.markSent(conv, exec, sent.messageId, actor.id, new Date());
      await this.audit.log({ actorId: actor.id, action: 'followup.approved', entityType: 'email_conversation', entityId: conv.id, metadata: { executionId: exec.id }, meta });
      return { status: 'SENT' };
    } catch (err) {
      await this.prisma.followUpExecution.update({ where: { id: exec.id }, data: { status: 'AWAITING_APPROVAL', lastError: (err as Error).message.slice(0, 500) } });
      throw new BadRequestException(`Sending failed: ${(err as Error).message}`);
    }
  }

  async skip(executionId: string, actor: AuthUser, meta: RequestMeta) {
    const exec = await this.prisma.followUpExecution.findUnique({ where: { id: executionId }, include: { conversation: { include: { rule: true } } } });
    if (!exec) throw new NotFoundException();
    this.assertCanAct(exec.conversation, actor);
    if (!['AWAITING_APPROVAL', 'FAILED', 'SCHEDULED'].includes(exec.status)) throw new BadRequestException('Nothing to skip');
    await this.prisma.$transaction([
      this.prisma.followUpExecution.update({ where: { id: exec.id }, data: { status: 'SKIPPED', skipReason: `Skipped by ${actor.name}` } }),
      this.prisma.emailConversation.update({
        where: { id: exec.conversationId },
        data: { status: 'TRACKING', followUpCount: { increment: 1 }, nextFollowUpAt: exec.conversation.rule ? nextFollowUpAt(new Date(), exec.conversation.rule) : null },
      }),
    ]);
    await this.audit.log({ actorId: actor.id, action: 'followup.skipped', entityType: 'email_conversation', entityId: exec.conversationId, metadata: { sequence: exec.sequence }, meta });
    return { ok: true };
  }

  async setState(id: string, action: 'pause' | 'resume' | 'cancel' | 'mark-replied', actor: AuthUser, meta: RequestMeta, reason?: string) {
    const conv = await this.prisma.emailConversation.findUnique({ where: { id }, include: { rule: true } });
    if (!conv) throw new NotFoundException();
    this.assertCanAct(conv, actor);
    const closed = ['CANCELLED', 'REPLIED', 'EXHAUSTED'];
    let data: Prisma.EmailConversationUpdateInput;
    switch (action) {
      case 'pause':
        if (closed.includes(conv.status)) throw new BadRequestException('Conversation is closed');
        data = { status: 'PAUSED', pausedReason: reason ?? `Paused by ${actor.name}` };
        break;
      case 'resume':
        if (!['PAUSED', 'NEEDS_REVIEW', 'EXHAUSTED'].includes(conv.status)) throw new BadRequestException('Only paused, review or exhausted conversations can resume');
        if (!conv.rule) throw new BadRequestException('Assign a rule first');
        data = {
          status: 'TRACKING',
          pausedReason: null,
          nextFollowUpAt: nextFollowUpAt(new Date(), conv.rule),
          ...(conv.status === 'EXHAUSTED' && { followUpCount: 0 }),
        };
        break;
      case 'cancel':
        data = { status: 'CANCELLED', nextFollowUpAt: null, pausedReason: reason ?? null };
        break;
      case 'mark-replied':
        data = { status: 'REPLIED', nextFollowUpAt: null, lastExternalReplyAt: new Date(), pausedReason: reason ?? 'Marked as replied manually' };
        break;
    }
    await this.prisma.$transaction([
      this.prisma.emailConversation.update({ where: { id }, data }),
      ...(action === 'cancel' || action === 'mark-replied' || action === 'pause'
        ? [this.prisma.followUpExecution.updateMany({ where: { conversationId: id, status: { in: ['SCHEDULED', 'AWAITING_APPROVAL', 'FAILED'] } }, data: { status: 'CANCELLED', skipReason: `Conversation ${action}` } })]
        : []),
    ]);
    await this.audit.log({ actorId: actor.id, action: `followup.${action}`, entityType: 'email_conversation', entityId: id, metadata: reason ? { reason } : undefined, meta });
    return this.prisma.emailConversation.findUniqueOrThrow({ where: { id } });
  }

  async override(id: string, at: Date, actor: AuthUser, meta: RequestMeta) {
    const conv = await this.prisma.emailConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException();
    this.assertCanAct(conv, actor);
    if (!ACTIVE.includes(conv.status)) throw new BadRequestException('Only active conversations can be rescheduled');
    if (at.getTime() < Date.now() - 60_000) throw new BadRequestException('Choose a time in the future');
    await this.prisma.emailConversation.update({ where: { id }, data: { nextFollowUpAt: at, status: 'TRACKING' } });
    await this.audit.log({ actorId: actor.id, action: 'followup.rescheduled', entityType: 'email_conversation', entityId: id, metadata: { at: at.toISOString() }, meta });
    return { ok: true };
  }

  /** Worker entry point: checks every active conversation. One failure never stops the others. */
  async tick(now = new Date()) {
    // Sends interrupted mid-flight are surfaced, never silently retried (the provider may have sent them).
    const stale = await this.prisma.followUpExecution.findMany({ where: { status: 'SENDING', attemptedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } }, select: { id: true, conversationId: true } });
    for (const s of stale) {
      await this.prisma.$transaction([
        this.prisma.followUpExecution.update({ where: { id: s.id }, data: { status: 'FAILED', attempts: MAX_SEND_ATTEMPTS, lastError: 'Interrupted while sending; check the mailbox before retrying' } }),
        this.prisma.emailConversation.update({ where: { id: s.conversationId }, data: { status: 'NEEDS_REVIEW', pausedReason: 'A send was interrupted; verify in the mailbox' } }),
      ]);
    }
    const convs = await this.prisma.emailConversation.findMany({
      where: { status: { in: [...ACTIVE, 'AWAITING_APPROVAL'] }, integration: { mode: 'LIVE' } },
      select: { id: true, status: true, integrationId: true },
    });
    const results: Record<string, number> = {};
    for (const c of convs) {
      try {
        // Drafts awaiting approval are still checked for replies (which cancel the draft), but nothing new is sent.
        const r = c.status === 'AWAITING_APPROVAL' ? await this.checkOnly(c.id) : await this.process(c.id, now);
        results[r] = (results[r] ?? 0) + 1;
      } catch (err) {
        results.ERROR = (results.ERROR ?? 0) + 1;
        await this.prisma.integration.update({ where: { id: c.integrationId }, data: { lastError: (err as Error).message.slice(0, 500) } }).catch(() => undefined);
        this.logger.warn(`follow-up check ${c.id} failed: ${(err as Error).message}`);
      }
    }
    return { checked: convs.length, staleSends: stale.length, ...results };
  }

  private async checkOnly(id: string) {
    const conv = await this.prisma.emailConversation.findUniqueOrThrow({ where: { id }, include: convInclude });
    const decisive = await this.applyThread(conv, await this.mail.forIntegration(conv.integration).getThread(conv.providerThreadId));
    return decisive === 'QUALIFYING_REPLY' ? 'REPLIED' : decisive ? 'NEEDS_REVIEW' : 'AWAITING_APPROVAL';
  }
}
