import type { Metadata } from 'next';
import { apiGet, getMe } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, formatDateTime } from '@/components/ui';
import { AddChatWebhook, IntegrationRowActions } from './integration-forms';
import { MailboxConnect } from './mailbox-connect';

export const metadata: Metadata = { title: 'Integrations' };

export interface IntegrationRow {
  id: string;
  kind: string;
  name: string;
  mode: string;
  status: string;
  mailboxAddress: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  hasSecret: boolean;
  owner: { name: string } | null;
  _count: { bookingSources: number; conversations: number; reports: number };
}
interface AutomationStatus {
  redisConfigured: boolean;
  worker: { lastHeartbeat: string | null; healthy: boolean };
  email: { configured: boolean; detail: string };
  oauth?: { google: boolean; microsoft: boolean };
}

const KIND_LABEL: Record<string, string> = {
  GMAIL: 'Gmail mailbox', MICROSOFT_GRAPH: 'Microsoft 365 mailbox', BOOKING_WEBHOOK: 'Booking webhook', BOOKING_API: 'Booking API',
  TEAMS_WEBHOOK: 'Teams channel', SLACK_WEBHOOK: 'Slack channel', TBO: 'TBO', CSV_ADAPTER: 'CSV adapter', SMTP: 'SMTP',
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string; oauth_error?: string }> }) {
  const sp = await searchParams;
  const [me, items, status] = await Promise.all([getMe(), apiGet<IntegrationRow[]>('/integrations'), apiGet<AutomationStatus>('/integrations/status')]);
  const canManage = me.permissions.includes('integrations:manage');

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Every external connection, labelled by what it really is. A connection shows Connected only after a real call has succeeded. Secrets are encrypted and never displayed."
      />
      {sp.connected && <p className="mb-4 rounded-md bg-ok-soft px-4 py-2.5 text-[13px] text-ok">Mailbox {sp.connected} connected.</p>}
      {sp.oauth_error && <p className="mb-4 rounded-md bg-bad-soft px-4 py-2.5 text-[13px] text-bad">Mailbox connection failed: {sp.oauth_error}</p>}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Card title="Background worker">
          <div className="space-y-1 px-4 py-3 text-[13px]">
            <Badge tone={status.worker.healthy ? 'ok' : 'warn'}>{status.worker.healthy ? 'Running' : 'Not running'}</Badge>
            <p className="text-ink-3">{status.redisConfigured ? `Last heartbeat: ${formatDateTime(status.worker.lastHeartbeat)}` : 'REDIS_URL is not set: schedules, follow-ups and scheduled tests do not run automatically.'}</p>
          </div>
        </Card>
        <Card title="Report email (SMTP)">
          <div className="space-y-1 px-4 py-3 text-[13px]">
            <Badge tone={status.email.configured ? 'ok' : 'warn'}>{status.email.configured ? 'Configured' : 'Not configured'}</Badge>
            <p className="text-ink-3">{status.email.detail}</p>
          </div>
        </Card>
        <Card title="Mailbox OAuth apps">
          <div className="space-y-1 px-4 py-3 text-[13px]">
            <div className="flex gap-1.5">
              <Badge tone={status.oauth?.google ? 'ok' : 'warn'}>Google {status.oauth?.google ? 'configured' : 'not configured'}</Badge>
              <Badge tone={status.oauth?.microsoft ? 'ok' : 'warn'}>Microsoft {status.oauth?.microsoft ? 'configured' : 'not configured'}</Badge>
            </div>
            <p className="text-ink-3">Client IDs and secrets come from your Google Workspace / Entra ID admin (see docs/CREDENTIALS.md).</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card title={`${items.length} connection${items.length === 1 ? '' : 's'}`}>
          {items.length === 0 ? (
            <EmptyState title="Nothing connected yet" />
          ) : (
            <Table head={['Name', 'Type', 'Mode', 'Status', 'Last success', 'Used by', ...(canManage ? [''] : [])]}>
              {items.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">
                    {i.name}
                    {i.mailboxAddress && <div className="text-[11.5px] font-normal text-ink-3">{i.mailboxAddress}</div>}
                    {i.lastError && <div className="max-w-[320px] truncate text-[11.5px] font-normal text-bad" title={i.lastError}>{i.lastError}</div>}
                  </Td>
                  <Td>{KIND_LABEL[i.kind] ?? i.kind}</Td>
                  <Td><StatusBadge value={i.mode} /></Td>
                  <Td><StatusBadge value={i.status} /></Td>
                  <Td className="whitespace-nowrap text-ink-3">{formatDateTime(i.lastSyncAt)}</Td>
                  <Td className="text-[12.5px] text-ink-3">
                    {[i._count.bookingSources && `${i._count.bookingSources} source`, i._count.reports && `${i._count.reports} report`, i._count.conversations && `${i._count.conversations} threads`].filter(Boolean).join(' · ') || '—'}
                  </Td>
                  {canManage && <Td className="text-right"><IntegrationRowActions integration={i} /></Td>}
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {canManage && (
          <div className="space-y-4">
            <Card title="Connect a mailbox">
              <MailboxConnect google={Boolean(status.oauth?.google)} microsoft={Boolean(status.oauth?.microsoft)} />
            </Card>
            <Card title="Add a chat channel">
              <AddChatWebhook />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
