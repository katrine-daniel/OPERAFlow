import { ModulePending } from '@/components/module-pending';

export const metadata = { title: 'Daily reports' };

export default function Page() {
  return (
    <ModulePending
      title="Daily operations reports"
      phase={3}
      summary="Timezone-aware scheduled reports built from the booking registry, exported to Excel and PDF."
      scope={[
        'Preview before enabling a schedule',
        'Email delivery to approved recipients only',
        'Delivery history and duplicate-free retries',
        'Missing-data warnings (never silent defaults)',
        'Reconciliation summaries and date filters',
        'Operations-group delivery via authorised integration',
      ]}
    />
  );
}
