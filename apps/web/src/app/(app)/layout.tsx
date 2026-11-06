import { getMe } from '@/lib/api';
import { Sidebar } from '@/components/shell/sidebar';
import { UserMenu } from '@/components/shell/user-menu';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe(); // redirects to /login when the session is missing or expired

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar permissions={me.permissions} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 lg:px-6">
          <div className="pl-10 text-[12.5px] text-ink-3 lg:pl-0">
            Environment:{' '}
            <span className="font-medium text-ink-2">{process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}</span>
          </div>
          <UserMenu name={me.name} email={me.email} role={me.role} />
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-6">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
