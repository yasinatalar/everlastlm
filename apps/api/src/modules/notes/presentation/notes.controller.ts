import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createNoteSchema,
  updateNoteSchema,
  uuidSchema,
  type CreateNoteInput,
  type Note,
  type UpdateNoteInput,
} from '@everlast/contracts';
import { zodPipe } from '../../../shared/http/zod-validation.pipe';
import { RequiresNotebookRole } from '../../../shared/security/auth.decorators';
import { NoteService } from '../application/note.service';

@Controller('notebooks/:notebookId/notes')
export class NotesController {
  constructor(private readonly notes: NoteService) {}

  @Get()
  @RequiresNotebookRole('viewer')
  async list(@Param('notebookId', zodPipe(uuidSchema)) notebookId: string): Promise<Note[]> {
    return this.notes.list(notebookId);
  }

  @Post()
  @RequiresNotebookRole('editor')
  async create(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Body(zodPipe(createNoteSchema)) body: CreateNoteInput,
  ): Promise<Note> {
    return this.notes.create(notebookId, body);
  }

  @Patch(':noteId')
  @RequiresNotebookRole('editor')
  async update(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('noteId', zodPipe(uuidSchema)) noteId: string,
    @Body(zodPipe(updateNoteSchema)) body: UpdateNoteInput,
  ): Promise<Note> {
    return this.notes.update(notebookId, noteId, body);
  }

  @Delete(':noteId')
  @RequiresNotebookRole('editor')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('noteId', zodPipe(uuidSchema)) noteId: string,
  ): Promise<void> {
    await this.notes.remove(notebookId, noteId);
  }
}
