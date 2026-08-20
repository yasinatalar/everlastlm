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
  Query,
} from '@nestjs/common';
import {
  createNotebookSchema,
  updateNotebookSchema,
  uuidSchema,
  type CreateNotebookInput,
  type Notebook,
  type Page,
  type UpdateNotebookInput,
} from '@everlast/contracts';
import { z } from 'zod';
import { zodPipe } from '../../../shared/http/zod-validation.pipe';
import { RequiresNotebookRole } from '../../../shared/security/auth.decorators';
import { NotebookService } from '../application/notebook.service';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.iso.datetime().optional(),
  search: z.string().trim().max(120).optional(),
});

@Controller('notebooks')
export class NotebooksController {
  constructor(private readonly notebooks: NotebookService) {}

  @Get()
  async list(
    @Query(zodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Page<Notebook>> {
    return this.notebooks.list(query);
  }

  @Post()
  async create(
    @Body(zodPipe(createNotebookSchema)) body: CreateNotebookInput,
  ): Promise<Notebook> {
    return this.notebooks.create(body);
  }

  @Get(':notebookId')
  @RequiresNotebookRole('viewer')
  async get(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
  ): Promise<Notebook> {
    return this.notebooks.getById(notebookId);
  }

  @Patch(':notebookId')
  @RequiresNotebookRole('editor')
  async update(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Body(zodPipe(updateNotebookSchema)) body: UpdateNotebookInput,
  ): Promise<Notebook> {
    return this.notebooks.update(notebookId, body);
  }

  @Delete(':notebookId')
  @RequiresNotebookRole('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
  ): Promise<void> {
    await this.notebooks.archive(notebookId);
  }
}
