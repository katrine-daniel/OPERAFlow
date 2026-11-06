'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BOOKING_STATUSES, CANCELLATION_STATUSES, CONFIRMATION_STATUSES, LABELS, PAYMENT_STATUSES } from '@operaflow/shared';
import { apiSend, ClientApiError, type DuplicateInfo } from '@/lib/client';
import type { BookingRow, HotelRow, SourceRow, SupplierRow, UserOption } from '@/lib/types';
import { Badge, Card, Field, buttonClass, cx, inputClass } from './ui';

/** Fields owned by the online source (mirrors the API rule). */
const SOURCE_OWNED = new Set([
  'externalRef', 'leadGuestName', 'guestEmail', 'guestPhone', 'adults', 'children', 'rooms', 'roomType', 'boardBasis',
  'checkIn', 'checkOut', 'currency', 'sellingAmount', 'taxAmount', 'status', 'cancellationStatus', 'hotelId',
]);

interface Props {
  sources: SourceRow[];
  suppliers: SupplierRow[];
  hotels: HotelRow[];
  users: UserOption[];
  booking?: BookingRow;
}

type Values = Record<string, string>;

function initialValues(b?: BookingRow): Values {
  if (!b) {
    return {
      sourceId: '', externalRef: '', supplierId: '', hotelId: '', leadGuestName: '', guestEmail: '', guestPhone: '',
      adults: '2', children: '0', rooms: '1', roomType: '', boardBasis: '', checkIn: '', checkOut: '', currency: 'AED',
      sellingAmount: '', costAmount: '', taxAmount: '', status: 'PENDING', paymentStatus: 'UNPAID', confirmationStatus: 'PENDING',
      cancellationStatus: 'NONE', confirmationNumber: '', assignedToId: '', notes: '',
    };
  }
  const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  return {
    sourceId: b.sourceId, externalRef: s(b.externalRef), supplierId: s(b.supplierId), hotelId: s(b.hotelId),
    leadGuestName: b.leadGuestName, guestEmail: s(b.guestEmail), guestPhone: s(b.guestPhone), adults: s(b.adults),
    children: s(b.children), rooms: s(b.rooms), roomType: s(b.roomType), boardBasis: s(b.boardBasis), checkIn: b.checkIn,
    checkOut: b.checkOut, currency: b.currency, sellingAmount: s(b.sellingAmount), costAmount: s(b.costAmount),
    taxAmount: s(b.taxAmount), status: b.status, paymentStatus: b.paymentStatus, confirmationStatus: b.confirmationStatus,
    cancellationStatus: b.cancellationStatus, confirmationNumber: s(b.confirmationNumber), assignedToId: s(b.assignedToId), notes: s(b.notes),
  };
}

export function BookingForm({ sources, suppliers, hotels: initialHotels, users, booking }: Props) {
  const router = useRouter();
  const editing = Boolean(booking);
  const online = booking?.channel === 'ONLINE';
  const cancelled = booking?.status === 'CANCELLED';
  const [values, setValues] = useState<Values>(() => initialValues(booking));
  const [hotels, setHotels] = useState(initialHotels);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateInfo[] | null>(null);
  const [pending, setPending] = useState(false);
  const [addingHotel, setAddingHotel] = useState(false);

  const manualSources = sources.filter((s) => s.acceptsManualEntry && s.isActive);
  const set = (k: string) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const locked = (k: string) => (online && SOURCE_OWNED.has(k)) || (cancelled && !['notes', 'paymentStatus', 'cancellationStatus', 'assignedToId', 'costAmount', 'supplierId'].includes(k));

  const margin = useMemo(() => {
    const s = parseFloat(values.sellingAmount!.replace(/,/g, ''));
    const c = parseFloat(values.costAmount!.replace(/,/g, ''));
    return Number.isFinite(s) && Number.isFinite(c) ? (s - c).toFixed(2) : null;
  }, [values.sellingAmount, values.costAmount]);

  async function submit(e: FormEvent | null, confirmDuplicate = false) {
    e?.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (!booking) {
        const created = await apiSend<{ id: string }>('POST', '/bookings', { ...values, confirmDuplicate: confirmDuplicate || undefined });
        router.push(`/bookings/${created.id}`);
        router.refresh();
        return;
      }
      const initial = initialValues(booking);
      const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k] && k !== 'sourceId'));
      if (Object.keys(changed).length === 0) {
        setFormError('Nothing has changed.');
        setPending(false);
        return;
      }
      await apiSend('PATCH', `/bookings/${booking.id}`, { ...changed, version: booking.version });
      router.push(`/bookings/${booking.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ClientApiError) {
        if (err.body.code === 'DUPLICATE_SUSPECTED') setDuplicates(err.body.duplicates as DuplicateInfo[]);
        else if (err.issues.length) setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
        setFormError(err.message);
      } else setFormError('Request failed');
      setPending(false);
    }
  }

  const input = (k: string, props: Record<string, unknown> = {}) => (
    <input value={values[k]} onChange={set(k)} disabled={locked(k)} className={cx(inputClass, errors[k] && 'border-bad')} {...props} />
  );
  const select = (k: string, options: readonly string[], blank?: string) => (
    <select value={values[k]} onChange={set(k)} disabled={locked(k)} className={inputClass}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => <option key={o} value={o}>{LABELS[o] ?? o}</option>)}
    </select>
  );

  return (
    <form onSubmit={(e) => submit(e)} className="space-y-4" noValidate>
      {online && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-[12.5px] text-info">
          This is an online booking. Guest, stay, price and status come from the booking website and update automatically; you can set supplier, cost, owner, confirmation and notes.
        </p>
      )}
      {cancelled && <p className="rounded-md bg-sunken px-3 py-2 text-[12.5px] text-ink-2">Cancelled booking: only payment, cost, supplier, owner and notes can change.</p>}

      <Card title="Source and references">
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <Field label="Source / channel" error={errors.sourceId}>
            {editing ? (
              <input className={inputClass} disabled value={booking!.source.name} />
            ) : (
              <select value={values.sourceId} onChange={set('sourceId')} className={inputClass} required>
                <option value="">Choose…</option>
                {manualSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Supplier booking reference" error={errors.externalRef} hint="e.g. the TBO or hotel reference">{input('externalRef', { maxLength: 100 })}</Field>
          <Field label="Supplier" error={errors.supplierId}>
            <select value={values.supplierId} onChange={set('supplierId')} disabled={locked('supplierId')} className={inputClass}>
              <option value="">Not set</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Guest">
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <Field label="Lead guest name" error={errors.leadGuestName}>{input('leadGuestName', { required: true, maxLength: 200 })}</Field>
          <Field label="Guest email" error={errors.guestEmail}>{input('guestEmail', { type: 'email' })}</Field>
          <Field label="Guest phone" error={errors.guestPhone}>{input('guestPhone', { type: 'tel' })}</Field>
        </div>
      </Card>

      <Card title="Hotel and stay">
        <div className="grid gap-4 p-4 md:grid-cols-6">
          <Field label="Hotel" error={errors.hotelId} className="md:col-span-3">
            <div className="flex gap-2">
              <select value={values.hotelId} onChange={set('hotelId')} disabled={locked('hotelId')} className={inputClass}>
                <option value="">Not set</option>
                {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}, {h.city} ({h.country})</option>)}
              </select>
              {!locked('hotelId') && (
                <button type="button" onClick={() => setAddingHotel((a) => !a)} className={cx(buttonClass.secondary, 'shrink-0')}>
                  {addingHotel ? 'Close' : 'Add hotel'}
                </button>
              )}
            </div>
          </Field>
          <Field label="Check-in" error={errors.checkIn}>{input('checkIn', { type: 'date', required: true })}</Field>
          <Field label="Check-out" error={errors.checkOut}>{input('checkOut', { type: 'date', required: true })}</Field>
          <Field label="Rooms" error={errors.rooms}>{input('rooms', { type: 'number', min: 1 })}</Field>
          {addingHotel && (
            <div className="md:col-span-6">
              <AddHotel
                onAdded={(h) => {
                  setHotels((list) => [...list, h].sort((a, b) => a.name.localeCompare(b.name)));
                  setValues((v) => ({ ...v, hotelId: h.id }));
                  setAddingHotel(false);
                }}
              />
            </div>
          )}
          <Field label="Adults" error={errors.adults}>{input('adults', { type: 'number', min: 1 })}</Field>
          <Field label="Children" error={errors.children}>{input('children', { type: 'number', min: 0 })}</Field>
          <Field label="Room type" error={errors.roomType} className="md:col-span-2">{input('roomType')}</Field>
          <Field label="Board basis" error={errors.boardBasis} hint="RO, BB, HB, FB, AI">{input('boardBasis')}</Field>
        </div>
      </Card>

      <Card title="Rates">
        <div className="grid gap-4 p-4 md:grid-cols-5">
          <Field label="Currency" error={errors.currency}>{input('currency', { maxLength: 3, className: cx(inputClass, 'uppercase') })}</Field>
          <Field label="Selling price" error={errors.sellingAmount} hint="Leave blank if not known yet">{input('sellingAmount', { inputMode: 'decimal' })}</Field>
          <Field label="Supplier cost" error={errors.costAmount} hint="Leave blank if not known yet">{input('costAmount', { inputMode: 'decimal' })}</Field>
          <Field label="Taxes" error={errors.taxAmount}>{input('taxAmount', { inputMode: 'decimal' })}</Field>
          <Field label="Margin">
            <div className={cx('flex h-9 items-center rounded-md bg-sunken px-3 text-[13.5px]', margin !== null && Number(margin) < 0 && 'text-bad')}>
              {margin ?? <span className="text-ink-3">Needs price and cost</span>}
            </div>
          </Field>
        </div>
      </Card>

      <Card title="Status and ownership">
        <div className="grid gap-4 p-4 md:grid-cols-4">
          <Field label="Booking status" error={errors.status}>{select('status', editing ? BOOKING_STATUSES : BOOKING_STATUSES.filter((s) => s !== 'CANCELLED'))}</Field>
          <Field label="Payment" error={errors.paymentStatus}>{select('paymentStatus', PAYMENT_STATUSES)}</Field>
          <Field label="Confirmation" error={errors.confirmationStatus}>{select('confirmationStatus', CONFIRMATION_STATUSES)}</Field>
          <Field label="Confirmation number" error={errors.confirmationNumber}>{input('confirmationNumber')}</Field>
          {editing && <Field label="Cancellation" error={errors.cancellationStatus}>{select('cancellationStatus', CANCELLATION_STATUSES)}</Field>}
          <Field label="Assigned to" error={errors.assignedToId}>
            <select value={values.assignedToId} onChange={set('assignedToId')} className={inputClass}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Notes" error={errors.notes} className="md:col-span-4">
            <textarea value={values.notes} onChange={set('notes')} rows={3} maxLength={5000} className={cx(inputClass, 'h-auto py-2')} />
          </Field>
        </div>
      </Card>

      {duplicates && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft p-4">
          <div className="font-medium text-warn">Possible duplicate</div>
          <p className="mt-1 text-[13px] text-ink-2">A booking for the same guest, hotel and dates already exists:</p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {duplicates.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <Link href={`/bookings/${d.id}`} target="_blank" className="font-mono text-brand hover:underline">{d.internalRef}</Link>
                <Badge tone={d.channel === 'ONLINE' ? 'info' : 'brand'}>{d.channel}</Badge>
                <span className="text-ink-3">{d.source.name}{d.externalRef && ` · ${d.externalRef}`} · {LABELS[d.status]}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={pending} onClick={() => submit(null, true)} className={buttonClass.primary}>It's a separate booking, save it</button>
            <button type="button" onClick={() => setDuplicates(null)} className={buttonClass.secondary}>Go back</button>
          </div>
        </div>
      )}

      {formError && !duplicates && <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">{formError}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass.primary}>{pending ? 'Saving…' : editing ? 'Save changes' : 'Create booking'}</button>
        <Link href={booking ? `/bookings/${booking.id}` : '/bookings'} className={buttonClass.secondary}>Cancel</Link>
      </div>
    </form>
  );
}

function AddHotel({ onAdded }: { onAdded: (h: HotelRow) => void }) {
  const [v, setV] = useState({ name: '', city: '', country: '', starRating: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function add() {
    setPending(true);
    setError(null);
    try {
      onAdded(await apiSend<HotelRow>('POST', '/hotels', v));
    } catch (err) {
      setError(err instanceof ClientApiError ? (err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ') || err.message) : 'Failed');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="rounded-md border border-line bg-sunken/60 p-3">
      <div className="grid gap-3 md:grid-cols-[2fr_1.5fr_0.8fr_0.8fr_auto] md:items-end">
        <Field label="Hotel name"><input className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="City"><input className={inputClass} value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></Field>
        <Field label="Country" hint="ISO, e.g. AE"><input className={cx(inputClass, 'uppercase')} maxLength={2} value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })} /></Field>
        <Field label="Stars"><input className={inputClass} type="number" min={1} max={7} value={v.starRating} onChange={(e) => setV({ ...v, starRating: e.target.value })} /></Field>
        <button type="button" onClick={add} disabled={pending} className={buttonClass.primary}>Add</button>
      </div>
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
    </div>
  );
}
