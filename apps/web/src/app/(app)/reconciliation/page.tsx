import type { Metadata } from 'next';
import Link from 'next/link';
import { ISSUE_TYPES, LABELS } from '@operaflow/shared';
import { apiGet, getMe } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, formatDateTime } from '@/components/ui';
import { IssueActions, RunReconciliation } from './actions';

export const metadata: Metadata = { title: 'Reconciliation' };

interface BookingRef {
  id: string;
  internalRef: string;
  channel: string;
  status: string;
}
interface Issue {
  id: string;
  type: string;
  status: string;
  details: { fields?: string[]; crossChannel?: boolean; bookings?: { internalRef: string; source: string; sellingAmount: string | null; currency: string; status: string }[] };
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  booking: BookingRef | null;
  matchedBooking: BookingRef | null;
  resolvedBy: { name: string } | null;
}
interface Data {
  items: Issue[];
  counts: { type: string; status: string; _count: number }[];
  lastRun: { createdAt: string; status: string; result: Record<string, number> | null } | null;
}

const FIELD_NAMES: Record<string, string> = {
  sellingAmount: 'selling price', costAmount: 'supplier cost', supplier: 'supplier', hotel: 'hotel', assignedTo: 'owner', confirmationNumber: 'confirmation number',
};

function explain(i: Issue): string {
  const [a, b] = i.details.bookings ?? [];
  switch (i.type) {
    case 'MISSING_REQUIRED_DATA':
      return `Missing ${i.details.fields?.map((f) => FIELD_NAMES[f] ?? f).join(', ') ?? 'data'}`;
    case 'AMOUNT_MISMATCH':
      return `Selling price differs: ${a?.sellingAmount ?? '—'} ${a?.currency} (${a?.source}) vs ${b?.sellingAmount ?? '—'} ${b?.currency} (${b?.source})`;
    case 'STATUS_MISMATCH':
      return `Status differs: ${LABELS[a?.status ?? ''] ?? a?.status} (${a?.source}) vs ${LABELS[b?.status ?? ''] ?? b?.status} (${b?.source})`;
    case 'DUPLICATE_SUSPECT':
      return i.details.crossChannel ? 'Same guest, hotel and dates recorded online and offline' : 'Same guest, hotel and dates recorded twice';
    default:
      return '';
  }
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status ?? 'OPEN';
  const qs = new URLSearchParams({ ...(status !== 'ALL' && { status }), ...(sp.type && { type: sp.type }) });
  const [me, data] = await Promise.all([getMe(), apiGet<Data>(`/reconciliation/issues?${qs}`)]);
  const canReconcile = me.permissions.includes('bookings:reconcile');
  const openCount = (t: string) => data.counts.filter((c) => c.type === t && c.status === 'OPEN').reduce((n, c) => n + c._count, 0);
  const link = (over: Record<string, string | undefined>) => {
    const n = new URLSearchParams({ status, ...(sp.type && { type: sp.type }) });
    for (const [k, v] of Object.entries(over)) {
      if (v) n.set(k, v);
      else n.delete(k);
    }
    return `/reconciliation?${n}`;
  };

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Cross-checks online and offline records: possible duplicates, price or status disagreements for the same stay, and bookings missing data operations needs."
        actions={canReconcile && <RunReconciliation />}
      />
      <p className="-mt-3 mb-4 text-[12.5px] text-ink-3">
        {data.lastRun
          ? `Last run ${formatDateTime(data.lastRun.createdAt)} · ${data.lastRun.status.toLowerCase()}${data.lastRun.result ? ` · ${data.lastRun.result.newIssues} new, ${data.lastRun.result.autoResolved} auto-resolved` : ''}`
          : 'Never run. Run it now, or after each import.'}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {ISSUE_TYPES.filter((t) => t !== 'MISSING_IN_SOURCE').map((t) => (
          <Link key={t} href={link({ type: sp.type === t ? undefined : t })} className={`rounded-lg border bg-surface px-4 py-3 ${sp.type === t ? 'border-brand' : 'border-line'}`}>
            <div className="text-[12px] font-medium text-ink-3">{LABELS[t]}</div>
            <div className="num mt-1 text-[22px] font-semibold">{openCount(t)}</div>
            <div className="text-[11.5px] text-ink-3">open</div>
          </Link>
        ))}
      </div>

      <Card
        title={`${data.items.length} issue${data.items.length === 1 ? '' : 's'}`}
        aside={
          <div className="flex gap-1 text-[12.5px]">
            {['OPEN', 'RESOLVED', 'DISMISSED', 'ALL'].map((s) => (
              <Link key={s} href={link({ status: s })} className={`rounded px-2 py-0.5 ${status === s ? 'bg-brand-soft font-medium text-brand' : 'text-ink-3 hover:bg-sunken'}`}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </Link>
            ))}
          </div>
        }
      >
        {data.items.length === 0 ? (
          <EmptyState title={status === 'OPEN' ? 'Nothing to reconcile' : 'No issues'} />
        ) : (
          <Table head={['Detected', 'Type', 'Bookings', 'Detail', 'Status', '']}>
            {data.items.map((i) => (
              <tr key={i.id}>
                <Td className="whitespace-nowrap text-ink-3">{formatDateTime(i.createdAt)}</Td>
                <Td className="whitespace-nowrap"><Badge tone={i.type === 'MISSING_REQUIRED_DATA' ? 'warn' : 'bad'}>{LABELS[i.type]}</Badge></Td>
                <Td className="whitespace-nowrap">
                  {[i.booking, i.matchedBooking].filter(Boolean).map((b) => (
                    <div key={b!.id}>
                      <Link href={`/bookings/${b!.id}`} className="font-mono text-[12.5px] text-brand hover:underline">{b!.internalRef}</Link>
                      <span className="ml-1.5 text-[11px] text-ink-3">{b!.channel.toLowerCase()}</span>
                    </div>
                  ))}
                </Td>
                <Td className="max-w-[420px] text-[12.5px] text-ink-2">
                  {explain(i)}
                  {i.resolutionNote && <div className="mt-1 text-ink-3">“{i.resolutionNote}”{i.resolvedBy && ` · ${i.resolvedBy.name}`}</div>}
                </Td>
                <Td><StatusBadge value={i.status} /></Td>
                <Td className="text-right">{canReconcile && i.status === 'OPEN' && <IssueActions id={i.id} />}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
