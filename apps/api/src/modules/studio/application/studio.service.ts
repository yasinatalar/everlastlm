import { Injectable, Logger } from '@nestjs/common';
import type {
  GenerateStudioArtifactInput,
  StudioArtifact,
  StudioContent,
} from '@everlast/contracts';
import { sanitiseForPrompt, sanitiseTitleForPrompt } from '../../../infrastructure/llm/prompt-safety';
import {
  DomainError,
  InvariantViolationError,
  NotFoundError,
} from '../../../shared/kernel/domain-error';
import { BackgroundTasksPort } from '../../../shared/ports/background-tasks.port';
import { SpeechSynthesisPort } from '../../../shared/ports/speech.port';
import { TextGenerationPort } from '../../../shared/ports/text-generation.port';
import { AuditService } from '../../../shared/security/audit.service';
import { SourceRepository } from '../../sources/domain/source.repository';
import { StudioAudioStoragePort, StudioRepository } from '../domain/studio.repository';
import { STUDIO_RECIPES } from './studio-prompts';

/** Chunks pulled per source, and the overall character budget for the prompt. */
const CHUNKS_PER_SOURCE = 24;
const MAX_PROMPT_CHARS = 200_000;

@Injectable()
export class StudioService {
  private readonly logger = new Logger(StudioService.name);

  constructor(
    private readonly studio: StudioRepository,
    private readonly sources: SourceRepository,
    private readonly generation: TextGenerationPort,
    private readonly speech: SpeechSynthesisPort,
    private readonly audioStorage: StudioAudioStoragePort,
    private readonly audit: AuditService,
    private readonly background: BackgroundTasksPort,
  ) {}

  async list(notebookId: string): Promise<StudioArtifact[]> {
    return this.studio.listByNotebook(notebookId);
  }

  async getById(notebookId: string, artifactId: string): Promise<StudioArtifact> {
    const artifact = await this.studio.findById(notebookId, artifactId);
    if (!artifact) throw new NotFoundError('studio_artifact', artifactId);
    return artifact;
  }

  async remove(notebookId: string, artifactId: string): Promise<void> {
    await this.getById(notebookId, artifactId);
    await this.studio.delete(artifactId);
  }

  /**
   * Creates the artifact row immediately and generates in the background, so
   * the UI can show a placeholder card rather than blocking on a call that can
   * take a minute for an audio overview.
   */
  async generate(
    notebookId: string,
    input: GenerateStudioArtifactInput,
  ): Promise<StudioArtifact> {
    const available = (await this.sources.listByNotebook(notebookId)).filter(
      (source) => source.status === 'ready',
    );

    if (available.length === 0) {
      throw new InvariantViolationError(
        'studio.no_ready_sources',
        'add at least one processed source before generating',
      );
    }

    const selected = input.sourceIds?.length
      ? available.filter((source) => input.sourceIds?.includes(source.id))
      : available;

    if (selected.length === 0) {
      throw new InvariantViolationError(
        'studio.no_matching_sources',
        'none of the selected sources are ready yet',
      );
    }

    const recipe = STUDIO_RECIPES[input.kind];
    const artifact = await this.studio.create({
      notebookId,
      kind: input.kind,
      title: recipe.defaultTitle.en,
      sourceIds: selected.map((source) => source.id),
    });

    await this.audit.record({
      action: 'studio.generation_started',
      notebookId,
      targetType: 'studio_artifact',
      targetId: artifact.id,
      metadata: { kind: input.kind, sources: selected.length },
    });

    this.background.run(`studio:${artifact.id}`, () =>
      this.run(notebookId, artifact.id, input),
    );

    return artifact;
  }

  private async run(
    notebookId: string,
    artifactId: string,
    input: GenerateStudioArtifactInput,
  ): Promise<void> {
    const recipe = STUDIO_RECIPES[input.kind];

    try {
      await this.studio.markGenerating(artifactId);

      const artifact = await this.studio.findById(notebookId, artifactId);
      const sourceIds = artifact?.sourceIds ?? [];
      const corpus = await this.buildCorpus(notebookId, sourceIds);

      const focus = input.focus?.trim()
        ? `\n\nThe reader asked you to focus on: ${sanitiseForPrompt(input.focus)}`
        : '';

      const content = (await this.generation.generateObject(
        recipe.system,
        `${corpus}${focus}`,
        recipe.schema,
        { maxTokens: recipe.maxTokens, cacheSystemPrompt: true },
      )) as StudioContent;

      if (content.kind === 'audio_overview') {
        await this.finishAudio(notebookId, artifactId, content);
        return;
      }

      await this.studio.markReady(artifactId, content);
    } catch (error) {
      const reason =
        error instanceof DomainError ? error.message : 'generation failed, please try again';
      this.logger.error({ err: error, artifactId }, 'studio generation failed');
      await this.studio.markFailed(artifactId, reason).catch(() => undefined);
    }
  }

  /**
   * Synthesis is optional. With no TTS vendor configured the script is still a
   * useful artifact, so the artifact is stored ready-without-audio rather than
   * failed — a missing integration is not a user error.
   */
  private async finishAudio(
    notebookId: string,
    artifactId: string,
    content: StudioContent & { kind: 'audio_overview' },
  ): Promise<void> {
    if (!this.speech.available) {
      this.logger.log('no TTS provider configured; storing audio overview as script only');
      await this.studio.markReady(artifactId, content);
      return;
    }

    try {
      const result = await this.speech.synthesiseDialogue(content.turns);
      const storagePath = await this.audioStorage.upload(
        notebookId,
        artifactId,
        result.audio,
        result.mimeType,
      );
      await this.studio.markReady(artifactId, content, {
        storagePath,
        durationSeconds: result.durationSeconds,
      });
    } catch (error) {
      this.logger.error({ err: error, artifactId }, 'speech synthesis failed');
      // Keep the script; the user can read it and retry the audio.
      await this.studio.markReady(artifactId, content);
    }
  }

  /**
   * Assembles the prompt corpus from the leading chunks of each source. Leading
   * chunks are used rather than retrieval because studio outputs summarise the
   * whole document set — there is no query to retrieve against.
   */
  private async buildCorpus(notebookId: string, sourceIds: string[]): Promise<string> {
    const sources = await this.sources.listByNotebook(notebookId);
    const selected = sources.filter((source) => sourceIds.includes(source.id));

    const documents: string[] = [];
    let budget = MAX_PROMPT_CHARS;

    for (const source of selected) {
      if (budget <= 0) break;

      const chunks = await this.sources.leadingChunks(source.id, CHUNKS_PER_SOURCE);
      const body = chunks.map(sanitiseForPrompt).join('\n\n').slice(0, budget);
      if (!body.trim()) continue;

      budget -= body.length;
      documents.push(
        `<document title="${sanitiseTitleForPrompt(source.title)}">\n${body}\n</document>`,
      );
    }

    if (documents.length === 0) {
      throw new InvariantViolationError(
        'studio.empty_corpus',
        'the selected sources contain no usable text',
      );
    }
    return documents.join('\n\n');
  }
}
