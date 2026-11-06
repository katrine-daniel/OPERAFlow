'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetchJson, apiSend, ClientApiError } from '@/lib/client';
import { Field, buttonClass, formatDateTime, inputClass } from '@/components/ui';
import type { Rule, Template } from './page';

const errText = (err: unknown) => (err instanceof ClientApiError ? (err.issues.length ? err.issues.map((i) => i.message).join(' · ') : err.message) : 'Request failed');

export function CheckAllNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[12.5px] text-ink-3">{msg}</span>}
      <button
        disabled={busy}
        className={buttonClass.secondary}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await apiSend<{ checked: number }>('POST', '/followups/check-all');
            setMsg(`Checked ${r.checked} thread(s)`);
            router.refresh();
          } catch (err) {
            setMsg(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Checking…' : 'Check all threads now'}
      </button>
    </span>
  );
}

interface Sent {
  threadId: string;
  messageId: string;
  subject: string;
  to: string[];
  cc: string[];
  sentAt: string;
  alreadyTracked: boolean;
  suggestedSupplierId: string | null;
}

export function TrackWizard({ mailboxes, suppliers, rules }: { mailboxes: { id: string; mailboxAddress: string }[]; suppliers: { id: string; name: string }[]; rules: Rule[] }) {
  const router = useRouter();
  const [mailbox, setMailbox] = useState(mailboxes[0]?.id ?? '');
  const [sent, setSent] = useState<Sent[] | null>(null);
  const [picked, setPicked] = useState<Sent | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!mailboxes.length) return <p className="p-4 text-[13px] text-ink-3">Connect a mailbox first.</p>;

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setSent(await apiFetchJson<Sent[]>(`/followups/mailboxes/${mailbox}/sent`));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function track(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const c = await apiSend<{ id: string }>('POST', '/followups/conversations', { integrationId: mailbox, threadId: picked.threadId, messageId: picked.messageId, supplierId, ruleId });
      router.push(`/follow-ups/${c.id}`);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={track} className="space-y-3 p-4">
      <div className="flex items-end gap-2">
        <Field label="Mailbox" className="flex-1">
          <select value={mailbox} onChange={(e) => { setMailbox(e.target.value); setSent(null); setPicked(null); }} className={inputClass}>
            {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.mailboxAddress}</option>)}
          </select>
        </Field>
        <button type="button" disabled={busy} onClick={load} className={buttonClass.secondary}>{busy && !sent ? 'Loading…' : 'Load sent emails'}</button>
      </div>
      {sent && (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-line p-1">
          {sent.length === 0 && <p className="p-2 text-[12.5px] text-ink-3">No recent sent emails.</p>}
          {sent.map((s) => (
            <button
              type="button"
              key={s.messageId}
              disabled={s.alreadyTracked}
              onClick={() => { setPicked(s); setSupplierId(s.suggestedSupplierId ?? ''); }}
              className={`block w-full rounded px-2 py-1.5 text-left text-[12.5px] ${picked?.messageId === s.messageId ? 'bg-brand-soft' : 'hover:bg-sunken'} disabled:opacity-50`}
            >
              <span className="block truncate font-medium">{s.subject || '(no subject)'}</span>
              <span className="block truncate text-ink-3">{s.to.join(', ')} · {formatDateTime(s.sentAt)}{s.alreadyTracked ? ' · already tracked' : ''}</span>
            </button>
          ))}
        </div>
      )}
      {picked && (
        <>
          <Field label="Supplier" hint="Follow-ups only go to recipients listed as this supplier's contacts">
            <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
              <option value="">Choose…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Rule">
            <select required value={ruleId} onChange={(e) => setRuleId(e.target.value)} className={inputClass}>
              {rules.map((r) => <option key={r.id} value={r.id}>{r.name}{r.sendMode === 'AUTO_SEND' ? ' (auto-send)' : ''}</option>)}
            </select>
          </Field>
          <button disabled={busy || !supplierId} className={buttonClass.primary}>Start tracking</button>
        </>
      )}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</p>}
    </form>
  );
}

export function RuleActions({ rule, canApprove, canManage }: { rule: Rule; canApprove: boolean; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const act = async (path: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    try {
      await apiSend('POST', `/followups/rules/${rule.id}/${path}`);
      router.refresh();
    } catch (err) {
      setError(errText(err));
    }
  };
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {rule.sendMode === 'DRAFT_REVIEW' && canApprove && (
        <button
          onClick={() => act('approve-autosend', `Allow "${rule.name}" to send follow-ups to suppliers WITHOUT human review? This is recorded under your name.`)}
          className="text-[12px] text-bad hover:underline"
        >
          Approve unattended sending
        </button>
      )}
      {rule.sendMode === 'AUTO_SEND' && canManage && (
        <button onClick={() => act('revoke-autosend')} className="text-[12px] text-brand hover:underline">Switch back to draft review</button>
      )}
      {error && <span className="text-[12px] text-bad">{error}</span>}
    </div>
  );
}

export function TemplateEditor({ templates, variables }: { templates: Template[]; variables: string[] }) {
  const router = useRouter();
  const [id, setId] = useState(templates[0]?.id ?? 'new');
  const current = templates.find((t) => t.id === id);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: f.get('name'), subjectTemplate: f.get('subjectTemplate'), bodyTemplate: f.get('bodyTemplate') };
    try {
      await apiSend(current ? 'PATCH' : 'POST', current ? `/followups/templates/${current.id}` : '/followups/templates', body);
      setMsg({ ok: true, text: current ? 'Saved. Any auto-send rule using it now needs re-approval.' : 'Template created' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  }

  return (
    <form key={id} onSubmit={save} className="space-y-3 p-4">
      <select value={id} onChange={(e) => { setId(e.target.value); setMsg(null); }} className={inputClass}>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        <option value="new">+ New template</option>
      </select>
      <Field label="Name"><input name="name" required defaultValue={current?.name ?? ''} className={inputClass} /></Field>
      <Field label="Subject"><input name="subjectTemplate" required defaultValue={current?.subjectTemplate ?? 'RE: {{originalSubject}}'} className={inputClass} /></Field>
      <Field label="Body" hint={`Placeholders: ${variables.map((v) => `{{${v}}}`).join(' ')}`}>
        <textarea name="bodyTemplate" required rows={7} defaultValue={current?.bodyTemplate ?? ''} className={`${inputClass} h-auto py-2 font-mono text-[12.5px]`} />
      </Field>
      {msg && <p className={`rounded-md px-3 py-2 text-[12.5px] ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{msg.text}</p>}
      <button className={buttonClass.secondary}>Save template</button>
    </form>
  );
}
