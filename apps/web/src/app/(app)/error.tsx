'use client';

import { Card, EmptyState, buttonClass } from '@/components/ui';

/** Unexpected server errors: no internals are shown; the digest lets support find the log line. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState title="Something went wrong">
        The page could not be loaded. Try again; if it keeps happening, report the reference below.
        {error.digest && <div className="mt-2 font-mono text-[11.5px]">Ref: {error.digest}</div>}
        <div className="mt-4">
          <button onClick={reset} className={buttonClass.secondary}>Try again</button>
        </div>
      </EmptyState>
    </Card>
  );
}
