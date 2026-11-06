import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, Table, Td, formatDateTime } from '@/components/ui';
import { RunBadge } from '@/components/run-badge';

export const metadata: Metadata = { title: 'Test run' };

interface RunDetail {
  id: string;
  status: string;
  viewport: string;
  trigger: string;
  failureClass: string | null;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  steps: { index: number; action: string; name?: string; target?: string; status: string; durationMs: number; error?: string }[];
  diagnostics: { blockedRequests?: { url: string; reason: string }[]; httpErrors?: { url: string; status: number }[]; consoleErrors?: string[]; safety?: string[]; extracted?: Record<string, string> };
  scenario: { id: string; name: string; journey: string; isCritical: boolean };
  environment: { name: string; kind: string; baseUrl: string };
  triggeredBy: { name: string } | null;
  artifacts: { id: string; kind: string; sizeBytes: number }[];
}

const FAILURE_HELP: Record<string, string> = {
  ASSERTION: 'The page loaded but did not show what the scenario expects. Check the failure screenshot.',
  TIMEOUT: 'An element did not appear in time: a slow site, a changed selector, or a missing element.',
  NETWORK: 'The site could not be reached (DNS, connection refused, TLS).',
  HTTP_ERROR: 'The site returned an HTTP error status.',
  ENVIRONMENT: 'The scenario or environment is misconfigured (missing steps, unknown variable or secret, browser not installed).',
  SAFETY_GUARD: 'OPERAFlow refused to run this because it could create real bookings or charges, or leave the allowed site.',
  UNKNOWN: 'Unexpected error. Download the trace for full details.',
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await apiGet<RunDetail>(`/testing/runs/${id}`);
  const d = r.diagnostics ?? {};
  const shots = r.artifacts.filter((a) => a.kind === 'SCREENSHOT');
  const trace = r.artifacts.find((a) => a.kind === 'TRACE');

  return (
    <>
      <div className="mb-2 text-[12.5px]"><Link href="/testing" className="text-brand hover:underline">← Test automation</Link></div>
      <PageHeader
        title={r.scenario.name}
        description={`${r.environment.name} (${r.environment.kind.toLowerCase().replace('_', ' ')}) · ${r.viewport} · ${r.trigger === 'SCHEDULED' ? 'scheduled' : `run by ${r.triggeredBy?.name ?? 'unknown'}`} · ${formatDateTime(r.queuedAt)}`}
        actions={
          <span className="flex items-center gap-2">
            <RunBadge status={r.status} />
            {trace && <a href={`/api/testing/runs/${r.id}/artifacts/${trace.id}`} className={`inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-sunken`}>Download trace</a>}
          </span>
        }
      />
      {r.failureClass && (
        <div className="mb-4 rounded-md border border-bad/20 bg-bad-soft px-4 py-3 text-[13px] text-bad">
          <div className="font-medium">{r.failureClass.replace('_', ' ').toLowerCase()}: {FAILURE_HELP[r.failureClass]}</div>
          {r.errorMessage && <pre className="mt-1 whitespace-pre-wrap font-mono text-[12px]">{r.errorMessage}</pre>}
        </div>
      )}
      {trace && <p className="-mt-2 mb-4 text-[12px] text-ink-3">Open the trace at trace.playwright.dev (it loads locally in your browser) to replay every step with DOM snapshots and network calls.</p>}

      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card title={`Steps (${r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : 'not finished'})`}>
          {r.steps.length === 0 ? (
            <EmptyState title={r.status === 'QUEUED' || r.status === 'RUNNING' ? 'Running…' : 'No steps executed'} />
          ) : (
            <Table head={['#', 'Action', 'Target', 'Result', 'Time']}>
              {r.steps.map((s) => (
                <tr key={s.index} className={s.status === 'failed' ? 'bg-bad-soft/40' : ''}>
                  <Td className="num text-ink-3">{s.index + 1}</Td>
                  <Td className="font-mono text-[12px]">{s.action}{s.name && <span className="ml-1 font-sans text-ink-3">{s.name}</span>}</Td>
                  <Td className="max-w-[300px] truncate font-mono text-[12px] text-ink-3" >{s.target ?? ''}</Td>
                  <Td>
                    <Badge tone={s.status === 'passed' ? 'ok' : s.status === 'failed' ? 'bad' : 'neutral'}>{s.status}</Badge>
                    {s.error && <div className="mt-0.5 max-w-[360px] text-[11.5px] text-bad">{s.error}</div>}
                  </Td>
                  <Td className="num text-ink-3">{s.durationMs ? `${s.durationMs} ms` : ''}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          {shots.length > 0 && (
            <Card title="Screenshots">
              <div className="space-y-2 p-3">
                {shots.map((a) => (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated artifact stream, not a static asset
                  <a key={a.id} href={`/api/testing/runs/${r.id}/artifacts/${a.id}`} target="_blank" rel="noreferrer"><img src={`/api/testing/runs/${r.id}/artifacts/${a.id}`} alt="Run screenshot" className="w-full rounded border border-line" /></a>
                ))}
              </div>
            </Card>
          )}
          <Card title="Diagnostics">
            <div className="space-y-3 px-4 py-3 text-[12.5px]">
              {d.safety?.length ? <div><div className="font-medium text-warn">Safety</div><ul>{d.safety.map((s) => <li key={s}>{s}</li>)}</ul></div> : null}
              <div>
                <div className="font-medium">Blocked requests ({d.blockedRequests?.length ?? 0})</div>
                <ul className="text-ink-3">{d.blockedRequests?.map((b, i) => <li key={i} className="truncate" title={b.url}>{b.reason}: {b.url}</li>)}</ul>
              </div>
              <div>
                <div className="font-medium">HTTP 5xx responses ({d.httpErrors?.length ?? 0})</div>
                <ul className="text-ink-3">{d.httpErrors?.map((h, i) => <li key={i} className="truncate">{h.status} {h.url}</li>)}</ul>
              </div>
              <div>
                <div className="font-medium">Console errors ({d.consoleErrors?.length ?? 0})</div>
                <ul className="text-ink-3">{d.consoleErrors?.map((c, i) => <li key={i} className="truncate" title={c}>{c}</li>)}</ul>
              </div>
              {d.extracted && Object.keys(d.extracted).length > 0 && (
                <div><div className="font-medium">Captured values</div><ul className="font-mono text-ink-3">{Object.entries(d.extracted).map(([k, v]) => <li key={k}>{k} = {v}</li>)}</ul></div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
