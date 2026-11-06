import { Injectable } from '@nestjs/common';
import type { CookieOptions } from 'express';
import type { Role } from '@operaflow/shared';
import { env } from '../config/env';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../common/auth-context';

export const SESSION_COOKIE = 'of_session';
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Server-side sessions. The browser holds an opaque random token in an httpOnly cookie;
 * the database stores only its SHA-256 hash, so a database leak does not leak live sessions.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: env().COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: env().SESSION_TTL_HOURS * 3600_000,
    };
  }

  async create(userId: string, meta: RequestMeta): Promise<string> {
    const token = CryptoService.randomToken(32);
    await this.prisma.session.create({
      data: {
        tokenHash: CryptoService.sha256(token),
        userId,
        expiresAt: new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
    return token;
  }

  async validate(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: CryptoService.sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || !session.user.isActive) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;
    if (now - session.lastSeenAt.getTime() > env().SESSION_IDLE_MINUTES * 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role as Role,
      sessionId: session.id,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId && { id: { not: exceptSessionId } }) },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }
}
