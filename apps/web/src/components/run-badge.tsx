import { StatusBadge } from './ui';

const RUN_TONE: Record<string, string> = { PASSED: 'CONFIRMED', FAILED: 'FAILED', ERROR: 'FAILED', BLOCKED_SAFETY: 'PENDING', RUNNING: 'READY', QUEUED: 'READY', CANCELLED: 'CANCELLED' };

export function RunBadge({ status }: { status: string }) {
  return <StatusBadge value={RUN_TONE[status] ?? status} label={status === 'BLOCKED_SAFETY' ? 'Blocked (safety)' : status.toLowerCase()} />;
}
