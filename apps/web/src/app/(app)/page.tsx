import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, formatDateTime } from '@/components/ui';

export const metadata: Metadata = { title: 'Dashboard' };

interface Summary {
  timezone: string;
  date: string;
  bookings: { today: number; online: number; offline: number; pendingConfirmations: number; missingInfo: number } | null;
  followUps: { due: number; needsReview: number } | null;
  tests: { failedLast24h: number; criticalFailedLast24h: number; environmentsConfigured: number } | null;
  reports: { scheduledEnabled: number; failedDeliveries: number } | null;
  automation: {
    integrations: { kind: string; mode: string; status: string; _count: number }[];
    failedJobsLast24h: number;
  };
  recentActivity: { id: string; action: string; entityType: string; createdAt: string; actor: { name: string } | null }[] | null;
  unreadNotifications: number;
}

interface AutomationStatus {
  redisConfigured: boolean;
  worker: { lastHeartbeat: string | null; healthy: boolean };
  email: { configured: boolean; detail: string };
  oauth: { google: boolean; microsoft: boolean };
}

function L({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="block rounded-lg transition-shadow hover:shadow-[0_0_0_2px_var(--color-brand-soft)]">{children}</Link>;
}

export default async function DashboardPage() {
  const [s, status] = await Promise.all([apiGet<Summary>('/dashboard/summary'), apiGet<AutomationStatus>('/integrations/status')]);
  const dateLabel = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full' }).format(new Date(`${s.date}T12:00:00Z`));

  return (
    <>
      <PageHeader title="Operations overview" description={`${dateLabel} · figures computed live in ${s.timezone}`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {s.bookings && (
          <>
            <L href={`/bookings?dateField=bookingDate&from=${s.date}&to=${s.date}`}><Stat label="Bookings today" value={s.bookings.today} hint={`${s.bookings.online} online · ${s.bookings.offline} offline`} /></L>
            <L href="/bookings?confirmationStatus=PENDING"><Stat label="Pending confirmations" value={s.bookings.pendingConfirmations} tone={s.bookings.pendingConfirmations ? 'warn' : undefined} /></L>
            <L href="/bookings?missingData=true"><Stat label="Missing booking data" value={s.bookings.missingInfo} tone={s.bookings.missingInfo ? 'warn' : undefined} hint="Amounts, supplier, hotel or owner" /></L>
          </>
        )}
        {s.followUps && <L href="/follow-ups"><Stat label="Follow-ups due" value={s.followUps.due} hint={`${s.followUps.needsReview} need review`} /></L>}
        {s.tests && (
          <L href="/testing">
            <Stat label="Failed tests (24h)" value={s.tests.failedLast24h} tone={s.tests.criticalFailedLast24h ? 'bad' : undefined} hint={`${s.tests.criticalFailedLast24h} critical`} />
          </L>
        )}
        {s.reports && <L href="/reports"><Stat label="Scheduled reports" value={s.reports.scheduledEnabled} hint={`${s.reports.failedDeliveries} failed deliveries`} /></L>}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card
          title="Recent activity"
          aside={s.recentActivity ? <Link href="/audit" className="text-[12.5px] text-brand hover:underline">Full audit log</Link> : undefined}
        >
          {s.recentActivity === null ? (
            <EmptyState title="Activity is visible to administrators and operations managers" />
          ) : s.recentActivity.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <Table head={['When', 'Who', 'Action', 'Entity']}>
              {s.recentActivity.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap text-ink-3">{formatDateTime(a.createdAt)}</Td>
                  <Td>{a.actor?.name ?? 'System'}</Td>
                  <Td><code className="font-mono text-[12px]">{a.action}</code></Td>
                  <Td className="text-ink-3">{a.entityType}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Automation health">
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[13px] text-ink-2">Scheduler / worker</span>
              <Badge tone={status.worker.healthy ? 'ok' : 'warn'}>{status.worker.healthy ? 'Running' : status.redisConfigured ? 'Not running' : 'Inactive (no Redis)'}</Badge>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[13px] text-ink-2">Report email</span>
              <Badge tone={status.email.configured ? 'ok' : 'warn'}>{status.email.configured ? 'Configured' : 'Not configured'}</Badge>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[13px] text-ink-2">Mailbox OAuth</span>
              <Badge tone={status.oauth.google || status.oauth.microsoft ? 'ok' : 'warn'}>
                {[status.oauth.google && 'Google', status.oauth.microsoft && 'Microsoft'].filter(Boolean).join(' + ') || 'Not configured'}
              </Badge>
            </div>
            <HealthRow label="Background jobs failed (24h)" value={s.automation.failedJobsLast24h} />
            {s.tests && (
              <HealthRow
                label="Test environments configured"
                value={s.tests.environmentsConfigured}
                warnWhenZero="No sandbox environment configured"
              />
            )}
          </div>
          <div className="border-t border-line px-4 py-3">
            <div className="mb-2 text-[12px] font-medium text-ink-3">Integrations</div>
            {s.automation.integrations.length === 0 ? (
              <p className="text-[13px] text-ink-3">
                No integrations connected. Connect mailboxes and chat channels under <Link href="/integrations" className="text-brand hover:underline">Integrations</Link>, and the booking website under <Link href="/sources" className="text-brand hover:underline">Booking sources</Link>.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {s.automation.integrations.map((i) => (
                  <li key={`${i.kind}-${i.mode}-${i.status}`} className="flex items-center justify-between text-[13px]">
                    <span>{i.kind}</span>
                    <span className="flex gap-1">
                      <Badge tone={i.mode === 'LIVE' ? 'brand' : 'neutral'}>{i.mode}</Badge>
                      <Badge tone={i.status === 'CONNECTED' ? 'ok' : i.status === 'ERROR' ? 'bad' : 'warn'}>{i.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function HealthRow({ label, value, warnWhenZero }: { label: string; value: number; warnWhenZero?: string }) {
  const warn = warnWhenZero && value === 0;
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-[13px] text-ink-2">{label}</span>
      {warn ? <Badge tone="warn">{warnWhenZero}</Badge> : <span className="num font-medium">{value}</span>}
    </div>
  );
}
