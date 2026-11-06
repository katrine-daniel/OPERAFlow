import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_480px]">
      <section className="relative hidden flex-col justify-between bg-nav p-10 text-nav-ink lg:flex">
        <Wordmark />
        <div className="max-w-md">
          <p className="text-[22px] font-semibold leading-8 text-white">
            One operations desk for bookings, supplier follow-ups, daily reporting and booking-site QA.
          </p>
          <ul className="mt-6 space-y-2 text-[13px]">
            <li>Online and offline bookings in a single registry</li>
            <li>Supplier follow-ups with review before anything is sent</li>
            <li>Scheduled operations reports with delivery history</li>
            <li>Sandbox-only automated booking journey tests</li>
          </ul>
        </div>
        <p className="text-[12px] text-nav-ink/60">Internal system. Access is logged and monitored.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark dark />
          </div>
          <h1 className="text-[20px] font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-ink-3">Use the account issued by your administrator.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

function Wordmark({ dark }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-[13px] font-bold text-white">OF</span>
      <span className={dark ? 'text-[16px] font-semibold text-ink' : 'text-[16px] font-semibold text-white'}>
        OPERA<span className="text-[#5fb7c9]">Flow</span>
      </span>
    </div>
  );
}
