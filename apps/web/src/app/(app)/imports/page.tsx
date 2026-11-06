import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import type { SourceRow } from '@/lib/types';
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, formatDateTime } from '@/components/ui';
import { ImportWizard } from './import-wizard';

export const metadata: Metadata = { title: 'Imports' };

interface ImportRow {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  createdAt: string;
  completedAt: string | null;
  source: { name: string };
  uploadedBy: { name: string } | null;
}

export default async function ImportsPage() {
  const [sources, imports] = await Promise.all([apiGet<SourceRow[]>('/booking-sources'), apiGet<ImportRow[]>('/booking-imports')]);
  return (
    <>
      <PageHeader
        title="Booking imports"
        description="Bulk-load bookings from a CSV or Excel export (TBO, supplier statements, approved website exports). Every file is validated and previewed before anything is written."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <ImportWizard sources={sources.filter((s) => s.acceptsImport && s.isActive).map((s) => ({ id: s.id, name: s.name }))} />
        <Card title="How matching works">
          <ul className="space-y-2 px-4 py-3 text-[13px] text-ink-2">
            <li><b>external_ref</b> is required. A row whose reference already exists for the chosen source updates that booking; otherwise a new booking is created.</li>
            <li>Blank cells never erase existing data, and missing amounts stay missing instead of becoming zero.</li>
            <li>Dates: <code>YYYY-MM-DD</code>, <code>DD/MM/YYYY</code> or real Excel date cells. Amounts may use thousands separators.</li>
            <li>Hotels are matched on name + city + country and created if new. Supplier codes and owner emails must already exist.</li>
            <li>Uploading the identical file twice for the same source is refused.</li>
          </ul>
          <div className="border-t border-line px-4 py-3">
            <a href="/api/booking-imports/template.csv" className="text-[13px] font-medium text-brand hover:underline">Download CSV template</a>
          </div>
        </Card>
      </div>

      <Card title="Recent imports" className="mt-4">
        {imports.length === 0 ? (
          <EmptyState title="No imports yet" />
        ) : (
          <Table head={['When', 'File', 'Source', 'By', 'Status', 'Rows', 'Created', 'Updated', 'Skipped', 'Errors']}>
            {imports.map((i) => (
              <tr key={i.id}>
                <Td className="whitespace-nowrap text-ink-3">{formatDateTime(i.createdAt)}</Td>
                <Td className="max-w-[220px] truncate">{i.fileName}</Td>
                <Td>{i.source.name}</Td>
                <Td>{i.uploadedBy?.name ?? '—'}</Td>
                <Td><StatusBadge value={i.status} /></Td>
                <Td className="num">{i.totalRows}</Td>
                <Td className="num">{i.status === 'COMMITTED' ? i.createdRows : '—'}</Td>
                <Td className="num">{i.status === 'COMMITTED' ? i.updatedRows : '—'}</Td>
                <Td className="num">{i.status === 'COMMITTED' ? i.skippedRows : '—'}</Td>
                <Td className={`num ${i.errorRows ? 'text-bad' : ''}`}>{i.errorRows}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
