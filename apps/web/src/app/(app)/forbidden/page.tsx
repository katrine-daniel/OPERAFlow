import Link from 'next/link';
import { Card, EmptyState, buttonClass } from '@/components/ui';

export const metadata = { title: 'No access' };

export default function ForbiddenPage() {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState title="You don't have access to that page">
        Your role does not include this area. Ask an administrator if you need it.
        <div className="mt-4">
          <Link href="/" className={buttonClass.secondary}>Back to dashboard</Link>
        </div>
      </EmptyState>
    </Card>
  );
}
