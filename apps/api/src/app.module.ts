import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { env } from './config/env';
import { PrismaModule } from './prisma/prisma.service';
import { CryptoModule } from './common/crypto.service';
import { OriginGuard, PermissionsGuard, SessionAuthGuard } from './common/guards';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { ReportsModule } from './reports/reports.module';
import { FollowupsModule } from './followups/followups.module';
import { TestingModule } from './testing/testing.module';
import { OpsModule } from './ops/ops.module';
import { ErrorFilter, RequestContextMiddleware } from './ops/observability';
import { UsersController } from './users/users.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: env().RATE_LIMIT_PER_MINUTE }]),
    PrismaModule,
    CryptoModule,
    AuditModule,
    AuthModule,
    BookingsModule,
    ReportsModule,
    FollowupsModule,
    TestingModule,
    OpsModule,
  ],
  controllers: [UsersController, DashboardController, HealthController],
  providers: [
    // Order matters: rate limit → CSRF origin check → authenticate → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '*splat', method: RequestMethod.ALL });
  }
}
