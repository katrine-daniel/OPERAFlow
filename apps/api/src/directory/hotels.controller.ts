import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { hotelSchema } from '@operaflow/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { isUniqueViolation } from '../common/prisma-errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const listQuery = z.object({ q: z.string().trim().max(100).optional() });
const updateSchema = hotelSchema.partial().refine((v) => Object.keys(v).length > 0, 'No changes supplied');

@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('bookings:read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.prisma.hotel.findMany({
      where: q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { city: { contains: q.q, mode: 'insensitive' } }] } : {},
      orderBy: [{ name: 'asc' }, { city: 'asc' }],
      take: 500,
      include: { _count: { select: { bookings: true } } },
    });
  }

  /** Staff may add a hotel while entering a booking. */
  @Post()
  @RequirePermissions('bookings:write')
  async create(@Body(new ZodPipe(hotelSchema)) body: z.infer<typeof hotelSchema>, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const h = await tx.hotel.create({ data: body });
        await this.audit.log({ actorId: actor.id, action: 'hotel.created', entityType: 'hotel', entityId: h.id, metadata: { name: h.name, city: h.city }, meta }, tx);
        return h;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This hotel already exists in that city');
      throw err;
    }
  }

  @Patch(':id')
  @RequirePermissions('suppliers:manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await tx.hotel.count({ where: { id } }))) throw new NotFoundException();
        const h = await tx.hotel.update({ where: { id }, data: body });
        await this.audit.log({ actorId: actor.id, action: 'hotel.updated', entityType: 'hotel', entityId: id, metadata: { fields: Object.keys(body) }, meta }, tx);
        return h;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This hotel already exists in that city');
      throw err;
    }
  }
}
