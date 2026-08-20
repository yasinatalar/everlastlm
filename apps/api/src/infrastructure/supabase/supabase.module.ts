import { Global, Module } from '@nestjs/common';
import { RequestContextService } from '../../shared/context/request-context';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [RequestContextService, SupabaseService],
  exports: [RequestContextService, SupabaseService],
})
export class SupabaseModule {}
