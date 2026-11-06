import type { Metadata } from 'next';
import Link from 'next/link';
import { BOOKING_STATUSES, CONFIRMATION_STATUSES, LABELS } from '@operaflow/shared';
import { apiGet, getMe } from '@/lib/api';
import type { BookingRow, SourceRow, SupplierRow } from '@/lib/types';
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, buttonClass, formatDate, formatMoney } from '@/components/ui';

export const metadata: Metadata = { title: 'Booking registry' };

interface Page {
  total: number;
  page: number;
  pageSize: number;
  items: BookingRow[];
}

const FILTER_KEYS = ['q', 'channel', 'sourceId', 'supplierId', 'status', 'confirmationStatus', 'dateField', 'from', 'to', 'missingData'] as const;
const selectClass = 'h-8 rounded-md border border-line-strong bg-surface px-2 text-[12.5px]';

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of FILTER_KEYS) if (sp[k]) qs.set(k, sp[k]!);
  qs.set('page', String(Math.max(1, Number(sp.page ?? 1) || 1)));
  qs.set('pageSize', '50');

  const [me, data, sources, suppliers] = await Promise.all([
    getMe(),
    apiGet<Page>(`/bookings?${qs}`),
    apiGet<SourceRow[]>('/booking-sources'),
    apiGet<SupplierRow[]>('/suppliers'),
  ]);
  const can = (p: string) => me.permissions.includes(p as never);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageLink = (p: number) => {
    const n = new URLSearchParams(qs);
    n.set('page', String(p));
    n.delete('pageSize');
    return `/bookings?${n}`;
  };
  const active = FILTER_KEYS.some((k) => sp[k]);

  return (
    <>
      <PageHeader
        title="Booking registry"
        description="Online and offline bookings in one place. Amounts that were never provided are shown as missing, not zero."
        actions={
          <>
            {can('bookings:import') && <Link href="/imports" className={buttonClass.secondary}>Import file</Link>}
            {can('bookings:write') && <Link href="/bookings/new" className={buttonClass.primary}>New offline booking</Link>}
          </>
        }
      />

      <Card>
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" method="get">
          <input name="q" defaultValue={sp.q} placeholder="Ref, guest, hotel, confirmation no." className={`${selectClass} w-64`} />
          <select name="channel" defaultValue={sp.channel ?? ''} className={selectClass} aria-label="Channel">
            <option value="">All channels</option>
            <option value="ONLINE">Online</option>
            <option value="OFFLINE">Offline</option>
          </select>
          <select name="sourceId" defaultValue={sp.sourceId ?? ''} className={selectClass} aria-label="Source">
            <option value="">All sources</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="supplierId" defaultValue={sp.supplierId ?? ''} className={selectClass} aria-label="Supplier">
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="status" defaultValue={sp.status ?? ''} className={selectClass} aria-label="Status">
            <option value="">Any status</option>
            {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
          </select>
          <select name="confirmationStatus" defaultValue={sp.confirmationStatus ?? ''} className={selectClass} aria-label="Confirmation">
            <option value="">Any confirmation</option>
            {CONFIRMATION_STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
          </select>
          <select name="dateField" defaultValue={sp.dateField ?? 'bookingDate'} className={selectClass} aria-label="Date field">
            <option value="bookingDate">Booked</option>
            <option value="checkIn">Check-in</option>
          </select>
          <input type="date" name="from" defaultValue={sp.from} className={selectClass} aria-label="From" />
          <input type="date" name="to" defaultValue={sp.to} className={selectClass} aria-label="To" />
          <label className="flex h-8 items-center gap-1.5 text-[12.5px] text-ink-2">
            <input type="checkbox" name="missingData" value="true" defaultChecked={sp.missingData === 'true'} /> Missing data
          </label>
          <button className={`${buttonClass.secondary} h-8`}>Apply</button>
          {active && <Link href="/bookings" className="h-8 px-2 text-[12.5px] leading-8 text-brand hover:underline">Clear</Link>}
        </form>

        {data.items.length === 0 ? (
          <EmptyState title={active ? 'No bookings match these filters' : 'No bookings yet'}>
            {!active && 'Enter an offline booking, import a file, or connect the booking website webhook under Booking sources.'}
          </EmptyState>
        ) : (
          <Table head={['Reference', 'Guest', 'Hotel', 'Stay', 'Source', 'Supplier', 'Selling', 'Margin', 'Status', 'Owner']}>
            {data.items.map((b) => (
              <tr key={b.id} className="hover:bg-sunken/50">
                <Td>
                  <Link href={`/bookings/${b.id}`} className="font-mono text-[12.5px] font-medium text-brand hover:underline">{b.internalRef}</Link>
                  {b.externalRef && <div className="font-mono text-[11px] text-ink-3">{b.externalRef}</div>}
                </Td>
                <Td className="max-w-[180px] truncate">{b.leadGuestName}</Td>
                <Td className="max-w-[200px]">
                  {b.hotel ? (
                    <>
                      <div className="truncate">{b.hotel.name}</div>
                      <div className="text-[11.5px] text-ink-3">{b.hotel.city}, {b.hotel.country}</div>
                    </>
                  ) : (
                    <span className="text-warn">Missing</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap">
                  {formatDate(b.checkIn)}
                  <div className="text-[11.5px] text-ink-3">{b.nights} night{b.nights === 1 ? '' : 's'}</div>
                </Td>
                <Td className="whitespace-nowrap">
                  <StatusBadge value={b.channel} />
                  <div className="mt-0.5 text-[11.5px] text-ink-3">{b.source.name}</div>
                </Td>
                <Td className="max-w-[150px] truncate">{b.supplier?.name ?? <span className="text-warn">Missing</span>}</Td>
                <Td className="whitespace-nowrap text-right">{formatMoney(b.sellingAmount, b.currency)}</Td>
                <Td className="whitespace-nowrap text-right">{b.margin === null ? <span className="text-ink-3">—</span> : formatMoney(b.margin)}</Td>
                <Td className="whitespace-nowrap">
                  <StatusBadge value={b.status} label={LABELS[b.status]} />
                  {b.confirmationStatus !== 'CONFIRMED' && b.status !== 'CANCELLED' && (
                    <div className="mt-0.5 text-[11px] text-warn">Unconfirmed</div>
                  )}
                </Td>
                <Td className="whitespace-nowrap">
                  {b.assignedTo?.name ?? <span className="text-warn">Unassigned</span>}
                  {b.missing.length > 0 && <div className="mt-0.5"><Badge tone="warn">{b.missing.length} missing</Badge></div>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">
          <span>{data.total.toLocaleString()} booking{data.total === 1 ? '' : 's'} · page {data.page} of {pages}</span>
          <span className="flex gap-2">
            {data.page > 1 && <Link className={buttonClass.secondary} href={pageLink(data.page - 1)}>Previous</Link>}
            {data.page < pages && <Link className={buttonClass.secondary} href={pageLink(data.page + 1)}>Next</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}
