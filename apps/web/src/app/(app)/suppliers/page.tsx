import type { Metadata } from 'next';
import { LABELS } from '@operaflow/shared';
import { apiGet, getMe } from '@/lib/api';
import type { SupplierRow } from '@/lib/types';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ContactEditor, SupplierForm } from './supplier-forms';

export const metadata: Metadata = { title: 'Suppliers' };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ inactive?: string }> }) {
  const sp = await searchParams;
  const [me, suppliers] = await Promise.all([getMe(), apiGet<SupplierRow[]>(`/suppliers${sp.inactive ? '?includeInactive=true' : ''}`)]);
  const canManage = me.permissions.includes('suppliers:manage');

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Supplier directory. Only the contact addresses listed here can ever receive automated follow-up emails (Phase 4)."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {suppliers.length === 0 && (
            <Card><EmptyState title="No suppliers yet">Add the wholesalers, bedbanks, DMCs and hotels you book through.</EmptyState></Card>
          )}
          {suppliers.map((s) => (
            <Card
              key={s.id}
              title={`${s.name}`}
              aside={
                <span className="flex items-center gap-1.5">
                  <Badge>{s.code}</Badge>
                  <Badge tone="brand">{LABELS[s.type]}</Badge>
                  {!s.isActive && <Badge tone="warn">Inactive</Badge>}
                </span>
              }
            >
              <div className="grid gap-4 p-4 md:grid-cols-[220px_1fr]">
                <dl className="space-y-1.5 text-[13px]">
                  <div><dt className="inline text-ink-3">Timezone: </dt><dd className="inline">{s.timezone}</dd></div>
                  <div><dt className="inline text-ink-3">Phone: </dt><dd className="inline">{s.phone ?? '—'}</dd></div>
                  <div><dt className="inline text-ink-3">Bookings: </dt><dd className="inline num">{s._count.bookings}</dd></div>
                  {s.notes && <div className="pt-1 text-ink-2">{s.notes}</div>}
                </dl>
                <ContactEditor supplierId={s.id} contacts={s.contacts} canManage={canManage} />
              </div>
              {canManage && (
                <details className="border-t border-line">
                  <summary className="cursor-pointer px-4 py-2 text-[12.5px] text-brand">Edit supplier</summary>
                  <SupplierForm supplier={s} />
                </details>
              )}
            </Card>
          ))}
        </div>
        {canManage && (
          <Card title="Add supplier" className="self-start">
            <SupplierForm />
          </Card>
        )}
      </div>
    </>
  );
}
