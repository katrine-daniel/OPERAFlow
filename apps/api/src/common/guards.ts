import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAllPermissions, type Permission } from '@operaflow/shared';
import { env } from '../config/env';
import { SessionService, SESSION_COOKIE } from '../auth/session.service';
import { AuthedRequest, IS_PUBLIC, PERMISSIONS_KEY, SKIP_ORIGIN_CHECK } from './auth-context';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence: state-changing requests must carry an Origin (or Referer) header
 * matching an allowed web origin. Combined with SameSite=Lax httpOnly cookies.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_CHECK, [ctx.getHandler(), ctx.getClass()])) return true;

    const allowed = env().WEB_ORIGINS;
    const origin = req.headers.origin;
    if (origin) {
      if (allowed.includes(origin.replace(/\/$/, ''))) return true;
      throw new ForbiddenException('Request origin not allowed');
    }
    const referer = req.headers.referer;
    if (referer && allowed.some((o) => referer === o || referer.startsWith(`${o}/`))) return true;
    throw new ForbiddenException('Missing request origin');
  }
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException('Not signed in');
    const user = await this.sessions.validate(token);
    if (!user) throw new UnauthorizedException('Session expired');
    req.user = user;
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new UnauthorizedException();
    if (!hasAllPermissions(req.user.role, required)) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
