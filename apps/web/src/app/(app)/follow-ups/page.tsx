import { ModulePending } from '@/components/module-pending';

export const metadata = { title: 'Supplier follow-ups' };

export default function Page() {
  return (
    <ModulePending
      title="Supplier follow-ups"
      phase={4}
      summary="Track quotation and rate-request threads in Gmail or Microsoft 365 and follow up when suppliers do not reply."
      scope={[
        'OAuth mailbox connection (Gmail, Microsoft Graph)',
        '24/48/72-hour rules with business hours and timezone',
        'Reply detection: out-of-office, bounces, ambiguous replies',
        'Draft-review mode by default; admin-approved auto-send',
        'Maximum follow-up limits and duplicate-send prevention',
        'Pause, cancel and override per conversation',
      ]}
    />
  );
}
