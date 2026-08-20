import { Module } from '@nestjs/common';
import { IngestionService } from './application/ingestion.service';
import { SourceService } from './application/source.service';
import { SourceRepository, SourceStoragePort } from './domain/source.repository';
import { TextExtractionPort } from './domain/text-extraction.port';
import { SupabaseSourceStorageAdapter } from './infrastructure/supabase-source-storage.adapter';
import { SupabaseSourceRepository } from './infrastructure/supabase-source.repository';
import { TextExtractionAdapter } from './infrastructure/text-extraction.adapter';
import { SourcesController } from './presentation/sources.controller';

@Module({
  controllers: [SourcesController],
  providers: [
    SourceService,
    IngestionService,
    { provide: SourceRepository, useClass: SupabaseSourceRepository },
    { provide: SourceStoragePort, useClass: SupabaseSourceStorageAdapter },
    { provide: TextExtractionPort, useClass: TextExtractionAdapter },
  ],
  exports: [SourceRepository, SourceService],
})
export class SourcesModule {}
