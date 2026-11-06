import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import { Card, PageHeader, formatDateTime } from '@/components/ui';
import { RetentionForm } from './retention-form';

export const metadata: Metadata = { title: 'Settings' };

interface Retention {
  values: Record<string, number>;
  minimums: Record<string, number>;
  lastRun: { createdAt: string; metadata: Record<string, unknown> | null } | null;
}

export default async function SettingsPage() {
  const r = await apiGet<Retention>('/settings/retention');
  const last = r.lastRun?.metadata as Record<string, number> | undefined;
  return (
    <>
      <PageHeader title="Settings" description="System-wide configuration. Changes are recorded in the audit log." />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title="Data retention">
          <RetentionForm values={r.values} minimums={r.minimums} />
        </Card>
        <Card title="Last purge" className="self-start">
          <div className="space-y-1 px-4 py-3 text-[13px]">
            {r.lastRun ? (
              <>
                <div>{formatDateTime(r.lastRun.createdAt)}</div>
                <ul className="text-ink-3">
                  {['sessions', 'notifications', 'jobExecutions', 'testArtifacts', 'reportFiles', 'auditLogs'].map((k) => <li key={k}>{k}: {last?.[k] ?? 0} removed</li>)}
                </ul>
              </>
            ) : (
              <p className="text-ink-3">Never run. The worker runs it nightly (RETENTION_CRON), or run it now.</p>
            )}
            <p className="pt-2 text-[12px] text-ink-3">Bookings, their history and documents are business records and are never purged automatically.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
