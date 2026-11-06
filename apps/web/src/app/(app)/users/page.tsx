import type { Metadata } from 'next';
import { ROLE_LABELS, type Role } from '@operaflow/shared';
import { apiGet, getMe } from '@/lib/api';
import { Badge, Card, PageHeader, Table, Td, formatDateTime } from '@/components/ui';
import { CreateUserForm } from './create-user-form';
import { UserRowActions } from './user-row-actions';

export const metadata: Metadata = { title: 'Users & roles' };

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

export default async function UsersPage() {
  const [me, users] = await Promise.all([getMe(), apiGet<UserRow[]>('/users')]);
  const canManage = me.permissions.includes('users:manage');

  return (
    <>
      <PageHeader title="Users & roles" description="Accounts are issued by administrators. Role and access changes sign the user out immediately." />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card title={`${users.length} accounts`}>
          <Table head={['Name', 'Email', 'Role', 'Status', 'Last sign-in', ...(canManage ? [''] : [])]}>
            {users.map((u) => {
              const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
              return (
                <tr key={u.id} className={u.isActive ? '' : 'opacity-60'}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td className="text-ink-3">{u.email}</Td>
                  <Td>{ROLE_LABELS[u.role]}</Td>
                  <Td>
                    {!u.isActive ? <Badge>Deactivated</Badge> : locked ? <Badge tone="warn">Locked</Badge> : <Badge tone="ok">Active</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-3">{formatDateTime(u.lastLoginAt)}</Td>
                  {canManage && (
                    <Td className="text-right">
                      {u.id !== me.id && <UserRowActions id={u.id} role={u.role} isActive={u.isActive} />}
                    </Td>
                  )}
                </tr>
              );
            })}
          </Table>
        </Card>
        {canManage && (
          <Card title="Add user">
            <CreateUserForm />
          </Card>
        )}
      </div>
    </>
  );
}
