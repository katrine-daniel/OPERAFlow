import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import type { HotelRow, SourceRow, SupplierRow, UserOption } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { BookingForm } from '@/components/booking-form';

export const metadata: Metadata = { title: 'New offline booking' };

export default async function NewBookingPage() {
  const [sources, suppliers, hotels, users] = await Promise.all([
    apiGet<SourceRow[]>('/booking-sources'),
    apiGet<SupplierRow[]>('/suppliers'),
    apiGet<HotelRow[]>('/hotels'),
    apiGet<UserOption[]>('/users/assignable'),
  ]);
  return (
    <>
      <PageHeader
        title="New offline booking"
        description="For bookings made through TBO, direct hotel calls, supplier email or another authorised channel. Leave unknown amounts blank: they will be flagged, not treated as zero."
      />
      <BookingForm sources={sources} suppliers={suppliers} hotels={hotels} users={users} />
    </>
  );
}
