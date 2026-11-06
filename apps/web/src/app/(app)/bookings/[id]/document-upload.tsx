'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUpload, ClientApiError } from '@/lib/client';

export function DocumentUpload({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });

  async function onChange(file: File | undefined) {
    if (!file) return;
    setState({ pending: true, error: null });
    const form = new FormData();
    form.append('file', file);
    try {
      await apiUpload(`/bookings/${bookingId}/documents`, form);
      router.refresh();
      setState({ pending: false, error: null });
    } catch (err) {
      setState({ pending: false, error: err instanceof ClientApiError ? err.message : 'Upload failed' });
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="border-t border-line px-4 py-3">
      <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-line-strong px-3 py-3 text-[12.5px] text-ink-3 hover:bg-sunken">
        {state.pending ? 'Uploading…' : 'Attach voucher, confirmation or email (PDF, image, XLSX, DOCX, EML · max 10 MB)'}
        <input
          ref={input}
          type="file"
          className="sr-only"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv,.txt,.eml"
          disabled={state.pending}
          onChange={(e) => onChange(e.target.files?.[0])}
        />
      </label>
      {state.error && <p className="mt-2 text-[12.5px] text-bad">{state.error}</p>}
    </div>
  );
}
