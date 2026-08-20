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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_UPLOAD_BYTES,
  addTextSourceSchema,
  addUrlSourceSchema,
  renameSourceSchema,
  uuidSchema,
  type AddTextSourceInput,
  type AddUrlSourceInput,
  type RenameSourceInput,
  type Source,
} from '@everlast/contracts';
import { InvariantViolationError } from '../../../shared/kernel/domain-error';
import { zodPipe } from '../../../shared/http/zod-validation.pipe';
import { RequiresNotebookRole } from '../../../shared/security/auth.decorators';
import { AiRateLimited } from '../../../shared/security/throttling';
import { SourceService, type UploadedFile as UploadedFileModel } from '../application/source.service';

@Controller('notebooks/:notebookId/sources')
export class SourcesController {
  constructor(private readonly sources: SourceService) {}

  @Get()
  @RequiresNotebookRole('viewer')
  async list(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
  ): Promise<Source[]> {
    return this.sources.list(notebookId);
  }

  @Get(':sourceId')
  @RequiresNotebookRole('viewer')
  async get(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('sourceId', zodPipe(uuidSchema)) sourceId: string,
  ): Promise<Source> {
    return this.sources.getById(notebookId, sourceId);
  }

  @Post('upload')
  @RequiresNotebookRole('editor')
  @AiRateLimited()
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage keeps the bytes off disk entirely — nothing to clean up
      // and no window where a partially-validated upload sits on the filesystem.
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
    }),
  )
  async upload(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @UploadedFile() file: UploadedFileModel | undefined,
  ): Promise<Source> {
    if (!file) {
      throw new InvariantViolationError('source.no_file', 'no file was uploaded');
    }
    return this.sources.addUpload(notebookId, file);
  }

  @Post('url')
  @RequiresNotebookRole('editor')
  @AiRateLimited()
  async addUrl(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Body(zodPipe(addUrlSourceSchema)) body: AddUrlSourceInput,
  ): Promise<Source> {
    return this.sources.addUrl(notebookId, body);
  }

  @Post('text')
  @RequiresNotebookRole('editor')
  @AiRateLimited()
  async addText(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Body(zodPipe(addTextSourceSchema)) body: AddTextSourceInput,
  ): Promise<Source> {
    return this.sources.addText(notebookId, body);
  }

  @Patch(':sourceId')
  @RequiresNotebookRole('editor')
  async rename(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('sourceId', zodPipe(uuidSchema)) sourceId: string,
    @Body(zodPipe(renameSourceSchema)) body: RenameSourceInput,
  ): Promise<Source> {
    return this.sources.rename(notebookId, sourceId, body.title);
  }

  @Post(':sourceId/retry')
  @RequiresNotebookRole('editor')
  @AiRateLimited()
  async retry(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('sourceId', zodPipe(uuidSchema)) sourceId: string,
  ): Promise<Source> {
    return this.sources.retry(notebookId, sourceId);
  }

  /** Short-lived signed URL so the browser can open the original document. */
  @Get(':sourceId/download')
  @RequiresNotebookRole('viewer')
  async download(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('sourceId', zodPipe(uuidSchema)) sourceId: string,
  ): Promise<{ url: string }> {
    return { url: await this.sources.downloadUrl(notebookId, sourceId) };
  }

  @Delete(':sourceId')
  @RequiresNotebookRole('editor')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('sourceId', zodPipe(uuidSchema)) sourceId: string,
  ): Promise<void> {
    await this.sources.remove(notebookId, sourceId);
  }
}
