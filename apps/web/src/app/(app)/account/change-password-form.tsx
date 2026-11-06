'use client';

import { useState, type FormEvent } from 'react';
import { apiSend, ClientApiError } from '@/lib/client';
import { Field, buttonClass, inputClass } from '@/components/ui';

export function ChangePasswordForm() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    if (f.get('newPassword') !== f.get('confirm')) {
      setMsg({ ok: false, text: 'The new passwords do not match' });
      return;
    }
    try {
      await apiSend('POST', '/auth/change-password', { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') });
      formEl.reset();
      setMsg({ ok: true, text: 'Password changed. Your other sessions were signed out.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ClientApiError ? (err.issues.map((i) => i.message).join(' · ') || err.message) : 'Failed' });
    }
  }
  return (
    <form onSubmit={onSubmit} method="post" className="space-y-3 p-4">
      <Field label="Current password"><input name="currentPassword" type="password" autoComplete="current-password" required className={inputClass} /></Field>
      <Field label="New password" hint="12+ characters with three of: lowercase, uppercase, digits, symbols"><input name="newPassword" type="password" autoComplete="new-password" required className={inputClass} /></Field>
      <Field label="Repeat new password"><input name="confirm" type="password" autoComplete="new-password" required className={inputClass} /></Field>
      {msg && <p className={`rounded-md px-3 py-2 text-[12.5px] ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{msg.text}</p>}
      <button className={buttonClass.primary}>Change password</button>
    </form>
  );
}
