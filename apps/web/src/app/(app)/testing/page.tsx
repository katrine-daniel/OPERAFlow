import { ModulePending } from '@/components/module-pending';

export const metadata = { title: 'Booking-site tests' };

export default function Page() {
  return (
    <ModulePending
      title="Booking-site test automation"
      phase={5}
      summary="Playwright journeys against an authorised sandbox of the booking website, on demand or on a schedule."
      scope={[
        'Search, availability, rate selection and guest validation',
        'Sandbox-only create, confirm, modify and cancel journeys',
        'Desktop and mobile viewports',
        'Screenshots, traces and failure classification',
        'Run history with durations and reproducible details',
        'Alerts for failed critical scenarios',
      ]}
    />
  );
}
