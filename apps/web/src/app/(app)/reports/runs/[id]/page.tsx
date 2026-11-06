import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getMe } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, formatDateTime } from '@/components/ui';
import { RetryDeliveries } from './retry';

export const metadata: Metadata = { title: 'Report run' };

interface RunDetail {
  id: string;
  status: string;
  isPreview: boolean;
  timezone: string;
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  generatedAt: string | null;
  warnings: { internalRef: string | null; message: string }[];
  files: { format: string; fileName: string; sizeBytes: number }[];
  summary: {
    reportDate?: string;
    total?: number;
    online?: number;
    offline?: number;
    pendingConfirmation?: number;
    cancelled?: number;
    withMissingData?: number;
    currencies?: { currency: string; bookings: number; selling: string; sellingMissing: number; cost: string; costMissing: number; margin: string; marginExcluded: number }[];
    openReconciliationIssues?: Record<string, number>;
  } | null;
  scheduledReport: { id: string; name: string; recipients: string[]; channelIntegration: { name: string; kind: string } | null } | null;
  triggeredBy: { name: string } | null;
  deliveries: { id: string; channel: string; recipient: string; status: string; attempts: number; lastError: string | null; sentAt: string | null }[];
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, run] = await Promise.all([getMe(), apiGet<RunDetail>(`/reports/runs/${id}`)]);
  const s = run.summary ?? {};
  const canManage = me.permissions.includes('reports:manage');
  const hasFailures = run.deliveries.some((d) => d.status === 'FAILED' || d.status === 'PENDING');

  return (
    <>
      <div className="mb-2 text-[12.5px]"><Link href="/reports" className="text-brand hover:underline">← Reports</Link></div>
      <PageHeader
        title={`${run.scheduledReport?.name ?? 'Ad-hoc report'} · ${s.reportDate ?? ''}`}
        description={`${run.isPreview ? 'Preview (not delivered)' : run.triggeredBy ? `Manual run by ${run.triggeredBy.name}` : 'Scheduled run'} · generated ${formatDateTime(run.generatedAt ?? run.createdAt)} · ${run.timezone}`}
        actions={
          <span className="flex gap-2">
            <StatusBadge value={run.status} />
            {run.files.map((f) => (
              <a key={f.format} href={`/api/reports/runs/${run.id}/files/${f.format.toLowerCase()}`} className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-sunken">
                Download {f.format}
              </a>
            ))}
          </span>
        }
      />
      {run.error && <p className="mb-4 rounded-md bg-bad-soft px-4 py-2.5 text-[13px] text-bad">Generation failed: {run.error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Bookings" value={s.total ?? 0} />
        <Stat label="Online" value={s.online ?? 0} />
        <Stat label="Offline" value={s.offline ?? 0} />
        <Stat label="Pending confirmation" value={s.pendingConfirmation ?? 0} tone={s.pendingConfirmation ? 'warn' : undefined} />
        <Stat label="Cancelled" value={s.cancelled ?? 0} />
        <Stat label="Missing data" value={s.withMissingData ?? 0} tone={s.withMissingData ? 'warn' : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Totals by currency (active bookings)">
          {!s.currencies?.length ? (
            <EmptyState title="No active bookings in this period" />
          ) : (
            <Table head={['Currency', 'Bookings', 'Selling', 'Cost', 'Margin']}>
              {s.currencies.map((c) => (
                <tr key={c.currency}>
                  <Td className="font-medium">{c.currency}</Td>
                  <Td className="num">{c.bookings}</Td>
                  <Td className="num">{Number(c.selling).toLocaleString('en-US', { minimumFractionDigits: 2 })}{c.sellingMissing > 0 && <span className="ml-1 text-warn">+{c.sellingMissing} missing</span>}</Td>
                  <Td className="num">{Number(c.cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}{c.costMissing > 0 && <span className="ml-1 text-warn">+{c.costMissing} missing</span>}</Td>
                  <Td className="num">{Number(c.margin).toLocaleString('en-US', { minimumFractionDigits: 2 })}{c.marginExcluded > 0 && <span className="ml-1 text-warn">({c.marginExcluded} excluded)</span>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Delivery" aside={canManage && !run.isPreview && run.scheduledReport && hasFailures ? <RetryDeliveries runId={run.id} /> : undefined}>
          {run.isPreview ? (
            <EmptyState title="Previews are never delivered" />
          ) : run.deliveries.length === 0 ? (
            <EmptyState title="Not delivered">This run was generated without sending.</EmptyState>
          ) : (
            <Table head={['Recipient', 'Status', 'Attempts', 'Detail']}>
              {run.deliveries.map((d) => (
                <tr key={d.id}>
                  <Td>{d.channel === 'EMAIL' ? d.recipient : `${run.scheduledReport?.channelIntegration?.name ?? 'Chat channel'}`}</Td>
                  <Td><StatusBadge value={d.status} /></Td>
                  <Td className="num">{d.attempts}</Td>
                  <Td className="text-[12.5px] text-ink-3">{d.status === 'SENT' ? formatDateTime(d.sentAt) : d.lastError ?? '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title={`Data-quality warnings (${run.warnings.length})`} className="xl:col-span-2">
          {run.warnings.length === 0 ? (
            <EmptyState title="No warnings" />
          ) : (
            <ul className="divide-y divide-line">
              {run.warnings.map((w, i) => (
                <li key={i} className="px-4 py-2 text-[13px]">
                  {w.internalRef ? <Badge tone="warn">{w.internalRef}</Badge> : <Badge>Summary</Badge>} <span className="ml-1.5 text-ink-2">{w.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
