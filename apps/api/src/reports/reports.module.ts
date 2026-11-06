import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { FollowupsModule } from '../followups/followups.module';
import { IntegrationsController } from '../integrations/integrations.controller';
import { DeliveryService } from './delivery.service';
import { RecipientsController } from './recipients.controller';
import { ReportDataService } from './report-data.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [BookingsModule, FollowupsModule],
  // RecipientsController first so /reports/recipients is not captured by other /reports routes.
  controllers: [RecipientsController, ReportsController, IntegrationsController],
  providers: [ReportDataService, ReportsService, DeliveryService],
  exports: [ReportsService, DeliveryService],
})
export class ReportsModule {}
