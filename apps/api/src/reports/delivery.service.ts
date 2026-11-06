import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

export class DeliveryNotConfiguredError extends Error {}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/** Hosts that chat-webhook URLs may point at. Anything else is refused (prevents SSRF via webhook URLs). */
const CHAT_WEBHOOK_HOSTS: Record<'TEAMS_WEBHOOK' | 'SLACK_WEBHOOK', RegExp> = {
  TEAMS_WEBHOOK: /(^|\.)(webhook\.office\.com|logic\.azure\.com|powerautomate\.com|api\.powerplatform\.com)$/i,
  SLACK_WEBHOOK: /^hooks\.slack\.com$/i,
};

export function validateChatWebhookUrl(kind: 'TEAMS_WEBHOOK' | 'SLACK_WEBHOOK', raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Not a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error('Webhook URL must use https');
  if (url.username || url.password || url.port) throw new Error('Webhook URL must not contain credentials or a port');
  if (!CHAT_WEBHOOK_HOSTS[kind].test(url.hostname)) {
    throw new Error(kind === 'TEAMS_WEBHOOK' ? 'Use a Microsoft Teams / Power Automate workflow webhook URL' : 'Use a Slack incoming-webhook URL (hooks.slack.com)');
  }
  return url.toString();
}

/**
 * Outbound delivery. Email goes through a configured SMTP relay (TLS required outside development);
 * chat delivery posts a PII-free summary to an allow-listed webhook. Nothing reports success
 * unless the remote side accepted the message.
 */
@Injectable()
export class DeliveryService {
  private transporter?: Transporter;

  emailStatus(): { configured: boolean; detail: string } {
    const e = env();
    if (!e.SMTP_HOST || !e.SMTP_FROM) return { configured: false, detail: 'SMTP_HOST and SMTP_FROM are not set' };
    return { configured: true, detail: `${e.SMTP_HOST}:${e.SMTP_PORT}${e.SMTP_SECURE ? ' (TLS)' : e.SMTP_ALLOW_INSECURE ? ' (plaintext, dev only)' : ' (STARTTLS required)'}` };
  }

  private transport(): Transporter {
    const e = env();
    if (!e.SMTP_HOST || !e.SMTP_FROM) throw new DeliveryNotConfiguredError('Email delivery is not configured (SMTP_HOST / SMTP_FROM)');
    this.transporter ??= nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      requireTLS: !e.SMTP_SECURE && !e.SMTP_ALLOW_INSECURE,
      ignoreTLS: e.SMTP_ALLOW_INSECURE && !e.SMTP_SECURE,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
    return this.transporter;
  }

  async sendEmail(to: string, subject: string, text: string, attachments: MailAttachment[]): Promise<string> {
    const info = await this.transport().sendMail({ from: env().SMTP_FROM, to, subject, text, attachments });
    if (!info.accepted?.length) throw new Error(`Recipient rejected: ${JSON.stringify(info.rejected)}`);
    return info.messageId;
  }

  async postChat(kind: 'TEAMS_WEBHOOK' | 'SLACK_WEBHOOK', url: string, title: string, lines: string[], link: string): Promise<void> {
    const safeUrl = validateChatWebhookUrl(kind, url);
    const body =
      kind === 'SLACK_WEBHOOK'
        ? { text: `*${title}*\n${lines.join('\n')}\n<${link}|Open in OPERAFlow>` }
        : {
            type: 'message',
            attachments: [
              {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: {
                  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                  type: 'AdaptiveCard',
                  version: '1.4',
                  body: [
                    { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
                    ...lines.map((l) => ({ type: 'TextBlock', text: l, wrap: true, spacing: 'Small' })),
                  ],
                  actions: [{ type: 'Action.OpenUrl', title: 'Open in OPERAFlow', url: link }],
                },
              },
            ],
          };
    const res = await fetch(safeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
}
