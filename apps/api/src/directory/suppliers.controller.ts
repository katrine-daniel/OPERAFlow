import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { isValidTimeZone, supplierContactSchema, supplierSchema } from '@operaflow/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { isUniqueViolation } from '../common/prisma-errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const listQuery = z.object({ q: z.string().trim().max(100).optional(), includeInactive: z.enum(['true', 'false']).optional() });
// No defaults on update (zod 4 applies .default() even inside .partial(), which would reset omitted fields).
const updateSchema = supplierSchema
  .extend({ timezone: z.string().trim().refine(isValidTimeZone, 'Unknown IANA timezone') })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No changes supplied');

@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('suppliers:read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.prisma.supplier.findMany({
      where: {
        ...(q.includeInactive !== 'true' && { isActive: true }),
        ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] }),
      },
      orderBy: { name: 'asc' },
      include: { contacts: { orderBy: [{ isPrimary: 'desc' }, { email: 'asc' }] }, _count: { select: { bookings: true } } },
    });
  }

  @Get(':id')
  @RequirePermissions('suppliers:read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const s = await this.prisma.supplier.findUnique({
      where: { id },
      include: { contacts: { orderBy: [{ isPrimary: 'desc' }, { email: 'asc' }] }, _count: { select: { bookings: true } } },
    });
    if (!s) throw new NotFoundException();
    return s;
  }

  @Post()
  @RequirePermissions('suppliers:manage')
  async create(@Body(new ZodPipe(supplierSchema)) body: z.infer<typeof supplierSchema>, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const s = await tx.supplier.create({ data: body });
        await this.audit.log({ actorId: actor.id, action: 'supplier.created', entityType: 'supplier', entityId: s.id, metadata: { code: s.code }, meta }, tx);
        return s;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A supplier with this code already exists');
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
        const before = await tx.supplier.findUnique({ where: { id } });
        if (!before) throw new NotFoundException();
        const s = await tx.supplier.update({ where: { id }, data: body });
        const changes = Object.fromEntries(Object.keys(body).map((k) => [k, { from: before[k as keyof typeof before], to: s[k as keyof typeof s] }]));
        await this.audit.log({ actorId: actor.id, action: 'supplier.updated', entityType: 'supplier', entityId: id, metadata: { changes }, meta }, tx);
        return s;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A supplier with this code already exists');
      throw err;
    }
  }

  @Post(':id/contacts')
  @RequirePermissions('suppliers:manage')
  async addContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(supplierContactSchema)) body: z.infer<typeof supplierContactSchema>,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await tx.supplier.count({ where: { id } }))) throw new NotFoundException();
        if (body.isPrimary) await tx.supplierContact.updateMany({ where: { supplierId: id }, data: { isPrimary: false } });
        const c = await tx.supplierContact.create({ data: { ...body, supplierId: id } });
        await this.audit.log(
          { actorId: actor.id, action: 'supplier.contact_added', entityType: 'supplier', entityId: id, metadata: { email: c.email }, meta },
          tx,
        );
        return c;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This contact already exists for the supplier');
      throw err;
    }
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions('suppliers:manage')
  async removeContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.supplierContact.findFirst({ where: { id: contactId, supplierId: id } });
      if (!c) throw new NotFoundException();
      await tx.supplierContact.delete({ where: { id: contactId } });
      await this.audit.log(
        { actorId: actor.id, action: 'supplier.contact_removed', entityType: 'supplier', entityId: id, metadata: { email: c.email }, meta },
        tx,
      );
    });
    return { ok: true };
  }
}
