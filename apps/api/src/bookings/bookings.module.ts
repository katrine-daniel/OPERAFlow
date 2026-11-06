import { Module } from '@nestjs/common';
import { HotelsController } from '../directory/hotels.controller';
import { SourcesController } from '../directory/sources.controller';
import { SuppliersController } from '../directory/suppliers.controller';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { IngestService } from './ingest.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { StorageService } from './storage.service';
import { WebhookController } from './webhook.controller';

@Module({
  controllers: [
    SuppliersController,
    HotelsController,
    SourcesController,
    ImportController,
    ReconciliationController,
    WebhookController,
    BookingsController,
  ],
  providers: [BookingsService, IngestService, ImportService, ReconciliationService, StorageService],
  exports: [BookingsService, IngestService, ReconciliationService, StorageService],
})
export class BookingsModule {}
