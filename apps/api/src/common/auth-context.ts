import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission, Role } from '@operaflow/shared';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  sessionId: string;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'operaflow:isPublic';
export const PERMISSIONS_KEY = 'operaflow:permissions';
export const SKIP_ORIGIN_CHECK = 'operaflow:skipOriginCheck';

/** Route is reachable without a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Every listed permission is required. Enforced by PermissionsGuard. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** For machine-to-machine endpoints (e.g. signed webhooks) that authenticate another way. */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 512) || null,
  };
}

export const ReqMeta = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMeta(ctx.switchToHttp().getRequest<Request>()),
);
