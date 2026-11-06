'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LABELS, SUPPLIER_TYPES } from '@operaflow/shared';
import { apiSend, ClientApiError } from '@/lib/client';
import type { SupplierRow } from '@/lib/types';
import { Badge, Field, buttonClass, inputClass } from '@/components/ui';

function errText(err: unknown) {
  if (!(err instanceof ClientApiError)) return 'Request failed';
  return err.issues.length ? err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ') : err.message;
}

export function SupplierForm({ supplier }: { supplier?: SupplierRow }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const body = {
      code: f.get('code'),
      name: f.get('name'),
      type: f.get('type'),
      phone: f.get('phone'),
      timezone: f.get('timezone'),
      notes: f.get('notes'),
      ...(supplier && { isActive: f.get('isActive') === 'on' }),
    };
    setPending(true);
    setError(null);
    try {
      await apiSend(supplier ? 'PATCH' : 'POST', supplier ? `/suppliers/${supplier.id}` : '/suppliers', body);
      if (!supplier) formEl.reset();
      router.refresh();
    } catch (err) {
      setError(errText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 p-4">
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Field label="Code"><input name="code" required defaultValue={supplier?.code} className={`${inputClass} uppercase`} maxLength={32} /></Field>
        <Field label="Name"><input name="name" required defaultValue={supplier?.name} className={inputClass} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select name="type" defaultValue={supplier?.type ?? 'WHOLESALER'} className={inputClass}>
            {SUPPLIER_TYPES.map((t) => <option key={t} value={t}>{LABELS[t]}</option>)}
          </select>
        </Field>
        <Field label="Timezone" hint="IANA, e.g. Asia/Dubai"><input name="timezone" defaultValue={supplier?.timezone ?? 'UTC'} className={inputClass} /></Field>
      </div>
      <Field label="Phone"><input name="phone" defaultValue={supplier?.phone ?? ''} className={inputClass} /></Field>
      <Field label="Notes"><textarea name="notes" defaultValue={supplier?.notes ?? ''} rows={2} className={`${inputClass} h-auto py-2`} /></Field>
      {supplier && (
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={supplier.isActive} /> Active</label>
      )}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</p>}
      <button disabled={pending} className={buttonClass.primary}>{supplier ? 'Save' : 'Add supplier'}</button>
    </form>
  );
}

export function ContactEditor({ supplierId, contacts, canManage }: { supplierId: string; contacts: SupplierRow['contacts']; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setError(null);
    try {
      await apiSend('POST', `/suppliers/${supplierId}/contacts`, { email: f.get('email'), name: f.get('name'), isPrimary: f.get('isPrimary') === 'on' });
      formEl.reset();
      router.refresh();
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-ink-3">Approved contacts</div>
      {contacts.length === 0 ? (
        <p className="text-[13px] text-warn">No contacts. Follow-ups cannot be sent to this supplier.</p>
      ) : (
        <ul className="space-y-1">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="min-w-0 truncate">
                {c.email}
                {c.name && <span className="text-ink-3"> · {c.name}</span>}
                {c.isPrimary && <span className="ml-1.5"><Badge tone="ok">Primary</Badge></span>}
              </span>
              {canManage && (
                <button
                  className="text-[12px] text-ink-3 hover:text-bad"
                  onClick={async () => {
                    if (!confirm(`Remove ${c.email}?`)) return;
                    await apiSend('DELETE', `/suppliers/${supplierId}/contacts/${c.id}`).catch((err) => setError(errText(err)));
                    router.refresh();
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={add} className="mt-2 flex flex-wrap items-center gap-2">
          <input name="email" type="email" required placeholder="reservations@supplier.com" className={`${inputClass} h-8 w-56`} />
          <input name="name" placeholder="Name (optional)" className={`${inputClass} h-8 w-36`} />
          <label className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" name="isPrimary" /> Primary</label>
          <button className={`${buttonClass.secondary} h-8`}>Add</button>
        </form>
      )}
      {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
    </div>
  );
}
