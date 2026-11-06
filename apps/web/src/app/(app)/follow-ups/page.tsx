import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getMe } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, formatDateTime } from '@/components/ui';
import { CheckAllNow, RuleActions, TemplateEditor, TrackWizard } from './followup-forms';

export const metadata: Metadata = { title: 'Supplier follow-ups' };

interface Conversation {
  id: string;
  subject: string;
  status: string;
  recipients: string[];
  followUpCount: number;
  nextFollowUpAt: string | null;
  originalSentAt: string;
  lastExternalReplyAt: string | null;
  pausedReason: string | null;
  supplier: { id: string; name: string } | null;
  owner: { id: string; name: string };
  rule: { name: string; maxFollowUps: number; sendMode: string } | null;
  integration: { mailboxAddress: string; kind: string };
  executions: { id: string }[];
}
export interface Rule {
  id: string;
  name: string;
  delayHours: number;
  maxFollowUps: number;
  businessHoursOnly: boolean;
  businessStart: string;
  businessEnd: string;
  businessDays: number[];
  timezone: string;
  sendMode: string;
  isActive: boolean;
  autoSendApprovedAt: string | null;
  autoSendApprovedBy: { name: string } | null;
  template: { id: string; name: string };
  _count: { conversations: number };
}
export interface Template {
  id: string;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

const STATUS_LABEL: Record<string, string> = {
  TRACKING: 'Waiting for reply', FOLLOWUP_DUE: 'Follow-up due', AWAITING_APPROVAL: 'Draft to review', REPLIED: 'Replied', PAUSED: 'Paused',
  CANCELLED: 'Cancelled', EXHAUSTED: 'No reply (limit reached)', NEEDS_REVIEW: 'Needs review',
};
const TABS = ['ACTION', 'TRACKING', 'REPLIED', 'EXHAUSTED', 'PAUSED', 'CANCELLED', 'ALL'] as const;
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function FollowupsPage({ searchParams }: { searchParams: Promise<{ tab?: string; mine?: string }> }) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab! : 'ACTION';
  const [me, data, rules, templates, mailboxes, suppliers] = await Promise.all([
    getMe(),
    apiGet<{ items: Conversation[]; counts: { status: string; _count: number }[] }>(`/followups/conversations${sp.mine === 'true' ? '?mine=true' : ''}`),
    apiGet<Rule[]>('/followups/rules'),
    apiGet<{ variables: string[]; items: Template[] }>('/followups/templates'),
    apiGet<{ id: string; kind: string; mailboxAddress: string; status: string; lastError: string | null }[]>('/followups/mailboxes'),
    apiGet<{ id: string; name: string; contacts: { email: string }[] }[]>('/suppliers').catch(() => []),
  ]);
  const can = (p: string) => me.permissions.includes(p as never);
  const count = (s: string) => data.counts.find((c) => c.status === s)?._count ?? 0;
  const items = data.items.filter((c) =>
    tab === 'ALL' ? true : tab === 'ACTION' ? ['AWAITING_APPROVAL', 'NEEDS_REVIEW', 'FOLLOWUP_DUE'].includes(c.status) : c.status === tab,
  );
  const tabCount = (t: string) => (t === 'ALL' ? data.items.length : t === 'ACTION' ? count('AWAITING_APPROVAL') + count('NEEDS_REVIEW') + count('FOLLOWUP_DUE') : count(t));

  return (
    <>
      <PageHeader
        title="Supplier follow-ups"
        description="Tracked quotation and rate-request threads. When a supplier doesn't reply in time, a follow-up is drafted for review, or sent automatically only on rules an administrator approved."
        actions={can('suppliers:manage') && <CheckAllNow />}
      />
      {mailboxes.length === 0 && (
        <p className="mb-4 rounded-md bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
          No mailbox is connected. An administrator connects Gmail or Microsoft 365 under <Link href="/integrations" className="underline">Integrations</Link>.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card
          title="Conversations"
          aside={
            <div className="flex flex-wrap gap-1 text-[12.5px]">
              {TABS.map((t) => (
                <Link key={t} href={`/follow-ups?tab=${t}${sp.mine === 'true' ? '&mine=true' : ''}`} className={`rounded px-2 py-0.5 ${tab === t ? 'bg-brand-soft font-medium text-brand' : 'text-ink-3 hover:bg-sunken'}`}>
                  {t === 'ACTION' ? 'Needs action' : t === 'ALL' ? 'All' : STATUS_LABEL[t]} <span className="num">{tabCount(t)}</span>
                </Link>
              ))}
              <Link href={`/follow-ups?tab=${tab}${sp.mine === 'true' ? '' : '&mine=true'}`} className="rounded px-2 py-0.5 text-ink-3 hover:bg-sunken">{sp.mine === 'true' ? 'Everyone' : 'Mine only'}</Link>
            </div>
          }
        >
          {items.length === 0 ? (
            <EmptyState title={tab === 'ACTION' ? 'Nothing needs your attention' : 'No conversations'} />
          ) : (
            <Table head={['Subject', 'Supplier', 'Owner', 'Status', 'Sent', 'Follow-ups', 'Next']}>
              {items.map((c) => (
                <tr key={c.id}>
                  <Td className="max-w-[280px]">
                    <Link href={`/follow-ups/${c.id}`} className="block truncate font-medium text-brand hover:underline">{c.subject}</Link>
                    <span className="block truncate text-[11.5px] text-ink-3">{c.recipients.join(', ')}</span>
                  </Td>
                  <Td>{c.supplier?.name ?? '—'}</Td>
                  <Td>{c.owner.name}</Td>
                  <Td>
                    <StatusBadge value={c.status === 'AWAITING_APPROVAL' || c.status === 'NEEDS_REVIEW' ? 'PENDING' : c.status === 'REPLIED' ? 'CONFIRMED' : c.status === 'TRACKING' ? 'READY' : c.status} label={STATUS_LABEL[c.status]} />
                    {c.pausedReason && <div className="mt-0.5 max-w-[200px] truncate text-[11px] text-ink-3" title={c.pausedReason}>{c.pausedReason}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-3">{formatDateTime(c.originalSentAt)}</Td>
                  <Td className="num">{c.followUpCount}/{c.rule?.maxFollowUps ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-ink-3">{c.nextFollowUpAt ? formatDateTime(c.nextFollowUpAt) : '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          {can('followups:manage') && (
            <Card title="Track a sent email">
              <TrackWizard mailboxes={mailboxes} suppliers={suppliers} rules={rules.filter((r) => r.isActive)} />
            </Card>
          )}
          <Card title="Follow-up rules">
            <ul className="divide-y divide-line">
              {rules.map((r) => (
                <li key={r.id} className="px-4 py-3 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.sendMode === 'AUTO_SEND' ? <Badge tone="bad">Auto-send</Badge> : <Badge tone="ok">Draft review</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-3">
                    After {r.delayHours}h · max {r.maxFollowUps} · {r.businessHoursOnly ? `${r.businessDays.map((d) => DAY[d]).join(' ')} ${r.businessStart}–${r.businessEnd}` : 'any time'} · {r.timezone} · template “{r.template.name}”
                  </div>
                  {r.sendMode === 'AUTO_SEND' && r.autoSendApprovedBy && (
                    <div className="mt-0.5 text-[12px] text-ink-3">Unattended sending approved by {r.autoSendApprovedBy.name} on {formatDateTime(r.autoSendApprovedAt)}</div>
                  )}
                  <RuleActions rule={r} canApprove={can('followups:approve-autosend')} canManage={can('suppliers:manage')} />
                </li>
              ))}
            </ul>
          </Card>
          {can('suppliers:manage') && (
            <Card title="Templates">
              <TemplateEditor templates={templates.items} variables={templates.variables} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
