import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getMe } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, formatDateTime } from '@/components/ui';
import { AdhocReport, RecipientManager, ScheduleActions, ScheduleForm } from './report-forms';

export const metadata: Metadata = { title: 'Daily reports' };

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  formats: string[];
  recipients: string[];
  filters: { period?: string; dateField?: string; channel?: string; includeCancelled?: boolean };
  isEnabled: boolean;
  lastPreviewedAt: string | null;
  simple: { timeOfDay: string; daysOfWeek: number[] } | null;
  nextRuns: string[];
  channelIntegration: { id: string; name: string; kind: string; status: string } | null;
  runs: { id: string; status: string; createdAt: string; deliveries: { status: string }[] }[];
}
interface Run {
  id: string;
  status: string;
  isPreview: boolean;
  rowCount: number | null;
  createdAt: string;
  summary: { reportDate?: string } | null;
  scheduledReport: { id: string; name: string } | null;
  triggeredBy: { name: string } | null;
  deliveries: { status: string }[];
}
interface Recipient {
  id: string;
  email: string;
  label: string | null;
  approvedBy: { name: string } | null;
}
interface Integration {
  id: string;
  kind: string;
  name: string;
  mode: string;
  status: string;
}
interface AutomationStatus {
  redisConfigured: boolean;
  worker: { lastHeartbeat: string | null; healthy: boolean };
  email: { configured: boolean; detail: string };
}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function describeSchedule(s: Schedule) {
  if (!s.simple) return s.cron;
  const days = s.simple.daysOfWeek.length === 7 ? 'Every day' : s.simple.daysOfWeek.map((d) => DAY[d]).join(', ');
  return `${days} at ${s.simple.timeOfDay}`;
}

export default async function ReportsPage() {
  const [me, schedules, runs, recipients, integrations, automation] = await Promise.all([
    getMe(),
    apiGet<Schedule[]>('/reports/schedules'),
    apiGet<Run[]>('/reports/runs'),
    apiGet<Recipient[]>('/reports/recipients'),
    apiGet<Integration[]>('/integrations').catch(() => [] as Integration[]),
    apiGet<AutomationStatus>('/integrations/status'),
  ]);
  const canManage = me.permissions.includes('reports:manage');
  const canApprove = me.permissions.includes('reports:approve-recipients');
  const channels = integrations.filter((i) => (i.kind === 'TEAMS_WEBHOOK' || i.kind === 'SLACK_WEBHOOK') && i.mode === 'LIVE');

  return (
    <>
      <PageHeader title="Daily operations reports" description="Excel/PDF reports built from the booking registry, scheduled in your timezone and delivered only to approved recipients." />

      <div className="mb-4 flex flex-wrap gap-2 text-[12.5px]">
        <Badge tone={automation.worker.healthy ? 'ok' : 'warn'}>
          Scheduler: {automation.worker.healthy ? 'running' : automation.redisConfigured ? 'worker not running' : 'inactive (REDIS_URL not set)'}
        </Badge>
        <Badge tone={automation.email.configured ? 'ok' : 'warn'}>Email: {automation.email.configured ? automation.email.detail : 'not configured (SMTP)'}</Badge>
        {!automation.worker.healthy && <span className="text-ink-3">Schedules will not fire until the worker runs. Manual runs and previews still work.</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {schedules.length === 0 && (
            <Card><EmptyState title="No report schedules yet">Create one, generate a preview to check the content, then enable it.</EmptyState></Card>
          )}
          {schedules.map((s) => {
            const last = s.runs[0];
            return (
              <Card
                key={s.id}
                title={s.name}
                aside={<span className="flex gap-1.5">{s.isEnabled ? <Badge tone="ok">Enabled</Badge> : <Badge tone="warn">Disabled</Badge>}{s.formats.map((f) => <Badge key={f}>{f}</Badge>)}</span>}
              >
                <div className="grid gap-4 p-4 md:grid-cols-2">
                  <dl className="space-y-1.5 text-[13px]">
                    <div><dt className="inline text-ink-3">When: </dt><dd className="inline">{describeSchedule(s)} ({s.timezone})</dd></div>
                    <div><dt className="inline text-ink-3">Covers: </dt><dd className="inline">{s.filters.period === 'CURRENT_DAY' ? 'the same day' : 'the previous day'} · {s.filters.dateField === 'checkIn' ? 'arrivals' : 'bookings made'}{s.filters.channel ? ` · ${s.filters.channel.toLowerCase()} only` : ''}</dd></div>
                    <div><dt className="inline text-ink-3">Recipients: </dt><dd className="inline">{s.recipients.length ? s.recipients.join(', ') : '—'}</dd></div>
                    <div><dt className="inline text-ink-3">Chat channel: </dt><dd className="inline">{s.channelIntegration ? `${s.channelIntegration.name} (${s.channelIntegration.status.toLowerCase().replace('_', ' ')})` : '—'}</dd></div>
                    <div><dt className="inline text-ink-3">Last preview: </dt><dd className="inline">{formatDateTime(s.lastPreviewedAt)}</dd></div>
                    {s.isEnabled && s.nextRuns[0] && <div><dt className="inline text-ink-3">Next run: </dt><dd className="inline">{formatDateTime(s.nextRuns[0])}</dd></div>}
                    {last && (
                      <div>
                        <dt className="inline text-ink-3">Last run: </dt>
                        <dd className="inline">
                          <Link href={`/reports/runs/${last.id}`} className="text-brand hover:underline">{formatDateTime(last.createdAt)}</Link>{' '}
                          · {last.deliveries.filter((d) => d.status === 'SENT').length}/{last.deliveries.length} delivered
                        </dd>
                      </div>
                    )}
                  </dl>
                  {canManage && <ScheduleActions schedule={s} />}
                </div>
                {canManage && (
                  <details className="border-t border-line">
                    <summary className="cursor-pointer px-4 py-2 text-[12.5px] text-brand">Edit schedule</summary>
                    <ScheduleForm schedule={s} recipients={recipients.map((r) => r.email)} channels={channels} />
                  </details>
                )}
              </Card>
            );
          })}

          <Card title="Recent report runs">
            {runs.length === 0 ? (
              <EmptyState title="No reports generated yet" />
            ) : (
              <Table head={['Generated', 'Report', 'Day', 'Type', 'Rows', 'Status', 'Delivered']}>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap"><Link href={`/reports/runs/${r.id}`} className="text-brand hover:underline">{formatDateTime(r.createdAt)}</Link></Td>
                    <Td>{r.scheduledReport?.name ?? 'Ad-hoc report'}</Td>
                    <Td className="num">{r.summary?.reportDate ?? '—'}</Td>
                    <Td>{r.isPreview ? <Badge>Preview</Badge> : <Badge tone="brand">{r.triggeredBy ? 'Manual' : 'Scheduled'}</Badge>}</Td>
                    <Td className="num">{r.rowCount ?? '—'}</Td>
                    <Td><StatusBadge value={r.status} /></Td>
                    <Td className="num">
                      {r.deliveries.length ? `${r.deliveries.filter((d) => d.status === 'SENT').length}/${r.deliveries.length}` : '—'}
                      {r.deliveries.some((d) => d.status === 'FAILED') && <span className="ml-1"><Badge tone="bad">failed</Badge></span>}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {canManage && (
            <Card title="New schedule">
              <ScheduleForm recipients={recipients.map((r) => r.email)} channels={channels} />
            </Card>
          )}
          <Card title="One-off report">
            <AdhocReport />
          </Card>
          <Card title="Approved recipients">
            <RecipientManager recipients={recipients} canApprove={canApprove} />
          </Card>
        </div>
      </div>
    </>
  );
}
