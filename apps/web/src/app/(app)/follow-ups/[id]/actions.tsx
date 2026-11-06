'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { buttonClass, inputClass } from '@/components/ui';

const errText = (err: unknown) => (err instanceof ClientApiError ? err.message : 'Request failed');

export function ConversationActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const active = ['TRACKING', 'FOLLOWUP_DUE'].includes(status);
  const run = async (path: string, body: object = {}, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setMsg(null);
    try {
      const r = await apiSend<{ result?: string }>('POST', `/followups/conversations/${id}/${path}`, body);
      if (r.result) setMsg(`Result: ${r.result.toLowerCase().replace(/_/g, ' ')}`);
      router.refresh();
    } catch (err) {
      setMsg(errText(err));
    }
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {(active || status === 'AWAITING_APPROVAL') && <button onClick={() => run('check')} className={buttonClass.secondary}>Check now</button>}
        {active && <button onClick={() => run('pause', { reason: prompt('Reason for pausing?') ?? undefined })} className={buttonClass.secondary}>Pause</button>}
        {['PAUSED', 'NEEDS_REVIEW', 'EXHAUSTED'].includes(status) && <button onClick={() => run('resume')} className={buttonClass.primary}>Resume</button>}
        {!['REPLIED', 'CANCELLED'].includes(status) && <button onClick={() => run('mark-replied', {}, 'Mark as replied? No further follow-ups will be sent.')} className={buttonClass.secondary}>Mark replied</button>}
        {!['CANCELLED'].includes(status) && <button onClick={() => run('cancel', {}, 'Stop tracking this thread?')} className={buttonClass.secondary}>Stop tracking</button>}
      </div>
      {active && (
        <div className="flex gap-2">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${inputClass} h-8 w-52`} aria-label="Reschedule next follow-up" />
          <button disabled={!when} onClick={() => run('reschedule', { at: new Date(when).toISOString() })} className={`${buttonClass.secondary} h-8`}>Reschedule</button>
        </div>
      )}
      {msg && <span className="text-[12.5px] text-ink-3">{msg}</span>}
    </div>
  );
}

export function ExecutionActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-3">
      <button
        disabled={busy}
        className={buttonClass.primary}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await apiSend<{ status: string; reason?: string }>('POST', `/followups/executions/${id}/approve`);
            setMsg(r.status === 'SENT' ? 'Sent.' : `Not sent: ${r.reason}`);
            router.refresh();
          } catch (err) {
            setMsg(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Approve & send
      </button>
      <button
        disabled={busy}
        className={buttonClass.secondary}
        onClick={async () => {
          try {
            await apiSend('POST', `/followups/executions/${id}/skip`);
            router.refresh();
          } catch (err) {
            setMsg(errText(err));
          }
        }}
      >
        Skip this follow-up
      </button>
      {msg && <span className="text-[12.5px] text-ink-3">{msg}</span>}
    </div>
  );
}
