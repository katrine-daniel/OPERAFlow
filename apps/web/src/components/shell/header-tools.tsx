'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetchJson, apiSend } from '@/lib/client';
import { formatDateTime } from '../ui';

export function GlobalSearch() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = ref.current?.value.trim();
    if (q && q.length >= 2) router.push(`/search?q=${encodeURIComponent(q)}`);
  }
  return (
    <form onSubmit={onSubmit} role="search" className="hidden min-w-0 flex-1 md:block md:max-w-md">
      <input
        ref={ref}
        type="search"
        placeholder="Search bookings, suppliers, follow-ups…  ( / )"
        aria-label="Global search"
        className="h-8 w-full rounded-md border border-line bg-sunken px-3 text-[13px] placeholder:text-ink-3 focus:border-brand focus:bg-surface focus:outline-none"
      />
    </form>
  );
}

interface Notification {
  id: string;
  title: string;
  severity: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<{ unread: number; items: Notification[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => apiFetchJson<{ unread: number; items: Notification[] }>('/notifications').then((d) => alive && setData(d)).catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function openItem(n: Notification) {
    if (!n.readAt) await apiSend('POST', `/notifications/${n.id}/read`).catch(() => undefined);
    setData((d) => ({ unread: Math.max(0, d.unread - (n.readAt ? 0 : 1)), items: d.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) }));
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Notifications (${data.unread} unread)`} className="relative grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-sunken">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a4 4 0 0 0-4 4v2.7L2.7 10.5h10.6L12 8.2V5.5a4 4 0 0 0-4-4ZM6.3 12.5a1.8 1.8 0 0 0 3.4 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        {data.unread > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-bad px-1 text-[10px] font-semibold leading-4 text-white">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12.5px]">
            <span className="font-medium">Notifications</span>
            {data.unread > 0 && (
              <button
                className="text-brand hover:underline"
                onClick={async () => {
                  await apiSend('POST', '/notifications/read-all').catch(() => undefined);
                  setData((d) => ({ unread: 0, items: d.items.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) }));
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {data.items.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-ink-3">Nothing yet</li>}
            {data.items.map((n) => (
              <li key={n.id}>
                <button onClick={() => openItem(n)} className={`block w-full border-b border-line px-3 py-2 text-left text-[12.5px] hover:bg-sunken ${n.readAt ? 'text-ink-3' : ''}`}>
                  <span className="flex items-start gap-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : n.severity === 'error' ? 'bg-bad' : n.severity === 'warning' ? 'bg-warn' : 'bg-brand'}`} />
                    <span className="min-w-0">
                      <span className="block">{n.title}</span>
                      <span className="block text-[11px] text-ink-3">{formatDateTime(n.createdAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-3 py-2 text-right text-[12px]"><Link href="/account" onClick={() => setOpen(false)} className="text-brand hover:underline">My account</Link></div>
        </div>
      )}
    </div>
  );
}
