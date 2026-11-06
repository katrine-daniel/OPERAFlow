'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import type { BookingRow } from '@/lib/types';
import { Field, buttonClass, inputClass } from '@/components/ui';

export function BookingActions({ booking }: { booking: BookingRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'confirm' | 'cancel'>('none');
  const [confNo, setConfNo] = useState(booking.confirmationNumber ?? '');
  const [reason, setReason] = useState('');
  const [withFee, setWithFee] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const active = booking.status !== 'CANCELLED' && booking.status !== 'FAILED';
  const canConfirm = active && booking.confirmationStatus !== 'CONFIRMED';
  const canCancel = active && booking.channel === 'OFFLINE';

  async function run(path: string, body: object) {
    setPending(true);
    setError(null);
    try {
      await apiSend('POST', `/bookings/${booking.id}/${path}`, { ...body, version: booking.version });
      setMode('none');
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex gap-2">
      <Link href={`/bookings/${booking.id}/edit`} className={buttonClass.secondary}>Edit</Link>
      {canConfirm && <button type="button" onClick={() => setMode(mode === 'confirm' ? 'none' : 'confirm')} className={buttonClass.primary}>Mark confirmed</button>}
      {canCancel && <button type="button" onClick={() => setMode(mode === 'cancel' ? 'none' : 'cancel')} className={buttonClass.secondary}>Cancel booking</button>}

      {mode !== 'none' && (
        <div className="absolute right-0 top-11 z-20 w-80 rounded-lg border border-line bg-surface p-4 shadow-lg">
          {mode === 'confirm' ? (
            <div className="space-y-3">
              <Field label="Hotel / supplier confirmation number">
                <input className={inputClass} value={confNo} onChange={(e) => setConfNo(e.target.value)} autoFocus />
              </Field>
              <button disabled={pending || !confNo.trim()} onClick={() => run('confirm', { confirmationNumber: confNo })} className={`${buttonClass.primary} w-full`}>
                Confirm booking
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Reason (recorded in history)">
                <textarea className={`${inputClass} h-auto py-2`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </Field>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={withFee} onChange={(e) => setWithFee(e.target.checked)} /> Cancellation fee applies
              </label>
              <button disabled={pending || reason.trim().length < 3} onClick={() => run('cancel', { reason, withFee })} className={`${buttonClass.primary} w-full bg-bad hover:bg-bad`}>
                Cancel booking
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-[12.5px] text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}
