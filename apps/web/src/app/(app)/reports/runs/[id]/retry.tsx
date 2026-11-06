'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';

export function RetryDeliveries({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[12px] text-ink-3">{msg}</span>}
      <button
        disabled={busy}
        className="h-7 rounded border border-line-strong px-2 text-[12px] hover:bg-sunken"
        onClick={async () => {
          setBusy(true);
          try {
            const r = await apiSend<{ sent: number; failed: number }>('POST', `/reports/runs/${runId}/deliver`);
            setMsg(`Sent ${r.sent}, failed ${r.failed}`);
            router.refresh();
          } catch (err) {
            setMsg(err instanceof ClientApiError ? err.message : 'Retry failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        Retry failed deliveries
      </button>
    </span>
  );
}
