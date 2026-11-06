import type { Metadata } from 'next';
import Link from 'next/link';
import { LABELS } from '@operaflow/shared';
import { apiGet } from '@/lib/api';
import { Card, EmptyState, PageHeader, StatusBadge, formatDate } from '@/components/ui';

export const metadata: Metadata = { title: 'Search' };

interface Results {
  bookings: { id: string; internalRef: string; externalRef: string | null; leadGuestName: string | null; status: string; checkIn: string; hotel: { name: string } | null }[];
  suppliers: { id: string; name: string; code: string }[];
  conversations: { id: string; subject: string; status: string }[];
  scenarios: { id: string; name: string }[];
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  if (q.trim().length < 2) return <PageHeader title="Search" description="Type at least two characters in the search box." />;
  const r = await apiGet<Results>(`/search?q=${encodeURIComponent(q.trim())}`);
  const total = r.bookings.length + r.suppliers.length + r.conversations.length + r.scenarios.length;
  return (
    <>
      <PageHeader title={`Results for “${q}”`} description={`${total} match${total === 1 ? '' : 'es'} across the areas you have access to.`} />
      {total === 0 && <Card><EmptyState title="Nothing found" /></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        {r.bookings.length > 0 && (
          <Card title="Bookings" className="lg:col-span-2">
            <ul className="divide-y divide-line">
              {r.bookings.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0">
                    <Link href={`/bookings/${b.id}`} className="font-mono font-medium text-brand hover:underline">{b.internalRef}</Link>
                    {b.externalRef && <span className="ml-2 font-mono text-[12px] text-ink-3">{b.externalRef}</span>}
                    <span className="ml-2">{b.leadGuestName ?? ''}</span>
                    <span className="ml-2 text-ink-3">{b.hotel?.name ?? ''} · {formatDate(b.checkIn)}</span>
                  </span>
                  <StatusBadge value={b.status} label={LABELS[b.status]} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {r.suppliers.length > 0 && (
          <Card title="Suppliers">
            <ul className="divide-y divide-line">{r.suppliers.map((s) => <li key={s.id} className="px-4 py-2.5 text-[13px]"><Link href="/suppliers" className="text-brand hover:underline">{s.name}</Link> <span className="text-ink-3">{s.code}</span></li>)}</ul>
          </Card>
        )}
        {r.conversations.length > 0 && (
          <Card title="Supplier follow-ups">
            <ul className="divide-y divide-line">{r.conversations.map((c) => <li key={c.id} className="px-4 py-2.5 text-[13px]"><Link href={`/follow-ups/${c.id}`} className="text-brand hover:underline">{c.subject}</Link> <span className="text-ink-3">{c.status.toLowerCase().replace(/_/g, ' ')}</span></li>)}</ul>
          </Card>
        )}
        {r.scenarios.length > 0 && (
          <Card title="Test scenarios">
            <ul className="divide-y divide-line">{r.scenarios.map((s) => <li key={s.id} className="px-4 py-2.5 text-[13px]"><Link href={`/testing/scenarios/${s.id}`} className="text-brand hover:underline">{s.name}</Link></li>)}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
