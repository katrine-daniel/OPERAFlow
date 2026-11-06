import { ModulePending } from '@/components/module-pending';

export const metadata = { title: 'Integrations' };

export default function Page() {
  return (
    <ModulePending
      title="Integrations"
      phase={4}
      summary="Connections to mailboxes, booking APIs and report channels. Each is labelled Live, Demo or Disabled."
      scope={[
        'Gmail and Microsoft 365 OAuth',
        'Booking website API / webhook',
        'TBO: manual/CSV adapter unless authorised API credentials are supplied',
        'Encrypted token storage (AES-256-GCM)',
      ]}
    />
  );
}
