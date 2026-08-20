import { Module } from '@nestjs/common';
import { NoteService } from './application/note.service';
import { NoteRepository } from './domain/note.repository';
import { SupabaseNoteRepository } from './infrastructure/supabase-note.repository';
import { NotesController } from './presentation/notes.controller';

@Module({
  controllers: [NotesController],
  providers: [NoteService, { provide: NoteRepository, useClass: SupabaseNoteRepository }],
})
export class NotesModule {}
