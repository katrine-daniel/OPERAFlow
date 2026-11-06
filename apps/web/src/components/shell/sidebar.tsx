'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Permission } from '@operaflow/shared';
import { cx } from '../ui';
import { NAV_SECTIONS } from './nav';

export function Sidebar({ permissions }: { permissions: Permission[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <div className="hidden lg:flex">
        <SidebarPanel permissions={permissions} />
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-30 grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-ink-2 lg:hidden"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <SidebarPanel permissions={permissions} />
          <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="flex-1 bg-black/40" />
        </div>
      )}
    </>
  );
}

function SidebarPanel({ permissions }: { permissions: Permission[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-nav text-nav-ink">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/5 px-4">
        <span className="grid h-7 w-7 place-items-center rounded bg-brand text-[12px] font-bold text-white">OF</span>
        <span className="text-[15px] font-semibold text-white">
          OPERA<span className="text-[#5fb7c9]">Flow</span>
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((i) => permissions.includes(i.permission));
          if (items.length === 0) return null;
          return (
            <div key={section.title} className="mb-4">
              <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-nav-ink/50">{section.title}</div>
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    'flex items-center justify-between rounded-md px-2 py-1.5 text-[13px]',
                    isActive(item.href) ? 'bg-nav-2 font-medium text-white' : 'hover:bg-nav-2/60 hover:text-white',
                  )}
                >
                  <span>{item.label}</span>
                  {item.phase && <span className="rounded bg-white/5 px-1 text-[10px] text-nav-ink/60">P{item.phase}</span>}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
