import type { Metadata } from 'next';
import { apiGet, getMe } from '@/lib/api';
import type { HotelRow } from '@/lib/types';
import { Card, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { AddHotelForm } from './add-hotel-form';

export const metadata: Metadata = { title: 'Hotels' };

export default async function HotelsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const [me, hotels] = await Promise.all([getMe(), apiGet<HotelRow[]>(`/hotels${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ''}`)]);
  return (
    <>
      <PageHeader title="Hotels" description="Hotels are matched by name, city and country. Imports and the booking website add new hotels automatically." />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card
          title={`${hotels.length} hotel${hotels.length === 1 ? '' : 's'}`}
          aside={
            <form>
              <input name="q" defaultValue={sp.q} placeholder="Search name or city" className="h-8 w-56 rounded-md border border-line-strong px-2.5 text-[12.5px]" />
            </form>
          }
        >
          {hotels.length === 0 ? (
            <EmptyState title="No hotels" />
          ) : (
            <Table head={['Hotel', 'City', 'Country', 'Stars', 'Bookings']}>
              {hotels.map((h) => (
                <tr key={h.id}>
                  <Td className="font-medium">{h.name}</Td>
                  <Td>{h.city}</Td>
                  <Td>{h.country}</Td>
                  <Td>{h.starRating ? '★'.repeat(h.starRating) : '—'}</Td>
                  <Td className="num">{h._count?.bookings ?? 0}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {me.permissions.includes('bookings:write') && (
          <Card title="Add hotel" className="self-start">
            <AddHotelForm />
          </Card>
        )}
      </div>
    </>
  );
}
