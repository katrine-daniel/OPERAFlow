'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { buttonClass, inputClass } from '@/components/ui';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Local automatic sign-in (AUTO_LOGIN_EMAIL on this computer). Skipped right after "Sign out".
  const [auto, setAuto] = useState<'trying' | 'off'>(params.get('manual') === '1' ? 'off' : 'trying');

  useEffect(() => {
    if (auto !== 'trying') return;
    const next = params.get('next');
    apiSend('POST', '/auth/auto-login')
      .then(() => {
        router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
        router.refresh();
      })
      .catch(() => setAuto('off'));
  }, [auto, params, router]);

  if (auto === 'trying') return <p className="mt-6 text-[13px] text-ink-3">Signing you in…</p>;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      await apiSend('POST', '/auth/login', { email: form.get('email'), password: form.get('password') });
      const next = params.get('next');
      // Only allow same-site relative redirects.
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ClientApiError && err.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : err instanceof ClientApiError
            ? err.message
            : 'Unable to reach the server.',
      );
      setPending(false);
    }
  }

  return (
    // method="post": if JavaScript hasn't loaded yet, a native submit must never put credentials in the URL.
    <form onSubmit={onSubmit} method="post" className="mt-6 space-y-4" noValidate>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Work email</span>
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
