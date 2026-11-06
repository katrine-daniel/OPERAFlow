import type { Metadata } from 'next';
import { ROLE_LABELS } from '@operaflow/shared';
import { getMe } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const me = await getMe();
  return (
    <>
      <PageHeader title="My account" description={`${me.name} · ${me.email} · ${ROLE_LABELS[me.role]}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Change password">
          <ChangePasswordForm />
        </Card>
        <Card title="What you can do">
          <ul className="grid grid-cols-1 gap-1 px-4 py-3 font-mono text-[12px] text-ink-2 sm:grid-cols-2">
            {me.permissions.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
