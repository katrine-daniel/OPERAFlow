'use client';

import { buttonClass } from '@/components/ui';

/**
 * Starts the OAuth authorisation-code flow for a company mailbox. The browser goes to the provider's own
 * consent page; OPERAFlow never sees the mailbox password.
 */
export function MailboxConnect({ google, microsoft }: { google: boolean; microsoft: boolean }) {
  return (
    <div className="space-y-3 p-4 text-[13px]">
      <p className="text-ink-3">Connect the mailbox that sends quotation and rate requests. You will sign in on Google or Microsoft and approve read/draft/send access.</p>
      <div className="flex flex-col gap-2">
        <a aria-disabled={!google} href={google ? '/api/integrations/oauth/google/start' : undefined} className={`${buttonClass.secondary} ${google ? '' : 'pointer-events-none opacity-50'}`}>
          Connect Gmail / Google Workspace
        </a>
        <a aria-disabled={!microsoft} href={microsoft ? '/api/integrations/oauth/microsoft/start' : undefined} className={`${buttonClass.secondary} ${microsoft ? '' : 'pointer-events-none opacity-50'}`}>
          Connect Microsoft 365
        </a>
      </div>
      {!google && !microsoft && <p className="text-warn">No OAuth app is configured yet, so mailbox connection is unavailable.</p>}
    </div>
  );
}
