import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ISSUE_TYPES, resolveIssueSchema } from '@operaflow/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ReconciliationService } from './reconciliation.service';

const listQuery = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional(),
  type: z.enum(ISSUE_TYPES).optional(),
});

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly recon: ReconciliationService) {}

  @Post('run')
  @HttpCode(200)
  @RequirePermissions('bookings:reconcile')
  run(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.recon.run(user, meta);
  }

  @Get('issues')
  @RequirePermissions('bookings:read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.recon.list(q.status, q.type);
  }

  @Post('issues/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('bookings:reconcile')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resolveIssueSchema)) body: z.infer<typeof resolveIssueSchema>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.recon.resolve(id, body.status, body.note, user, meta);
  }
}
