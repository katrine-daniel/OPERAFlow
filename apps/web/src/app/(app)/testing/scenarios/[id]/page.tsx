import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getMe } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import type { Env } from '../../page';
import { ScenarioEditor } from './scenario-editor';

export const metadata: Metadata = { title: 'Scenario' };

export interface ScenarioFull {
  id: string;
  key: string;
  name: string;
  description: string | null;
  journey: string;
  isCritical: boolean;
  mutatesBookings: boolean;
  viewports: string[];
  config: unknown;
  cron: string | null;
  timezone: string;
  isActive: boolean;
  environment: { id: string; name: string } | null;
}

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, scenarios, envs] = await Promise.all([getMe(), apiGet<ScenarioFull[]>('/testing/scenarios'), apiGet<Env[]>('/testing/environments')]);
  const s = scenarios.find((x) => x.id === id);
  if (!s) return <p>Scenario not found.</p>;
  return (
    <>
      <div className="mb-2 text-[12.5px]"><Link href="/testing" className="text-brand hover:underline">← Test automation</Link></div>
      <PageHeader title={s.name} description={`${s.key} · ${s.journey.replace(/_/g, ' ').toLowerCase()}${s.mutatesBookings ? ' · creates/changes bookings: SANDBOX only' : ''}`} />
      <ScenarioEditor scenario={s} environments={envs} canManage={me.permissions.includes('tests:manage')} />
    </>
  );
}
