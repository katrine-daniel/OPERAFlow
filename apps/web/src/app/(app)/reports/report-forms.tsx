'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { Badge, Field, buttonClass, inputClass } from '@/components/ui';
import type { Schedule } from './page';

const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];

function errText(err: unknown) {
  if (!(err instanceof ClientApiError)) return 'Request failed';
  return err.issues.length ? err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ') : err.message;
}

export function ScheduleForm({ schedule, recipients, channels }: { schedule?: Schedule; recipients: string[]; channels: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const days = schedule?.simple?.daysOfWeek ?? [1, 2, 3, 4, 5, 6, 7];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get('name'),
      timeOfDay: f.get('timeOfDay'),
      daysOfWeek: f.getAll('days').map(Number),
      timezone: f.get('timezone'),
      formats: f.getAll('formats'),
      recipients: f.getAll('recipients'),
      channelIntegrationId: f.get('channelIntegrationId') || null,
      filters: {
        period: f.get('period'),
        dateField: f.get('dateField'),
        ...(f.get('channel') && { channel: f.get('channel') }),
        includeCancelled: f.get('includeCancelled') === 'on',
      },
    };
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiSend<{ isEnabled: boolean }>(schedule ? 'PATCH' : 'POST', schedule ? `/reports/schedules/${schedule.id}` : '/reports/schedules', body);
      setDone(schedule && schedule.isEnabled && !res.isEnabled ? 'Saved. Report content changed, so the schedule was disabled until you preview it again.' : 'Saved. Generate a preview, then enable it.');
      router.refresh();
    } catch (err) {
      setError(errText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 p-4">
      <Field label="Name"><input name="name" required defaultValue={schedule?.name ?? 'Daily operations report'} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Time"><input name="timeOfDay" type="time" required defaultValue={schedule?.simple?.timeOfDay ?? '08:00'} className={inputClass} /></Field>
        <Field label="Timezone"><input name="timezone" required defaultValue={schedule?.timezone ?? (process.env.NEXT_PUBLIC_ORG_TIMEZONE || 'UTC')} className={inputClass} /></Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(([d, l]) => (
            <label key={d} className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" name="days" value={d} defaultChecked={days.includes(d)} /> {l}</label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Covers">
          <select name="period" defaultValue={schedule?.filters.period ?? 'PREVIOUS_DAY'} className={inputClass}>
            <option value="PREVIOUS_DAY">Previous day</option>
            <option value="CURRENT_DAY">Same day</option>
          </select>
        </Field>
        <Field label="Based on">
          <select name="dateField" defaultValue={schedule?.filters.dateField ?? 'bookingDate'} className={inputClass}>
            <option value="bookingDate">Bookings made</option>
            <option value="checkIn">Arrivals (check-in)</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel">
          <select name="channel" defaultValue={schedule?.filters.channel ?? ''} className={inputClass}>
            <option value="">Online and offline</option>
            <option value="ONLINE">Online only</option>
            <option value="OFFLINE">Offline only</option>
          </select>
        </Field>
        <fieldset>
          <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Formats</legend>
          <div className="flex gap-3 pt-1.5">
            {['XLSX', 'PDF'].map((f) => (
              <label key={f} className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" name="formats" value={f} defaultChecked={schedule ? schedule.formats.includes(f) : true} /> {f}</label>
            ))}
          </div>
        </fieldset>
      </div>
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" name="includeCancelled" defaultChecked={schedule?.filters.includeCancelled ?? true} /> Include cancelled bookings</label>
      <fieldset>
        <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Email recipients (approved list only)</legend>
        {recipients.length === 0 ? (
          <p className="text-[12.5px] text-warn">No approved recipients yet. An administrator must approve addresses first.</p>
        ) : (
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {recipients.map((r) => (
              <label key={r} className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" name="recipients" value={r} defaultChecked={schedule?.recipients.includes(r)} /> {r}</label>
            ))}
          </div>
        )}
      </fieldset>
      <Field label="Also post a summary to (no guest data is posted)">
        <select name="channelIntegrationId" defaultValue={schedule?.channelIntegration?.id ?? ''} className={inputClass}>
          <option value="">No chat channel</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</p>}
      {done && <p className="rounded-md bg-ok-soft px-3 py-2 text-[12.5px] text-ok">{done}</p>}
      <button disabled={pending} className={buttonClass.primary}>{schedule ? 'Save schedule' : 'Create schedule'}</button>
    </form>
  );
}

export function ScheduleActions({ schedule }: { schedule: Schedule }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string; link?: string } | null>(null);
  const [date, setDate] = useState('');

  async function act(kind: 'preview' | 'enable' | 'disable' | 'run') {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === 'preview') {
        const run = await apiSend<{ id: string; rowCount: number }>('POST', `/reports/schedules/${schedule.id}/preview`, date ? { date } : {});
        setMsg({ tone: 'ok', text: `Preview ready (${run.rowCount} bookings). Nothing was sent.`, link: `/reports/runs/${run.id}` });
      } else if (kind === 'run') {
        if (!confirm(`Generate${date ? ` for ${date}` : ''} and send to ${schedule.recipients.length} recipient(s)${schedule.channelIntegration ? ' and the chat channel' : ''}?`)) return;
        const res = await apiSend<{ run: { id: string }; delivery: { sent: number; failed: number } }>('POST', `/reports/schedules/${schedule.id}/run`, { deliver: true, ...(date && { date }) });
        setMsg({ tone: res.delivery.failed ? 'bad' : 'ok', text: `Sent ${res.delivery.sent}, failed ${res.delivery.failed}.`, link: `/reports/runs/${res.run.id}` });
      } else {
        await apiSend('POST', `/reports/schedules/${schedule.id}/${kind}`);
      }
      router.refresh();
    } catch (err) {
      setMsg({ tone: 'bad', text: errText(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <Field label="Report day (optional)" hint="Leave empty to use the schedule's period">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button disabled={!!busy} onClick={() => act('preview')} className={buttonClass.secondary}>{busy === 'preview' ? 'Generating…' : 'Preview'}</button>
        {schedule.isEnabled ? (
          <button disabled={!!busy} onClick={() => act('disable')} className={buttonClass.secondary}>Disable</button>
        ) : (
          <button disabled={!!busy || !schedule.lastPreviewedAt} title={schedule.lastPreviewedAt ? '' : 'Preview first'} onClick={() => act('enable')} className={buttonClass.primary}>Enable</button>
        )}
        <button disabled={!!busy || !schedule.lastPreviewedAt} onClick={() => act('run')} className={buttonClass.secondary}>Run & send now</button>
      </div>
      {msg && (
        <p className={`rounded-md px-3 py-2 text-[12.5px] ${msg.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
          {msg.text} {msg.link && <Link href={msg.link} className="underline">Open</Link>}
        </p>
      )}
    </div>
  );
}

export function AdhocReport() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ id: string; rowCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      setRes(await apiSend('POST', '/reports/adhoc', {
        date: f.get('date'),
        timezone: process.env.NEXT_PUBLIC_ORG_TIMEZONE || 'UTC',
        formats: f.getAll('formats'),
        filters: { dateField: f.get('dateField') },
      }));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day"><input name="date" type="date" required className={inputClass} /></Field>
        <Field label="Based on">
          <select name="dateField" className={inputClass}>
            <option value="bookingDate">Bookings made</option>
            <option value="checkIn">Arrivals</option>
          </select>
        </Field>
      </div>
      <div className="flex gap-3 text-[12.5px]">
        {['XLSX', 'PDF'].map((f) => <label key={f} className="flex items-center gap-1"><input type="checkbox" name="formats" value={f} defaultChecked /> {f}</label>)}
      </div>
      <button disabled={busy} className={buttonClass.secondary}>{busy ? 'Generating…' : 'Generate'}</button>
      {res && (
        <p className="text-[12.5px]">
          {res.rowCount} bookings · <a className="text-brand underline" href={`/api/reports/runs/${res.id}/files/xlsx`}>Excel</a> ·{' '}
          <a className="text-brand underline" href={`/api/reports/runs/${res.id}/files/pdf`}>PDF</a> · <Link className="text-brand underline" href={`/reports/runs/${res.id}`}>details</Link>
        </p>
      )}
      {error && <p className="text-[12.5px] text-bad">{error}</p>}
    </form>
  );
}

export function RecipientManager({ recipients, canApprove }: { recipients: { id: string; email: string; label: string | null; approvedBy: { name: string } | null }[]; canApprove: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setError(null);
    try {
      await apiSend('POST', '/reports/recipients', { email: f.get('email'), label: f.get('label') });
      formEl.reset();
      router.refresh();
    } catch (err) {
      setError(errText(err));
    }
  }
  return (
    <div className="p-4">
      <p className="mb-2 text-[12px] text-ink-3">Reports contain guest data. Only these addresses can receive them.</p>
      {recipients.length === 0 ? (
        <p className="text-[13px] text-ink-3">None yet.</p>
      ) : (
        <ul className="space-y-1">
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="min-w-0 truncate">{r.email}{r.label && <span className="text-ink-3"> · {r.label}</span>}</span>
              {canApprove && (
                <button
                  className="text-[12px] text-ink-3 hover:text-bad"
                  onClick={async () => {
                    try {
                      await apiSend('DELETE', `/reports/recipients/${r.id}`);
                      router.refresh();
                    } catch (err) {
                      setError(errText(err));
                    }
                  }}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canApprove ? (
        <form onSubmit={add} className="mt-3 space-y-2">
          <input name="email" type="email" required placeholder="name@company.com" className={inputClass} />
          <input name="label" placeholder="Label (optional)" className={inputClass} />
          <button className={buttonClass.secondary}>Approve address</button>
        </form>
      ) : (
        <p className="mt-2"><Badge>Approval requires an administrator</Badge></p>
      )}
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
    </div>
  );
}
