'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { Field, buttonClass, inputClass } from '@/components/ui';
import type { Env } from './page';

const errText = (err: unknown) => (err instanceof ClientApiError ? (err.issues.length ? err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ') : err.message) : 'Request failed');

export function RunButton({ scenarioId, environments, disabled }: { scenarioId: string; environments: { id: string; name: string }[]; disabled: boolean }) {
  const router = useRouter();
  const [envId, setEnvId] = useState(environments[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!environments.length) return <span className="text-[11.5px] text-ink-3">no eligible environment</span>;
  return (
    <div className="flex items-center gap-1.5">
      <select value={envId} onChange={(e) => setEnvId(e.target.value)} className="h-7 max-w-[130px] rounded border border-line-strong px-1 text-[12px]" aria-label="Environment">
        {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <button
        disabled={disabled || busy}
        title={disabled ? 'Configure steps first' : ''}
        className="h-7 rounded bg-brand px-2 text-[12px] font-medium text-white disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = await apiSend<{ runs: unknown[]; mode: string }>('POST', `/testing/scenarios/${scenarioId}/run`, { environmentId: envId });
            setMsg(`${r.runs.length} queued`);
            setTimeout(() => router.refresh(), 1500);
          } catch (err) {
            setMsg(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Run
      </button>
      {msg && <span className="text-[11px] text-ink-3">{msg}</span>}
    </div>
  );
}

export function EnvironmentForm({ environment }: { environment?: Env }) {
  const router = useRouter();
  const [kind, setKind] = useState(environment?.kind ?? 'SANDBOX');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const secretsRaw = String(f.get('secrets') ?? '').trim();
    let secrets: Record<string, string> | null | undefined;
    if (secretsRaw === '-') secrets = null;
    else if (secretsRaw) {
      secrets = {};
      for (const line of secretsRaw.split('\n')) {
        const [k, ...rest] = line.split('=');
        if (k?.trim()) secrets[k.trim()] = rest.join('=').trim();
      }
    }
    const list = (name: string) => String(f.get(name) ?? '').split(/[\s,]+/).filter(Boolean);
    const body = {
      name: f.get('name'),
      baseUrl: f.get('baseUrl'),
      kind,
      allowBookingMutations: f.get('allowBookingMutations') === 'on',
      isActive: environment ? f.get('isActive') === 'on' : true,
      config: { allowedHosts: list('allowedHosts'), allowedWritePaths: list('allowedWritePaths') },
      ...(secrets !== undefined && { secrets }),
    };
    try {
      await apiSend(environment ? 'PATCH' : 'POST', environment ? `/testing/environments/${environment.id}` : '/testing/environments', body);
      setMsg({ ok: true, text: 'Saved' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 p-4">
      <Field label="Name"><input name="name" required defaultValue={environment?.name} className={inputClass} /></Field>
      <Field label="Base URL" hint="https only. The browser cannot leave this site except for hosts listed below."><input name="baseUrl" required defaultValue={environment?.baseUrl} placeholder="https://sandbox.booking-site.com" className={inputClass} /></Field>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
          <option value="SANDBOX">Sandbox (test bookings allowed if enabled)</option>
          <option value="STAGING">Staging (read-only journeys)</option>
          <option value="PRODUCTION_READONLY">Production, read-only (form submissions blocked)</option>
        </select>
      </Field>
      {kind === 'SANDBOX' && (
        <label className="flex items-start gap-2 text-[12.5px]">
          <input type="checkbox" name="allowBookingMutations" defaultChecked={environment?.allowBookingMutations} className="mt-0.5" />
          <span>Allow scenarios to create, modify and cancel bookings. Only enable this for a sandbox that cannot reach real hotels or charge real cards.</span>
        </label>
      )}
      <Field label="Extra allowed hosts" hint="e.g. *.stripe.com for a payment provider's test mode; space or comma separated">
        <input name="allowedHosts" defaultValue={environment?.config.allowedHosts?.join(' ')} className={inputClass} />
      </Field>
      {kind === 'PRODUCTION_READONLY' && (
        <Field label="Paths allowed to receive POST" hint="Only if search itself uses POST, e.g. /api/search">
          <input name="allowedWritePaths" defaultValue={environment?.config.allowedWritePaths?.join(' ')} className={inputClass} />
        </Field>
      )}
      <Field label={environment?.hasSecrets ? 'Credentials (stored; enter new values to replace, "-" to clear)' : 'Credentials (optional)'} hint="One per line: key=value, e.g. username=qa-bot. Use in steps as {{secret.username}}. Never shown again.">
        <textarea name="secrets" rows={3} autoComplete="off" className={`${inputClass} h-auto py-2 font-mono text-[12px]`} />
      </Field>
      {environment && <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" name="isActive" defaultChecked={environment.isActive} /> Active</label>}
      {msg && <p className={`rounded-md px-3 py-2 text-[12.5px] ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{msg.text}</p>}
      <button className={buttonClass.primary}>{environment ? 'Save' : 'Add environment'}</button>
    </form>
  );
}
