import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getMe } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, formatDateTime } from '@/components/ui';
import { RunBadge } from '@/components/run-badge';
import { EnvironmentForm, RunButton } from './testing-forms';

export const metadata: Metadata = { title: 'Booking-site tests' };

export interface Env {
  id: string;
  name: string;
  baseUrl: string;
  kind: string;
  allowBookingMutations: boolean;
  isActive: boolean;
  hasSecrets: boolean;
  config: { allowedHosts?: string[]; allowedWritePaths?: string[] };
}
interface Scenario {
  id: string;
  key: string;
  name: string;
  journey: string;
  isCritical: boolean;
  mutatesBookings: boolean;
  viewports: string[];
  isActive: boolean;
  configured: boolean;
  cron: string | null;
  nextRuns: string[];
  environment: { id: string; name: string } | null;
  runs: { id: string; status: string; viewport: string; queuedAt: string; durationMs: number | null; failureClass: string | null; environment: { name: string } }[];
}
interface Run {
  id: string;
  status: string;
  viewport: string;
  trigger: string;
  queuedAt: string;
  durationMs: number | null;
  failureClass: string | null;
  scenario: { id: string; name: string; isCritical: boolean };
  environment: { name: string; kind: string };
  triggeredBy: { name: string } | null;
}


export default async function TestingPage() {
  const [me, envs, scenarios, runs] = await Promise.all([getMe(), apiGet<Env[]>('/testing/environments'), apiGet<Scenario[]>('/testing/scenarios'), apiGet<Run[]>('/testing/runs')]);
  const canRun = me.permissions.includes('tests:run');
  const canManage = me.permissions.includes('tests:manage');
  const last24 = runs.filter((r) => Date.now() - new Date(r.queuedAt).getTime() < 86_400_000);
  const finished = last24.filter((r) => ['PASSED', 'FAILED', 'ERROR', 'BLOCKED_SAFETY'].includes(r.status));
  const durations = finished.map((r) => r.durationMs ?? 0).filter(Boolean);

  return (
    <>
      <PageHeader
        title="Booking-site test automation"
        description="Playwright journeys against an authorised environment of the booking website. Booking creation, modification and cancellation run only in a SANDBOX with mutations explicitly enabled; real card numbers are refused and other hosts are blocked."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Runs (24h)" value={last24.length} />
        <Stat label="Passed (24h)" value={finished.filter((r) => r.status === 'PASSED').length} />
        <Stat label="Failed / blocked (24h)" value={finished.filter((r) => r.status !== 'PASSED').length} tone={finished.some((r) => r.status !== 'PASSED' && r.scenario.isCritical) ? 'bad' : undefined} />
        <Stat label="Median duration" value={durations.length ? `${(durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)]! / 1000).toFixed(1)}s` : '—'} />
      </div>

      {envs.length === 0 && (
        <p className="mb-4 rounded-md bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
          No test environment configured. Add the booking website's sandbox or staging URL below. Scenarios cannot run until one exists.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title="Scenarios">
            <Table head={['Scenario', 'Type', 'Last runs', 'Schedule', ...(canRun ? ['Run'] : [])]}>
              {scenarios.map((s) => (
                <tr key={s.id} className={s.isActive ? '' : 'opacity-60'}>
                  <Td className="max-w-[280px]">
                    <Link href={`/testing/scenarios/${s.id}`} className="font-medium text-brand hover:underline">{s.name}</Link>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {s.isCritical && <Badge tone="bad">Critical</Badge>}
                      {s.mutatesBookings && <Badge tone="warn">Sandbox only</Badge>}
                      {!s.configured && <Badge>Steps not configured</Badge>}
                    </div>
                  </Td>
                  <Td className="text-[12px] text-ink-3">{s.journey.replace(/_/g, ' ').toLowerCase()}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {s.runs.length === 0 && <span className="text-[12px] text-ink-3">never run</span>}
                      {s.runs.map((r) => (
                        <Link key={r.id} href={`/testing/runs/${r.id}`} title={`${r.status} · ${r.viewport} · ${r.environment.name} · ${formatDateTime(r.queuedAt)}`}
                          className={`h-4 w-4 rounded-sm ${r.status === 'PASSED' ? 'bg-ok' : r.status === 'BLOCKED_SAFETY' ? 'bg-warn' : ['QUEUED', 'RUNNING'].includes(r.status) ? 'bg-info' : 'bg-bad'}`} />
                      ))}
                    </div>
                  </Td>
                  <Td className="text-[12px] text-ink-3">{s.cron ? `${s.cron} → ${s.environment?.name ?? '?'}` : 'manual'}{s.nextRuns[0] && <div>next {formatDateTime(s.nextRuns[0])}</div>}</Td>
                  {canRun && (
                    <Td>
                      <RunButton scenarioId={s.id} environments={envs.filter((e) => e.isActive && (!s.mutatesBookings || (e.kind === 'SANDBOX' && e.allowBookingMutations)))} disabled={!s.configured || !s.isActive} />
                    </Td>
                  )}
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Recent runs">
            {runs.length === 0 ? (
              <EmptyState title="No runs yet" />
            ) : (
              <Table head={['Queued', 'Scenario', 'Environment', 'Viewport', 'Trigger', 'Result', 'Duration']}>
                {runs.slice(0, 40).map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap"><Link href={`/testing/runs/${r.id}`} className="text-brand hover:underline">{formatDateTime(r.queuedAt)}</Link></Td>
                    <Td>{r.scenario.name}{r.scenario.isCritical && <span className="ml-1"><Badge tone="bad">critical</Badge></span>}</Td>
                    <Td className="text-ink-3">{r.environment.name}</Td>
                    <Td>{r.viewport}</Td>
                    <Td className="text-ink-3">{r.trigger === 'SCHEDULED' ? 'Scheduled' : r.triggeredBy?.name ?? 'Manual'}</Td>
                    <Td><RunBadge status={r.status} />{r.failureClass && <div className="text-[11px] text-ink-3">{r.failureClass.toLowerCase().replace('_', ' ')}</div>}</Td>
                    <Td className="num">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Environments">
            {envs.length === 0 ? (
              <EmptyState title="None configured" />
            ) : (
              <ul className="divide-y divide-line">
                {envs.map((e) => (
                  <li key={e.id} className="px-4 py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{e.name}</span>
                      <span className="flex gap-1">
                        <Badge tone={e.kind === 'SANDBOX' ? 'ok' : e.kind === 'PRODUCTION_READONLY' ? 'bad' : 'info'}>{e.kind.replace('_', ' ').toLowerCase()}</Badge>
                        {e.allowBookingMutations && <Badge tone="warn">mutations on</Badge>}
                        {!e.isActive && <Badge>inactive</Badge>}
                      </span>
                    </div>
                    <div className="truncate text-[12px] text-ink-3">{e.baseUrl}{e.hasSecrets && ' · credentials stored'}</div>
                    {canManage && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[12px] text-brand">Edit</summary>
                        <EnvironmentForm environment={e} />
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {canManage && (
            <Card title="Add environment">
              <EnvironmentForm />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
