import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Permission, Role } from '@operaflow/shared';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side fetch to the API, forwarding the user's session cookie. Redirects to /login on 401. */
export async function apiGet<T>(path: string): Promise<T> {
  const jar = await cookies();
  const session = jar.get('of_session')?.value;
  const res = await fetch(`${API_URL}${path}`, {
    headers: session ? { cookie: `of_session=${session}` } : {},
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
}

export const getMe = () => apiGet<Me>('/auth/me');
