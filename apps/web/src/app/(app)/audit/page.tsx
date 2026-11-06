import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { Card, EmptyState, PageHeader, Table, Td, buttonClass, formatDateTime } from '@/components/ui';

export const metadata: Metadata = { title: 'Audit log' };

interface AuditPage {
  total: number;
  page: number;
  pageSize: number;
  items: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    ipAddress: string | null;
    metadata: unknown;
    createdAt: string;
    actor: { name: string; email: string } | null;
  }[];
}

export default async function AuditPageView({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (sp.action) qs.set('action', sp.action);
  const data = await apiGet<AuditPage>(`/audit-logs?${qs}`);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const link = (p: number) => `/audit?${new URLSearchParams({ ...(sp.action && { action: sp.action }), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins, configuration changes and data changes. Secrets are redacted." />
      <Card
        title={`${data.total.toLocaleString()} events`}
        aside={
          <form className="flex items-center gap-2">
            <input
              name="action"
              defaultValue={sp.action}
              placeholder="Filter by action prefix, e.g. auth."
              className="h-8 w-64 rounded-md border border-line-strong px-2.5 text-[12.5px]"
            />
          </form>
        }
      >
        {data.items.length === 0 ? (
          <EmptyState title="No matching events" />
        ) : (
          <Table head={['When', 'Actor', 'Action', 'Entity', 'IP', 'Details']}>
            {data.items.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-ink-3">{formatDateTime(e.createdAt)}</Td>
                <Td>{e.actor ? e.actor.name : <span className="text-ink-3">System / anonymous</span>}</Td>
                <Td><code className="font-mono text-[12px]">{e.action}</code></Td>
                <Td className="text-ink-3">
                  {e.entityType}
                  {e.entityId && <span className="ml-1 font-mono text-[11px]">{e.entityId.slice(0, 8)}</span>}
                </Td>
                <Td className="font-mono text-[12px] text-ink-3">{e.ipAddress ?? '—'}</Td>
                <Td className="max-w-[340px] truncate font-mono text-[11.5px] text-ink-3">
                  {e.metadata ? JSON.stringify(e.metadata) : ''}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">
          <span>
            Page {data.page} of {pages}
          </span>
          <span className="flex gap-2">
            {page > 1 && <Link className={buttonClass.secondary} href={link(page - 1)}>Previous</Link>}
            {page < pages && <Link className={buttonClass.secondary} href={link(page + 1)}>Next</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}
