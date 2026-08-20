import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { NotebookAccessGuard } from './notebook-access.guard';
import { NotebookAccessService } from './notebook-access.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { SupabaseTokenVerifier } from './supabase-token.verifier';

@Global()
@Module({
  providers: [
    SupabaseTokenVerifier,
    SupabaseAuthGuard,
    NotebookAccessService,
    NotebookAccessGuard,
    AuditService,
  ],
  exports: [
    SupabaseTokenVerifier,
    SupabaseAuthGuard,
    NotebookAccessService,
    NotebookAccessGuard,
    AuditService,
  ],
})
export class SecurityModule {}
