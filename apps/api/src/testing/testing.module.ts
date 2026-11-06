import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { RunnerService } from './runner.service';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';

@Module({
  imports: [BookingsModule],
  controllers: [TestingController],
  providers: [RunnerService, TestingService],
  exports: [RunnerService, TestingService],
})
export class TestingModule {}
