import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import type { BookingDetail, HotelRow, SourceRow, SupplierRow, UserOption } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { BookingForm } from '@/components/booking-form';

export const metadata: Metadata = { title: 'Edit booking' };

export default async function EditBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [booking, sources, suppliers, hotels, users] = await Promise.all([
    apiGet<BookingDetail>(`/bookings/${id}`),
    apiGet<SourceRow[]>('/booking-sources'),
    apiGet<SupplierRow[]>('/suppliers'),
    apiGet<HotelRow[]>('/hotels'),
    apiGet<UserOption[]>('/users/assignable'),
  ]);
  return (
    <>
      <PageHeader title={`Edit ${booking.internalRef}`} description="Changes are recorded in the booking history. If someone else saves first, you will be asked to reload." />
      <BookingForm sources={sources} suppliers={suppliers} hotels={hotels} users={users} booking={booking} />
    </>
  );
}
