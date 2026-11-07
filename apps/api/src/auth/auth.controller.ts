import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { changePasswordSchema, loginSchema, ROLE_PERMISSIONS, type LoginInput } from '@operaflow/shared';
import type { z } from 'zod';
import { env } from '../config/env';
import { AuthUser, CurrentUser, Public, ReqMeta, RequestMeta } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: env().LOGIN_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } })
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token } = await this.auth.login(body, meta);
    res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions());
    return { ok: true };
  }

  /**
   * Local-only automatic sign-in (AUTO_LOGIN_EMAIL). Works only outside production and only for a browser
   * on this same machine (loopback address, resolved through the trusted local proxy). Audited like a login.
   */
  @Public()
  @Post('auto-login')
  @HttpCode(200)
  async autoLogin(@ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const email = env().AUTO_LOGIN_EMAIL;
    if (!email || env().NODE_ENV === 'production') throw new NotFoundException();
    const ip = (meta.ipAddress ?? '').replace(/^::ffff:/, '');
    if (ip !== '127.0.0.1' && ip !== '::1') throw new ForbiddenException('Automatic sign-in only works on this computer');
    const { token } = await this.auth.autoLogin(email, meta);
    res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions());
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, meta);
    const { maxAge: _maxAge, ...opts } = this.sessions.cookieOptions();
    res.clearCookie(SESSION_COOKIE, opts);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role],
    };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, meta);
    return { ok: true };
  }
}
