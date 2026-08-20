import { Module } from '@nestjs/common';
import { MembershipService } from './application/membership.service';
import { NotebookService } from './application/notebook.service';
import { NotebookReadModel, NotebookRepository } from './domain/notebook.repository';
import {
  SupabaseNotebookReadModel,
  SupabaseNotebookRepository,
} from './infrastructure/supabase-notebook.repository';
import { MembersController } from './presentation/members.controller';
import { NotebooksController } from './presentation/notebooks.controller';

@Module({
  controllers: [NotebooksController, MembersController],
  providers: [
    NotebookService,
    MembershipService,
    { provide: NotebookRepository, useClass: SupabaseNotebookRepository },
    { provide: NotebookReadModel, useClass: SupabaseNotebookReadModel },
  ],
  exports: [NotebookService, NotebookReadModel],
})
export class NotebooksModule {}
