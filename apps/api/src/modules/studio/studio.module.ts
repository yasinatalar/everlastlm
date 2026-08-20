import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module';
import { StudioService } from './application/studio.service';
import { StudioAudioStoragePort, StudioRepository } from './domain/studio.repository';
import {
  SupabaseStudioAudioStorage,
  SupabaseStudioRepository,
} from './infrastructure/supabase-studio.repository';
import { StudioController } from './presentation/studio.controller';

@Module({
  imports: [SourcesModule],
  controllers: [StudioController],
  providers: [
    StudioService,
    { provide: StudioAudioStoragePort, useClass: SupabaseStudioAudioStorage },
    { provide: StudioRepository, useClass: SupabaseStudioRepository },
  ],
})
export class StudioModule {}
