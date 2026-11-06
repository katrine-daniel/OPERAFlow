import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getMe } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, StatusBadge, formatDateTime } from '@/components/ui';
import { ConversationActions, ExecutionActions } from './actions';

export const metadata: Metadata = { title: 'Follow-up' };

interface Detail {
  id: string;
  subject: string;
  status: string;
  recipients: string[];
  followUpCount: number;
  nextFollowUpAt: string | null;
  originalSentAt: string;
  lastCheckedAt: string | null;
  pausedReason: string | null;
  ownerId: string;
  supplier: { id: string; name: string } | null;
  owner: { id: string; name: string };
  rule: { name: string; delayHours: number; maxFollowUps: number; sendMode: string; template: { name: string } } | null;
  integration: { mailboxAddress: string; kind: string; status: string };
  messages: { id: string; direction: string; fromAddress: string; subject: string | null; classification: string; receivedAt: string }[];
  executions: { id: string; sequence: number; status: string; subject: string | null; body: string | null; recipients: string[]; attempts: number; lastError: string | null; skipReason: string | null; sentAt: string | null; scheduledFor: string; approvedBy: { name: string } | null }[];
}

const CLASS_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  ORIGINAL: { label: 'Original request', tone: 'info' },
  OWN_FOLLOW_UP: { label: 'Our follow-up', tone: 'info' },
  QUALIFYING_REPLY: { label: 'Supplier reply', tone: 'ok' },
  OUT_OF_OFFICE: { label: 'Out of office (ignored)', tone: 'neutral' },
  AUTO_REPLY: { label: 'Auto-reply (ignored)', tone: 'neutral' },
  BOUNCE: { label: 'Bounce', tone: 'bad' },
  INTERNAL: { label: 'Internal (ignored)', tone: 'neutral' },
  AMBIGUOUS: { label: 'Unknown sender', tone: 'warn' },
};

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, c] = await Promise.all([getMe(), apiGet<Detail>(`/followups/conversations/${id}`)]);
  const canAct = me.permissions.includes('followups:manage') && (c.ownerId === me.id || me.permissions.includes('suppliers:manage'));
  const pending = c.executions.find((e) => e.status === 'AWAITING_APPROVAL');

  return (
    <>
      <div className="mb-2 text-[12.5px]"><Link href="/follow-ups" className="text-brand hover:underline">← Follow-ups</Link></div>
      <PageHeader
        title={c.subject}
        description={`${c.supplier?.name ?? 'No supplier'} · ${c.recipients.join(', ')} · from ${c.integration.mailboxAddress} · owner ${c.owner.name}`}
        actions={canAct && <ConversationActions id={c.id} status={c.status} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <StatusBadge value={c.status === 'REPLIED' ? 'CONFIRMED' : c.status === 'NEEDS_REVIEW' || c.status === 'AWAITING_APPROVAL' ? 'PENDING' : c.status} label={c.status.replace(/_/g, ' ').toLowerCase()} />
        <span className="text-ink-3">Rule: {c.rule ? `${c.rule.name} (${c.rule.sendMode === 'AUTO_SEND' ? 'auto-send' : 'draft review'})` : '—'}</span>
        <span className="text-ink-3">· Follow-ups {c.followUpCount}/{c.rule?.maxFollowUps ?? '—'}</span>
        {c.nextFollowUpAt && <span className="text-ink-3">· Next due {formatDateTime(c.nextFollowUpAt)}</span>}
        <span className="text-ink-3">· Last checked {formatDateTime(c.lastCheckedAt)}</span>
      </div>
      {c.pausedReason && <p className="mb-4 rounded-md bg-warn-soft px-4 py-2.5 text-[13px] text-warn">{c.pausedReason}</p>}

      {pending && (
        <Card title={`Follow-up #${pending.sequence} awaiting your review`} className="mb-4 border-brand/40">
          <div className="space-y-2 px-4 py-3 text-[13px]">
            <div><span className="text-ink-3">To:</span> {pending.recipients.join(', ')}</div>
            <div><span className="text-ink-3">Subject:</span> {pending.subject}</div>
            <pre className="whitespace-pre-wrap rounded-md bg-sunken p-3 font-sans text-[13px]">{pending.body}</pre>
            <p className="text-[12px] text-ink-3">The draft is also in the mailbox's Drafts folder. Before sending, the thread is checked again; if the supplier has replied, nothing is sent.</p>
          </div>
          {canAct && <ExecutionActions id={pending.id} />}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Thread activity">
          {c.messages.length === 0 ? (
            <EmptyState title="Not checked yet" />
          ) : (
            <ol className="divide-y divide-line">
              {c.messages.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <div className="truncate">{m.fromAddress}</div>
                    <div className="truncate text-[12px] text-ink-3">{m.subject}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge tone={CLASS_LABEL[m.classification]?.tone ?? 'neutral'}>{CLASS_LABEL[m.classification]?.label ?? m.classification}</Badge>
                    <div className="mt-0.5 text-[11.5px] text-ink-3">{formatDateTime(m.receivedAt)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Follow-up history">
          {c.executions.length === 0 ? (
            <EmptyState title="No follow-ups yet" />
          ) : (
            <ol className="divide-y divide-line">
              {c.executions.map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">#{e.sequence}</span>
                    <StatusBadge value={e.status === 'SENT' ? 'CONFIRMED' : e.status === 'AWAITING_APPROVAL' ? 'PENDING' : e.status} label={e.status.replace(/_/g, ' ').toLowerCase()} />
                  </div>
                  <div className="text-[12px] text-ink-3">
                    {e.sentAt ? `Sent ${formatDateTime(e.sentAt)}${e.approvedBy ? ` · approved by ${e.approvedBy.name}` : ' · automatically'}` : `Due ${formatDateTime(e.scheduledFor)}`}
                    {e.attempts > 1 && ` · ${e.attempts} attempts`}
                  </div>
                  {e.lastError && <div className="text-[12px] text-bad">{e.lastError}</div>}
                  {e.skipReason && <div className="text-[12px] text-ink-3">{e.skipReason}</div>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
