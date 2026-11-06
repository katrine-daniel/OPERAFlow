'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, ROLES } from '@operaflow/shared';
import { apiSend, ClientApiError } from '@/lib/client';
import { buttonClass, inputClass } from '@/components/ui';

export function CreateUserForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError(null);
    setDone(null);
    setPending(true);
    try {
      await apiSend('POST', '/users', {
        name: form.get('name'),
        email: form.get('email'),
        role: form.get('role'),
        password: form.get('password'),
      });
      formEl.reset();
      setDone('User created. Share the temporary password through a secure channel.');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ClientApiError
          ? err.issues.length
            ? err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ')
            : err.message
          : 'Request failed',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 p-4">
      <Field label="Full name">
        <input name="name" required className={inputClass} />
      </Field>
      <Field label="Work email">
        <input name="email" type="email" required className={inputClass} />
      </Field>
      <Field label="Role">
        <select name="role" defaultValue="OPS_STAFF" className={inputClass}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Temporary password" hint="12+ characters, three of: lower, upper, digit, symbol">
        <input name="password" type="password" autoComplete="new-password" required className={inputClass} />
      </Field>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</p>}
      {done && <p className="rounded-md bg-ok-soft px-3 py-2 text-[12.5px] text-ok">{done}</p>}
      <button type="submit" disabled={pending} className={buttonClass.primary}>
        {pending ? 'Creating…' : 'Create user'}
      </button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  );
}
