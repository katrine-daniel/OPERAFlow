'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { buttonClass } from '@/components/ui';

interface Issued {
  secret: string;
  endpointPath: string;
  signature: { headers: string[]; algorithm: string };
}

export function WebhookSecret({ sourceId, path, hasSecret }: { sourceId: string; path: string; hasSecret: boolean }) {
  const router = useRouter();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  async function issue() {
    if (hasSecret && !confirm('Rotate the signing secret? The booking website will be rejected until it uses the new secret.')) return;
    try {
      setIssued(await apiSend<Issued>('POST', `/booking-sources/${sourceId}/webhook-secret`));
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed');
    }
  }

  return (
    <div className="border-t border-line px-4 py-3 text-[12.5px]">
      <div className="mb-2 text-ink-3">
        Endpoint: <code className="break-all font-mono text-ink-2">{origin}{path}</code>
      </div>
      {issued ? (
        <div className="space-y-1.5 rounded-md bg-warn-soft p-3">
          <div className="font-medium text-warn">Copy this secret into the booking website now. It will not be shown again.</div>
          <code className="block select-all break-all rounded bg-surface px-2 py-1.5 font-mono text-[12px]">{issued.secret}</code>
          <div className="text-ink-2">{issued.signature.algorithm}</div>
          <ul className="font-mono text-[11.5px] text-ink-2">{issued.signature.headers.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
      ) : (
        <button onClick={issue} className={buttonClass.secondary}>{hasSecret ? 'Rotate signing secret' : 'Issue signing secret'}</button>
      )}
      {error && <p className="mt-1 text-bad">{error}</p>}
    </div>
  );
}
