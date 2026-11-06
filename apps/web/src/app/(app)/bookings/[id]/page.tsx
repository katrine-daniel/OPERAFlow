import type { Metadata } from 'next';
import Link from 'next/link';
import { LABELS } from '@operaflow/shared';
import { apiGet, getMe } from '@/lib/api';
import type { BookingDetail } from '@/lib/types';
import { Badge, Card, EmptyState, PageHeader, StatusBadge, buttonClass, formatDate, formatDateTime, formatMoney } from '@/components/ui';
import { BookingActions } from './booking-actions';
import { DocumentUpload } from './document-upload';

export const metadata: Metadata = { title: 'Booking' };

const FIELD_LABELS: Record<string, string> = {
  sellingAmount: 'Selling price', costAmount: 'Supplier cost', supplier: 'Supplier', hotel: 'Hotel', assignedTo: 'Owner',
  confirmationNumber: 'Confirmation number', taxAmount: 'Taxes', leadGuestName: 'Guest name', guestEmail: 'Guest email',
  guestPhone: 'Guest phone', checkIn: 'Check-in', checkOut: 'Check-out', supplierId: 'Supplier', hotelId: 'Hotel',
  assignedToId: 'Owner', externalRef: 'Supplier ref', paymentStatus: 'Payment', confirmationStatus: 'Confirmation',
  cancellationStatus: 'Cancellation', status: 'Status', roomType: 'Room type', boardBasis: 'Board', notes: 'Notes',
};

function Dl({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{k}</dt>
          <dd className="mt-0.5 break-words">{v ?? <span className="text-ink-3">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function describeDiff(diff: Record<string, unknown>): string[] {
  return Object.entries(diff).map(([k, v]) => {
    const label = FIELD_LABELS[k] ?? k;
    if (v && typeof v === 'object' && 'changed' in v) return `${label} changed`;
    if (v && typeof v === 'object' && 'from' in v) {
      const { from, to } = v as { from: unknown; to: unknown };
      const fmt = (x: unknown) => (x === null || x === '' ? 'empty' : typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00/.test(x) ? x.slice(0, 10) : String(LABELS[String(x)] ?? x));
      return `${label}: ${fmt(from)} → ${fmt(to)}`;
    }
    if (Array.isArray(v)) return `${label}: ${v.join(', ')}`;
    return `${label}: ${String(v)}`;
  });
}

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, b] = await Promise.all([getMe(), apiGet<BookingDetail>(`/bookings/${id}`)]);
  const canWrite = me.permissions.includes('bookings:write');
  const issues = [...b.reconciliationIssues, ...b.matchedIssues];

  return (
    <>
      <div className="mb-2 text-[12.5px]"><Link href="/bookings" className="text-brand hover:underline">← Booking registry</Link></div>
      <PageHeader
        title={b.internalRef}
        description={`${b.source.name}${b.externalRef ? ` · supplier ref ${b.externalRef}` : ''} · booked ${formatDateTime(b.bookingDate)}`}
        actions={canWrite && <BookingActions booking={b} />}
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <StatusBadge value={b.channel} />
        <StatusBadge value={b.status} label={LABELS[b.status]} />
        <StatusBadge value={b.confirmationStatus} label={`Confirmation: ${LABELS[b.confirmationStatus]}`} />
        <StatusBadge value={b.paymentStatus} label={`Payment: ${LABELS[b.paymentStatus]}`} />
        {b.cancellationStatus !== 'NONE' && <StatusBadge value={b.cancellationStatus} label={LABELS[b.cancellationStatus]} />}
      </div>

      {(b.missing.length > 0 || issues.length > 0) && (
        <div className="mb-4 space-y-2">
          {b.missing.length > 0 && (
            <div className="rounded-md border border-warn/30 bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
              Missing: {b.missing.map((m) => FIELD_LABELS[m] ?? m).join(', ')}. This will be flagged in daily reports until completed.
            </div>
          )}
          {issues.length > 0 && (
            <div className="rounded-md border border-bad/20 bg-bad-soft px-4 py-2.5 text-[13px] text-bad">
              {issues.length} open reconciliation issue{issues.length > 1 ? 's' : ''}: {[...new Set(issues.map((i) => LABELS[i.type]))].join(', ')}.{' '}
              <Link href="/reconciliation" className="underline">Review</Link>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card title="Stay">
            <Dl
              items={[
                ['Hotel', b.hotel ? `${b.hotel.name}, ${b.hotel.city} (${b.hotel.country})` : <span className="text-warn">Missing</span>],
                ['Dates', `${formatDate(b.checkIn)} → ${formatDate(b.checkOut)} · ${b.nights} night${b.nights === 1 ? '' : 's'}`],
                ['Rooms', `${b.rooms} × ${b.roomType ?? 'room type not set'}${b.boardBasis ? ` · ${b.boardBasis}` : ''}`],
                ['Occupancy', `${b.adults} adult${b.adults === 1 ? '' : 's'}${b.children ? `, ${b.children} child${b.children === 1 ? '' : 'ren'}` : ''}`],
              ]}
            />
          </Card>
          <Card title="Guest">
            <Dl items={[['Lead guest', b.leadGuestName], ['Email', b.guestEmail], ['Phone', b.guestPhone]]} />
          </Card>
          <Card title="Rates">
            <Dl
              items={[
                ['Selling price', formatMoney(b.sellingAmount, b.currency)],
                ['Supplier cost', formatMoney(b.costAmount, b.currency)],
                ['Taxes', b.taxAmount === null ? <span className="text-ink-3">Not provided</span> : formatMoney(b.taxAmount, b.currency)],
                ['Margin', b.margin === null ? <span className="text-ink-3">Needs price and cost</span> : <span className={Number(b.margin) < 0 ? 'text-bad' : ''}>{formatMoney(b.margin, b.currency)}</span>],
              ]}
            />
          </Card>
          <Card title="History">
            {b.changes.length === 0 ? (
              <EmptyState title="No changes recorded" />
            ) : (
              <ol className="divide-y divide-line">
                {b.changes.map((c) => (
                  <li key={c.id} className="flex gap-4 px-4 py-2.5">
                    <div className="w-36 shrink-0 text-[12px] text-ink-3">{formatDateTime(c.createdAt)}</div>
                    <div className="min-w-0 text-[13px]">
                      <div>
                        <span className="font-medium">{c.changedBy?.name ?? (c.origin === 'WEBHOOK' ? 'Booking website' : 'System')}</span>{' '}
                        <span className="text-ink-3">· {c.changeType.toLowerCase().replace(/_/g, ' ')} · {c.origin.toLowerCase()}</span>
                      </div>
                      <ul className="mt-0.5 text-[12.5px] text-ink-2">
                        {describeDiff(c.diff).map((line) => <li key={line} className="break-words">{line}</li>)}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Operations">
            <Dl
              items={[
                ['Supplier', b.supplier ? `${b.supplier.name} (${b.supplier.code})` : <span className="text-warn">Missing</span>],
                ['Confirmation no.', b.confirmationNumber],
                ['Owner', b.assignedTo?.name ?? <span className="text-warn">Unassigned</span>],
                ['Created by', b.createdBy?.name ?? (b.channel === 'ONLINE' ? 'Booking website' : 'Import')],
              ]}
            />
            {b.notes && <p className="whitespace-pre-wrap border-t border-line px-4 py-3 text-[13px] text-ink-2">{b.notes}</p>}
          </Card>
          <Card title="Documents" aside={<Badge>{b.documents.length}</Badge>}>
            {b.documents.length > 0 && (
              <ul className="divide-y divide-line">
                {b.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                    <a href={`/api/bookings/${b.id}/documents/${d.id}`} className="min-w-0 truncate text-brand hover:underline">{d.fileName}</a>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{(d.sizeBytes / 1024).toFixed(0)} KB · {formatDate(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && <DocumentUpload bookingId={b.id} />}
          </Card>
          {canWrite && (
            <Link href={`/bookings/${b.id}/edit`} className={`${buttonClass.secondary} w-full`}>Edit booking details</Link>
          )}
        </div>
      </div>
    </>
  );
}
