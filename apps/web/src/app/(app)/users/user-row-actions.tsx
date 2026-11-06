'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, ROLES, type Role } from '@operaflow/shared';
import { apiSend, ClientApiError } from '@/lib/client';

export function UserRowActions({ id, role, isActive }: { id: string; role: Role; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function update(patch: { role?: Role; isActive?: boolean }) {
    setBusy(true);
    try {
      await apiSend('PATCH', `/users/${id}`, patch);
      router.refresh();
    } catch (err) {
      alert(err instanceof ClientApiError ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <select
        aria-label="Change role"
        disabled={busy}
        value={role}
        onChange={(e) => update({ role: e.target.value as Role })}
        className="h-7 rounded border border-line-strong bg-surface px-1.5 text-[12px]"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const pw = prompt('New temporary password (12+ chars, three of: lower, upper, digit, symbol). The user is signed out everywhere and the account is unlocked.');
          if (!pw) return;
          setBusy(true);
          try {
            await apiSend('POST', `/users/${id}/reset-password`, { password: pw });
            alert('Password reset. Share it through a secure channel.');
          } catch (err) {
            alert(err instanceof ClientApiError ? (err.issues.map((i) => i.message).join(' · ') || err.message) : 'Reset failed');
          } finally {
            setBusy(false);
          }
        }}
        className="h-7 rounded border border-line-strong px-2 text-[12px] text-ink-2 hover:bg-sunken"
      >
        Reset password
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!isActive || confirm('Deactivate this user? They will be signed out immediately.')) void update({ isActive: !isActive });
        }}
        className="h-7 rounded border border-line-strong px-2 text-[12px] text-ink-2 hover:bg-sunken"
      >
        {isActive ? 'Deactivate' : 'Reactivate'}
      </button>
    </div>
  );
}
