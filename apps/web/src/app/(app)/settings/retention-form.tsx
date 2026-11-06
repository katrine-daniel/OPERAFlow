'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { Field, buttonClass, inputClass } from '@/components/ui';

const LABEL: Record<string, string> = {
  'retention.auditLogDays': 'Audit log',
  'retention.sessionDays': 'Expired / revoked sessions',
  'retention.testArtifactDays': 'Test screenshots & traces',
  'retention.reportFileDays': 'Report files (run history is kept)',
  'retention.notificationDays': 'Read notifications',
  'retention.jobExecutionDays': 'Finished background-job records',
};

export function RetentionForm({ values, minimums }: { values: Record<string, number>; minimums: Record<string, number> }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(Object.keys(values).map((k) => [k, Number(f.get(k))]).filter(([k, v]) => v !== values[k as string]));
    if (!Object.keys(body).length) return setMsg({ ok: false, text: 'Nothing changed' });
    try {
      await apiSend('PATCH', '/settings/retention', body);
      setMsg({ ok: true, text: 'Saved' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ClientApiError ? (err.issues.map((i) => `${LABEL[i.path] ?? i.path}: ${i.message}`).join(' · ') || err.message) : 'Failed' });
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(values).map(([k, v]) => (
          <Field key={k} label={`${LABEL[k] ?? k} (days)`} hint={`Minimum ${minimums[k]}`}>
            <input name={k} type="number" min={minimums[k]} max={3650} defaultValue={v} className={inputClass} />
          </Field>
        ))}
      </div>
      {msg && <p className={`rounded-md px-3 py-2 text-[12.5px] ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button className={buttonClass.primary}>Save retention periods</button>
        <button
          type="button"
          disabled={busy}
          className={buttonClass.secondary}
          onClick={async () => {
            if (!confirm('Permanently delete data older than these periods now?')) return;
            setBusy(true);
            try {
              const r = await apiSend<Record<string, number>>('POST', '/settings/retention/run');
              setMsg({ ok: true, text: `Purged: ${Object.entries(r).map(([k, n]) => `${k} ${n}`).join(', ')}` });
              router.refresh();
            } catch (err) {
              setMsg({ ok: false, text: err instanceof ClientApiError ? err.message : 'Failed' });
            } finally {
              setBusy(false);
            }
          }}
        >
          Run purge now
        </button>
      </div>
    </form>
  );
}
