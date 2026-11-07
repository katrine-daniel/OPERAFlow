'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, type Role } from '@operaflow/shared';
import { apiSend } from '@/lib/client';

export function UserMenu({ name, email, role }: { name: string; email: string; role: Role }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function logout() {
    try {
      await apiSend('POST', '/auth/logout');
    } finally {
      router.replace('/login?manual=1');
      router.refresh();
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-sunken"
        aria-expanded={open}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-[13px] font-medium leading-4 text-ink">{name}</span>
          <span className="block text-[11.5px] leading-4 text-ink-3">{ROLE_LABELS[role]}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-line bg-surface py-1 shadow-lg">
          <div className="border-b border-line px-3 py-2 text-[12px] text-ink-3">{email}</div>
          <a href="/account" className="block w-full px-3 py-2 text-left text-[13px] hover:bg-sunken">My account & password</a>
          <button type="button" onClick={logout} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-sunken">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
