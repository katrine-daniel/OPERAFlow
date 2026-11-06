import type { ReactNode } from 'react';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-lg border border-line bg-surface', className)}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-ink-2">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand';
const toneClass: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2 ring-line',
  ok: 'bg-ok-soft text-ok ring-ok/20',
  warn: 'bg-warn-soft text-warn ring-warn/20',
  bad: 'bg-bad-soft text-bad ring-bad/20',
  info: 'bg-info-soft text-info ring-info/20',
  brand: 'bg-brand-soft text-brand ring-brand/20',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset', toneClass[tone])}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className={cx('num mt-1 text-[24px] font-semibold leading-8', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink')}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="font-medium text-ink-2">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-[13px] text-ink-3">{children}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-sunken/60">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx('px-4 py-2.5 align-middle', className)}>{children}</td>;
}

export const buttonClass = {
  primary:
    'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-strong disabled:opacity-60',
  secondary:
    'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink-2 hover:bg-sunken disabled:opacity-60',
};

export const inputClass =
  'h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-3/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15';

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11.5px] text-bad">{error}</span> : hint && <span className="mt-1 block text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  CONFIRMED: 'ok', PAID: 'ok', CONNECTED: 'ok', COMMITTED: 'ok', RESOLVED: 'ok', SUCCEEDED: 'ok',
  PENDING: 'warn', ON_REQUEST: 'warn', UNPAID: 'warn', PARTIALLY_PAID: 'warn', REQUESTED: 'warn', READY: 'info', OPEN: 'warn', NOT_CONFIGURED: 'warn',
  CANCELLED: 'neutral', CANCELLED_WITH_FEE: 'neutral', REFUNDED: 'neutral', NOT_APPLICABLE: 'neutral', NONE: 'neutral', DISMISSED: 'neutral',
  FAILED: 'bad', REJECTED: 'bad', ERROR: 'bad',
  ONLINE: 'info', OFFLINE: 'brand', LIVE: 'brand', DEMO: 'neutral', DISABLED: 'neutral',
};

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return <Badge tone={STATUS_TONES[value] ?? 'neutral'}>{label ?? value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function formatMoney(amount: string | null | undefined, currency?: string): ReactNode {
  if (amount === null || amount === undefined) return <span className="text-warn">Missing</span>;
  const n = Number(amount);
  return (
    <span className="num">
      {n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {currency && <span className="ml-1 text-ink-3">{currency}</span>}
    </span>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
}

/** Organisation timezone for displayed instants (server: DEFAULT_TIMEZONE; client bundles: NEXT_PUBLIC_ORG_TIMEZONE). */
const ORG_TZ = process.env.NEXT_PUBLIC_ORG_TIMEZONE || process.env.DEFAULT_TIMEZONE || 'UTC';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: ORG_TZ }).format(new Date(iso));
}
