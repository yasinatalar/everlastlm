import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  generateStudioArtifactSchema,
  uuidSchema,
  type GenerateStudioArtifactInput,
  type StudioArtifact,
} from '@everlast/contracts';
import { zodPipe } from '../../../shared/http/zod-validation.pipe';
import { RequiresNotebookRole } from '../../../shared/security/auth.decorators';
import { AiRateLimited } from '../../../shared/security/throttling';
import { StudioService } from '../application/studio.service';

@Controller('notebooks/:notebookId/studio')
export class StudioController {
  constructor(private readonly studio: StudioService) {}

  @Get()
  @RequiresNotebookRole('viewer')
  async list(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
  ): Promise<StudioArtifact[]> {
    return this.studio.list(notebookId);
  }

  @Get(':artifactId')
  @RequiresNotebookRole('viewer')
  async get(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('artifactId', zodPipe(uuidSchema)) artifactId: string,
  ): Promise<StudioArtifact> {
    return this.studio.getById(notebookId, artifactId);
  }

  @Post()
  @RequiresNotebookRole('editor')
  @AiRateLimited()
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Body(zodPipe(generateStudioArtifactSchema)) body: GenerateStudioArtifactInput,
  ): Promise<StudioArtifact> {
    return this.studio.generate(notebookId, body);
  }

  @Delete(':artifactId')
  @RequiresNotebookRole('editor')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('artifactId', zodPipe(uuidSchema)) artifactId: string,
  ): Promise<void> {
    await this.studio.remove(notebookId, artifactId);
  }
}
