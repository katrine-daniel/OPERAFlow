import type { Metadata } from 'next';
import { apiGet, getMe } from '@/lib/api';
import type { SourceRow } from '@/lib/types';
import { Badge, Card, PageHeader, StatusBadge, formatDateTime } from '@/components/ui';
import { WebhookSecret } from './webhook-secret';

export const metadata: Metadata = { title: 'Booking sources' };

const ADAPTER_LABEL: Record<string, string> = { API: 'API sync', WEBHOOK: 'Signed webhook', CSV_IMPORT: 'File import', MANUAL: 'Manual / CSV' };

export default async function SourcesPage() {
  const [me, sources] = await Promise.all([getMe(), apiGet<SourceRow[]>('/booking-sources')]);
  const canManage = me.permissions.includes('integrations:manage');

  return (
    <>
      <PageHeader
        title="Booking sources"
        description="Where bookings come from, and exactly how each source is connected today. Nothing is shown as live unless it has received verified data."
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {sources.map((s) => {
          const live = s.integration?.status === 'CONNECTED';
          return (
            <Card
              key={s.id}
              title={s.name}
              aside={
                <span className="flex gap-1.5">
                  <StatusBadge value={s.channel} />
                  <Badge>{ADAPTER_LABEL[s.adapter]}</Badge>
                  {s.adapter === 'API' || s.adapter === 'WEBHOOK' ? (
                    <Badge tone={live ? 'ok' : 'warn'}>{live ? 'Receiving data' : 'Not connected'}</Badge>
                  ) : (
                    <Badge tone="neutral">No live API</Badge>
                  )}
                </span>
              }
            >
              <div className="space-y-2 px-4 py-3 text-[13px] text-ink-2">
                <p>{s.adapterNote}</p>
                <p className="text-ink-3"><span className="font-mono text-[12px]">{s.code}</span> · {s._count.bookings} booking{s._count.bookings === 1 ? '' : 's'}</p>
                {s.integration && (
                  <p className="text-[12.5px] text-ink-3">
                    Last data: {s.integration.lastSyncAt ? formatDateTime(s.integration.lastSyncAt) : 'never'}
                    {s.integration.lastError && <span className="block text-bad">Last error: {s.integration.lastError}</span>}
                  </p>
                )}
              </div>
              {s.adapter === 'WEBHOOK' && canManage && <WebhookSecret sourceId={s.id} path={s.webhookPath!} hasSecret={Boolean(s.integration)} />}
            </Card>
          );
        })}
      </div>
    </>
  );
}
