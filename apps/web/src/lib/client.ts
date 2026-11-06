'use client';

export interface ApiIssue {
  path: string;
  message: string;
}

export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: ApiIssue[] = [],
    /** Full error body, e.g. { code: 'DUPLICATE_SUSPECTED', duplicates: [...] }. */
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface DuplicateInfo {
  id: string;
  internalRef: string;
  externalRef: string | null;
  channel: string;
  status: string;
  source: { name: string };
}

/** Browser-side GET through the /api proxy. */
export async function apiFetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ClientApiError(res.status, data.message ?? `Request failed (${res.status})`, [], data as Record<string, unknown>);
  return data as T;
}

/** Multipart upload through the /api proxy (browser sets the boundary). */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', body: form });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[]; issues?: ApiIssue[] };
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new ClientApiError(res.status, msg ?? `Upload failed (${res.status})`, data.issues ?? [], data);
  }
  return data as T;
}

/** Browser-side call through the same-origin /api proxy. The browser attaches Origin and the session cookie. */
export async function apiSend<T = unknown>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[]; issues?: ApiIssue[] };
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new ClientApiError(res.status, msg ?? `Request failed (${res.status})`, data.issues ?? [], data);
  }
  return data as T;
}
