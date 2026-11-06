'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiSend, apiUpload, ClientApiError } from '@/lib/client';
import { Badge, Card, Field, Table, Td, buttonClass, inputClass } from '@/components/ui';

interface Preview {
  id: string;
  status: string;
  source: { name: string };
  totalRows: number;
  readyRows: number;
  errorRows: number;
  wouldCreate: number;
  wouldUpdate: number;
  unmappedColumns: string[];
  errors: { row: number; field: string; message: string }[];
}

interface CommitResult {
  created: number;
  updated: number;
  unchanged: number;
  stale: number;
  skippedInvalid: number;
}

export function ImportWizard({ sources }: { sources: { id: string; name: string }[] }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await apiUpload<Preview>('/booking-imports', new FormData(e.currentTarget)));
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Upload failed');
    } finally {
      setPending(false);
    }
  }

  async function onCommit(skipInvalid: boolean) {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      setResult(await apiSend<CommitResult>('POST', `/booking-imports/${preview.id}/commit`, { skipInvalid }));
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Import failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title="Import a file">
      <form onSubmit={onPreview} className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Source / channel">
          <select name="sourceId" required className={inputClass} defaultValue="">
            <option value="" disabled>Choose…</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="CSV or .xlsx file">
          <input name="file" type="file" required accept=".csv,.xlsx" className="block w-full text-[12.5px] file:mr-2 file:rounded file:border file:border-line-strong file:bg-surface file:px-2 file:py-1" />
        </Field>
        <button disabled={pending} className={buttonClass.primary}>{pending && !preview ? 'Checking…' : 'Preview'}</button>
      </form>

      {error && <p role="alert" className="mx-4 mb-4 rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}

      {result && (
        <div className="mx-4 mb-4 rounded-md bg-ok-soft px-3 py-2 text-[13px] text-ok">
          Imported: {result.created} created, {result.updated} updated, {result.unchanged + result.stale} unchanged
          {result.skippedInvalid ? `, ${result.skippedInvalid} invalid rows skipped` : ''}. <Link href="/bookings" className="underline">Open registry</Link>
        </div>
      )}

      {preview && (
        <div className="border-t border-line">
          <div className="flex flex-wrap gap-2 px-4 py-3 text-[13px]">
            <Badge>{preview.totalRows} rows</Badge>
            <Badge tone="ok">{preview.wouldCreate} new</Badge>
            <Badge tone="info">{preview.wouldUpdate} updates</Badge>
            <Badge tone={preview.errorRows ? 'bad' : 'neutral'}>{preview.errorRows} with errors</Badge>
          </div>
          {preview.unmappedColumns.length > 0 && (
            <p className="px-4 pb-2 text-[12.5px] text-warn">Ignored columns (not recognised): {preview.unmappedColumns.join(', ')}</p>
          )}
          {preview.errors.length > 0 && (
            <div className="max-h-72 overflow-y-auto border-y border-line">
              <Table head={['Row', 'Field', 'Problem']}>
                {preview.errors.map((e, i) => (
                  <tr key={i}>
                    <Td className="num">{e.row}</Td>
                    <Td className="font-mono text-[12px]">{e.field}</Td>
                    <Td>{e.message}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {preview.readyRows === 0 ? (
              <p className="text-[13px] text-bad">No valid rows to import. Fix the file and upload it again.</p>
            ) : preview.errorRows === 0 ? (
              <button disabled={pending} onClick={() => onCommit(false)} className={buttonClass.primary}>Import {preview.readyRows} rows</button>
            ) : (
              <button disabled={pending} onClick={() => onCommit(true)} className={buttonClass.primary}>
                Import {preview.readyRows} valid rows, skip {preview.errorRows}
              </button>
            )}
            <button onClick={() => setPreview(null)} className={buttonClass.secondary}>Discard</button>
          </div>
        </div>
      )}
    </Card>
  );
}
