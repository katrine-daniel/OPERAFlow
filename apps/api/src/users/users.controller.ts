import { BadRequestException, Body, Controller, ConflictException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Prisma } from '@operaflow/db';
import { createUserSchema, passwordSchema, updateUserSchema, type CreateUserInput, type UpdateUserInput } from '@operaflow/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { hashPassword } from '../auth/password';

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const resetPasswordSchema = z.object({ password: passwordSchema });

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  @RequirePermissions('users:read')
  list() {
    return this.prisma.user.findMany({ select: publicUserSelect, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  /** Lightweight list for assignment dropdowns. */
  @Get('assignable')
  @RequirePermissions('bookings:read')
  assignable() {
    return this.prisma.user.findMany({
      where: { isActive: true, role: { in: ['ADMIN', 'OPS_MANAGER', 'OPS_STAFF'] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @RequirePermissions('users:manage')
  async create(@Body(new ZodPipe(createUserSchema)) body: CreateUserInput, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    const passwordHash = await hashPassword(body.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: body.email, name: body.name, role: body.role, passwordHash },
          select: publicUserSelect,
        });
        await this.audit.log(
          { actorId: actor.id, action: 'user.created', entityType: 'user', entityId: user.id, metadata: { email: user.email, role: user.role }, meta },
          tx,
        );
        return user;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }
  }

  @Patch(':id')
  @RequirePermissions('users:manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
    if (!before) throw new NotFoundException();
    if (id === actor.id && (body.isActive === false || (body.role && body.role !== 'ADMIN'))) {
      throw new BadRequestException('You cannot deactivate or demote your own account');
    }
    if (before.role === 'ADMIN' && (body.isActive === false || (body.role && body.role !== 'ADMIN'))) {
      const otherAdmins = await this.prisma.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: id } } });
      if (otherAdmins === 0) throw new BadRequestException('At least one active administrator is required');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data: body, select: publicUserSelect });
      const changes = Object.fromEntries(
        (Object.keys(body) as (keyof UpdateUserInput)[]).map((k) => [k, { from: before[k], to: user[k] }]),
      );
      await this.audit.log({ actorId: actor.id, action: 'user.updated', entityType: 'user', entityId: id, metadata: { changes }, meta }, tx);
      return user;
    });

    // Role or access changes take effect immediately.
    if (body.isActive === false || (body.role && body.role !== before.role)) {
      await this.sessions.revokeAllForUser(id);
    }
    return updated;
  }

  @Post(':id/reset-password')
  @RequirePermissions('users:manage')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const passwordHash = await hashPassword(body.password);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.user.updateMany({
        where: { id },
        data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });
      if (res.count === 0) throw new NotFoundException();
      await this.audit.log({ actorId: actor.id, action: 'user.password_reset', entityType: 'user', entityId: id, meta }, tx);
    });
    await this.sessions.revokeAllForUser(id);
    return { ok: true };
  }
}
