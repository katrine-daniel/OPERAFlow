'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { Field, buttonClass, inputClass } from '@/components/ui';

export function AddHotelForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setError(null);
    try {
      await apiSend('POST', '/hotels', Object.fromEntries(f.entries()));
      formEl.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? (err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ') || err.message) : 'Failed');
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3 p-4">
      <Field label="Name"><input name="name" required className={inputClass} /></Field>
      <div className="grid grid-cols-[1fr_90px] gap-3">
        <Field label="City"><input name="city" required className={inputClass} /></Field>
        <Field label="Country"><input name="country" required maxLength={2} placeholder="AE" className={`${inputClass} uppercase`} /></Field>
      </div>
      <Field label="Address"><input name="address" className={inputClass} /></Field>
      <Field label="Star rating"><input name="starRating" type="number" min={1} max={7} className={inputClass} /></Field>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</p>}
      <button className={buttonClass.primary}>Add hotel</button>
    </form>
  );
}
