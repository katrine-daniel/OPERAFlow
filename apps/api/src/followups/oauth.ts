import { env } from '../config/env';

export type MailProvider = 'google' | 'microsoft';

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify'];
export const MICROSOFT_SCOPES = ['openid', 'email', 'offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'];

export function oauthConfigured(p: MailProvider): boolean {
  const e = env();
  return p === 'google' ? Boolean(e.GOOGLE_OAUTH_CLIENT_ID && e.GOOGLE_OAUTH_CLIENT_SECRET) : Boolean(e.MS_OAUTH_TENANT_ID && e.MS_OAUTH_CLIENT_ID && e.MS_OAUTH_CLIENT_SECRET);
}

export function redirectUri(p: MailProvider) {
  return `${env().APP_BASE_URL.replace(/\/$/, '')}/api/integrations/oauth/${p}/callback`;
}

export function authorizeUrl(p: MailProvider, state: string, codeChallenge: string): string {
  const e = env();
  const common = { response_type: 'code', redirect_uri: redirectUri(p), state, code_challenge: codeChallenge, code_challenge_method: 'S256' };
  if (p === 'google') {
    const q = new URLSearchParams({ ...common, client_id: e.GOOGLE_OAUTH_CLIENT_ID!, scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({ ...common, client_id: e.MS_OAUTH_CLIENT_ID!, scope: MICROSOFT_SCOPES.join(' '), response_mode: 'query', prompt: 'select_account' });
  return `https://login.microsoftonline.com/${encodeURIComponent(e.MS_OAUTH_TENANT_ID!)}/oauth2/v2.0/authorize?${q}`;
}

export function tokenEndpoint(p: MailProvider) {
  return p === 'google' ? 'https://oauth2.googleapis.com/token' : `https://login.microsoftonline.com/${encodeURIComponent(env().MS_OAUTH_TENANT_ID!)}/oauth2/v2.0/token`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

async function postToken(p: MailProvider, params: Record<string, string>): Promise<TokenResponse> {
  const e = env();
  const body = new URLSearchParams({
    ...params,
    client_id: p === 'google' ? e.GOOGLE_OAUTH_CLIENT_ID! : e.MS_OAUTH_CLIENT_ID!,
    client_secret: p === 'google' ? e.GOOGLE_OAUTH_CLIENT_SECRET! : e.MS_OAUTH_CLIENT_SECRET!,
    ...(p === 'microsoft' && { scope: MICROSOFT_SCOPES.join(' ') }),
  });
  const res = await fetch(tokenEndpoint(p), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Token request failed: ${json.error ?? res.status} ${json.error_description ?? ''}`.trim());
  return json;
}

export const exchangeCode = (p: MailProvider, code: string, codeVerifier: string) =>
  postToken(p, { grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri(p) });

export const refreshAccessToken = (p: MailProvider, refreshToken: string) => postToken(p, { grant_type: 'refresh_token', refresh_token: refreshToken });

/** The mailbox address the user actually authorised (never trusted from the client). */
export async function fetchMailboxAddress(p: MailProvider, accessToken: string): Promise<string> {
  const url = p === 'google' ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile' : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName';
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Could not read mailbox profile (${res.status})`);
  const j = (await res.json()) as { emailAddress?: string; mail?: string; userPrincipalName?: string };
  const address = (p === 'google' ? j.emailAddress : j.mail ?? j.userPrincipalName)?.toLowerCase();
  if (!address) throw new Error('Mailbox address not returned by provider');
  return address;
}
