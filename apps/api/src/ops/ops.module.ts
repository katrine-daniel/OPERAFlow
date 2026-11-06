import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { OpsController } from './ops.controller';
import { RetentionService } from './retention.service';

@Module({
  imports: [BookingsModule],
  controllers: [OpsController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class OpsModule {}
