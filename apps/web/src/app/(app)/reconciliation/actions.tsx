'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { buttonClass, inputClass } from '@/components/ui';

export function RunReconciliation() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-[12.5px] text-ink-3">{msg}</span>}
      <button
        disabled={pending}
        className={buttonClass.primary}
        onClick={async () => {
          setPending(true);
          try {
            const r = await apiSend<{ newIssues: number; autoResolved: number }>('POST', '/reconciliation/run');
            setMsg(`${r.newIssues} new issue(s), ${r.autoResolved} auto-resolved`);
            router.refresh();
          } catch (err) {
            setMsg(err instanceof ClientApiError ? err.message : 'Run failed');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Running…' : 'Run reconciliation'}
      </button>
    </div>
  );
}

export function IssueActions({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | 'RESOLVED' | 'DISMISSED'>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex justify-end gap-1.5">
        <button onClick={() => setOpen('RESOLVED')} className="h-7 rounded border border-line-strong px-2 text-[12px] hover:bg-sunken">Resolve</button>
        <button onClick={() => setOpen('DISMISSED')} className="h-7 rounded border border-line-strong px-2 text-[12px] text-ink-3 hover:bg-sunken">Dismiss</button>
      </div>
    );
  }
  return (
    <div className="flex min-w-[260px] flex-col gap-1.5">
      <input
        autoFocus
        className={`${inputClass} h-8`}
        placeholder={open === 'RESOLVED' ? 'What was done?' : 'Why is this not a problem?'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex justify-end gap-1.5">
        <button onClick={() => setOpen(null)} className="h-7 px-2 text-[12px] text-ink-3">Back</button>
        <button
          disabled={note.trim().length < 3}
          className={`${buttonClass.primary} h-7 px-2 text-[12px]`}
          onClick={async () => {
            try {
              await apiSend('POST', `/reconciliation/issues/${id}/resolve`, { status: open, note });
              router.refresh();
            } catch (err) {
              setError(err instanceof ClientApiError ? err.message : 'Failed');
            }
          }}
        >
          {open === 'RESOLVED' ? 'Mark resolved' : 'Dismiss'}
        </button>
      </div>
      {error && <span className="text-[12px] text-bad">{error}</span>}
    </div>
  );
}
