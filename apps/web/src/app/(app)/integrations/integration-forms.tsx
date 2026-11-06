'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { Field, buttonClass, inputClass } from '@/components/ui';
import type { IntegrationRow } from './page';

const msgOf = (err: unknown) => (err instanceof ClientApiError ? err.message : 'Request failed');

export function AddChatWebhook() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setError(null);
    try {
      await apiSend('POST', '/integrations/chat-webhooks', { kind: f.get('kind'), name: f.get('name'), url: f.get('url') });
      formEl.reset();
      router.refresh();
    } catch (err) {
      setError(msgOf(err));
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3 p-4">
      <Field label="Type">
        <select name="kind" className={inputClass}>
          <option value="TEAMS_WEBHOOK">Microsoft Teams (Workflows webhook)</option>
          <option value="SLACK_WEBHOOK">Slack (incoming webhook)</option>
        </select>
      </Field>
      <Field label="Name"><input name="name" required placeholder="Ops group" className={inputClass} /></Field>
      <Field label="Webhook URL" hint="Stored encrypted. Only Teams/Power Automate and hooks.slack.com URLs are accepted.">
        <input name="url" required type="url" className={inputClass} autoComplete="off" />
      </Field>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</p>}
      <button className={buttonClass.primary}>Add channel</button>
    </form>
  );
}

export function IntegrationRowActions({ integration }: { integration: IntegrationRow }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const isChat = integration.kind === 'TEAMS_WEBHOOK' || integration.kind === 'SLACK_WEBHOOK';
  const isMailbox = integration.kind === 'GMAIL' || integration.kind === 'MICROSOFT_GRAPH';
  if (integration.mode === 'DISABLED') return <span className="text-[12px] text-ink-3">Disabled</span>;
  return (
    <span className="flex items-center justify-end gap-1.5">
      {msg && <span className="max-w-[200px] truncate text-[11.5px] text-ink-3" title={msg}>{msg}</span>}
      {(isChat || isMailbox) && (
        <button
          className="h-7 rounded border border-line-strong px-2 text-[12px] hover:bg-sunken"
          onClick={async () => {
            setMsg('Testing…');
            try {
              await apiSend('POST', `/integrations/${integration.id}/test`);
              setMsg('OK');
            } catch (err) {
              setMsg(msgOf(err));
            }
            router.refresh();
          }}
        >
          Test
        </button>
      )}
      <button
        className="h-7 rounded border border-line-strong px-2 text-[12px] text-ink-3 hover:bg-sunken"
        onClick={async () => {
          if (!confirm(`Disable ${integration.name}? Anything using it stops immediately.`)) return;
          try {
            await apiSend('POST', `/integrations/${integration.id}/disable`);
            router.refresh();
          } catch (err) {
            setMsg(msgOf(err));
          }
        }}
      >
        Disable
      </button>
    </span>
  );
}
