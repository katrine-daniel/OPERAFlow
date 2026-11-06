import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { LoginInput } from '@operaflow/shared';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../common/auth-context';
import { SessionService } from './session.service';
import { dummyVerify, hashPassword, verifyPassword } from './password';

const GENERIC_FAILURE = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<{ token: string; userId: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (!user) {
      await dummyVerify(input.password);
      await this.audit.logSafe({ action: 'auth.login_failed', entityType: 'user', metadata: { reason: 'unknown_email' }, meta });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    if (!user.isActive || (user.lockedUntil && user.lockedUntil > new Date())) {
      await dummyVerify(input.password);
      await this.audit.logSafe({
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        metadata: { reason: user.isActive ? 'locked' : 'inactive' },
        meta,
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= env().LOGIN_MAX_FAILURES;
      await this.prisma.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + env().LOGIN_LOCKOUT_MINUTES * 60_000) }
          : { failedLoginCount: failures },
      });
      await this.audit.logSafe({
        action: lock ? 'auth.account_locked' : 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        metadata: { reason: 'bad_password', failures },
        meta,
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const token = await this.sessions.create(user.id, meta);
    await this.audit.log({ actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, meta });
    return { token, userId: user.id };
  }

  async logout(user: AuthUser, meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(user.sessionId);
    await this.audit.log({ actorId: user.id, action: 'auth.logout', entityType: 'user', entityId: user.id, meta });
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(record.passwordHash, currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (currentPassword === newPassword) throw new BadRequestException('New password must differ from the current one');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
      });
      await this.audit.log({ actorId: user.id, action: 'auth.password_changed', entityType: 'user', entityId: user.id, meta }, tx);
    });
    await this.sessions.revokeAllForUser(user.id, user.sessionId);
  }
}
