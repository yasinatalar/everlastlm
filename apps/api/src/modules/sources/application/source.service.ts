import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ACCEPTED_UPLOAD_MIME_TYPES,
  MAX_SOURCES_PER_NOTEBOOK,
  type AddTextSourceInput,
  type AddUrlSourceInput,
  type Source as SourceDto,
  type SourceKind,
} from '@everlast/contracts';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { Env } from '../../../config/env.schema';
import { assertPublicUrl } from '../../../infrastructure/net/safe-http';
import { RequestContextService } from '../../../shared/context/request-context';
import {
  ConflictError,
  InvariantViolationError,
  NotFoundError,
  QuotaExceededError,
} from '../../../shared/kernel/domain-error';
import { AuditService } from '../../../shared/security/audit.service';
import { Source } from '../domain/source.entity';
import { SourceRepository, SourceStoragePort } from '../domain/source.repository';
import { toSourceDto } from '../infrastructure/supabase-source.repository';
import { IngestionService } from './ingestion.service';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Magic bytes for the formats we accept. A browser-supplied `Content-Type` is
 * a hint, not evidence — checking the actual leading bytes is what stops a
 * renamed executable or a polyglot file from entering the pipeline.
 */
const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-',
  // DOCX is a ZIP container.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (bytes) =>
    bytes[0] === 0x50 && bytes[1] === 0x4b,
};

@Injectable()
export class SourceService {
  constructor(
    private readonly sources: SourceRepository,
    private readonly storage: SourceStoragePort,
    private readonly ingestion: IngestionService,
    private readonly context: RequestContextService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  async list(notebookId: string): Promise<SourceDto[]> {
    return this.sources.listByNotebook(notebookId);
  }

  async getById(notebookId: string, sourceId: string): Promise<SourceDto> {
    const source = await this.sources.findById(sourceId);
    // Belt and braces: RLS already scopes the read, but an id from another
    // notebook must not resolve just because the caller can see that one too.
    if (!source || source.notebookId !== notebookId) {
      throw new NotFoundError('source', sourceId);
    }
    return toSourceDto({
      id: source.id,
      notebook_id: source.notebookId,
      created_by: source.snapshot.createdBy,
      kind: source.kind,
      title: source.title,
      origin_uri: source.originUri,
      storage_path: source.storagePath,
      byte_size: source.snapshot.byteSize,
      checksum: source.snapshot.checksum,
      status: source.status,
      failure_reason: source.snapshot.failureReason,
      summary: source.snapshot.summary,
      key_topics: source.snapshot.keyTopics,
      token_count: source.snapshot.tokenCount,
      chunk_count: source.snapshot.chunkCount,
      created_at: source.snapshot.createdAt.toISOString(),
      updated_at: source.snapshot.updatedAt.toISOString(),
    });
  }

  async addUpload(notebookId: string, file: UploadedFile): Promise<SourceDto> {
    await this.assertCapacity(notebookId);
    const user = this.context.requireUser();

    if (file.size > this.config.MAX_UPLOAD_BYTES) {
      throw new InvariantViolationError('source.too_large', 'that file is too large');
    }

    const kind = ACCEPTED_UPLOAD_MIME_TYPES[
      file.mimetype as keyof typeof ACCEPTED_UPLOAD_MIME_TYPES
    ] as SourceKind | undefined;

    if (!kind) {
      throw new InvariantViolationError(
        'source.unsupported_type',
        'only PDF, DOCX, TXT and Markdown files are supported',
      );
    }

    const verifier = MAGIC[file.mimetype];
    if (verifier && !verifier(file.buffer)) {
      throw new InvariantViolationError(
        'source.content_mismatch',
        'the file contents do not match its type',
      );
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.sources.findByChecksum(notebookId, checksum);
    if (existing) {
      throw new ConflictError('source.duplicate', 'this document is already in the notebook');
    }

    const title = stripExtension(file.originalname);
    const source = Source.create({
      notebookId,
      createdBy: user.id,
      kind,
      title,
      byteSize: file.size,
      checksum,
    });

    source.attachStorage(
      await this.storage.upload(
        notebookId,
        source.id,
        file.originalname,
        file.mimetype,
        file.buffer,
      ),
    );

    await this.sources.insert(source);
    await this.audit.record({
      action: 'source.uploaded',
      notebookId,
      targetType: 'source',
      targetId: source.id,
      metadata: { kind, bytes: file.size },
    });

    // Text formats are already in memory; hand them straight to the pipeline
    // rather than making it round-trip through storage.
    const rawText =
      kind === 'text' || kind === 'markdown' ? file.buffer.toString('utf8') : undefined;
    this.ingestion.enqueue(source, rawText);

    return this.getById(notebookId, source.id);
  }

  async addUrl(notebookId: string, input: AddUrlSourceInput): Promise<SourceDto> {
    await this.assertCapacity(notebookId);
    const user = this.context.requireUser();

    // Validate before creating a row, so a blocked address never leaves a
    // failed source behind in the notebook.
    const url = await assertPublicUrl(input.url, this.config.ALLOW_PRIVATE_NETWORK_FETCH);
    const normalised = url.toString();

    const checksum = createHash('sha256').update(`url:${normalised}`).digest('hex');
    if (await this.sources.findByChecksum(notebookId, checksum)) {
      throw new ConflictError('source.duplicate', 'this URL is already in the notebook');
    }

    const source = Source.create({
      notebookId,
      createdBy: user.id,
      kind: 'url',
      title: input.title ?? url.hostname + url.pathname,
      originUri: normalised,
      checksum,
    });

    await this.sources.insert(source);
    await this.audit.record({
      action: 'source.url_added',
      notebookId,
      targetType: 'source',
      targetId: source.id,
      metadata: { host: url.hostname },
    });

    this.ingestion.enqueue(source);
    return this.getById(notebookId, source.id);
  }

  async addText(notebookId: string, input: AddTextSourceInput): Promise<SourceDto> {
    await this.assertCapacity(notebookId);
    const user = this.context.requireUser();

    const checksum = createHash('sha256').update(input.content).digest('hex');
    if (await this.sources.findByChecksum(notebookId, checksum)) {
      throw new ConflictError('source.duplicate', 'this text is already in the notebook');
    }

    const source = Source.create({
      notebookId,
      createdBy: user.id,
      kind: input.kind,
      title: input.title,
      byteSize: Buffer.byteLength(input.content, 'utf8'),
      checksum,
    });

    await this.sources.insert(source);
    await this.audit.record({
      action: 'source.text_added',
      notebookId,
      targetType: 'source',
      targetId: source.id,
    });

    this.ingestion.enqueue(source, input.content);
    return this.getById(notebookId, source.id);
  }

  async rename(notebookId: string, sourceId: string, title: string): Promise<SourceDto> {
    const source = await this.sources.findById(sourceId);
    if (!source || source.notebookId !== notebookId) {
      throw new NotFoundError('source', sourceId);
    }

    source.rename(title);
    await this.sources.update(source);
    return this.getById(notebookId, sourceId);
  }

  async retry(notebookId: string, sourceId: string): Promise<SourceDto> {
    const source = await this.sources.findById(sourceId);
    if (!source || source.notebookId !== notebookId) {
      throw new NotFoundError('source', sourceId);
    }
    if (source.status !== 'failed') {
      throw new ConflictError('source.not_failed', 'only a failed source can be retried');
    }

    this.ingestion.enqueue(source);
    return this.getById(notebookId, sourceId);
  }

  async remove(notebookId: string, sourceId: string): Promise<void> {
    const source = await this.sources.findById(sourceId);
    if (!source || source.notebookId !== notebookId) {
      throw new NotFoundError('source', sourceId);
    }

    // Row first: chunks cascade with it. If the object delete then fails we are
    // left with an orphaned blob rather than a citation pointing at nothing.
    await this.sources.delete(sourceId);
    if (source.storagePath) {
      await this.storage.remove(source.storagePath).catch(() => undefined);
    }

    await this.audit.record({
      action: 'source.deleted',
      notebookId,
      targetType: 'source',
      targetId: sourceId,
    });
  }

  async downloadUrl(notebookId: string, sourceId: string): Promise<string> {
    const source = await this.sources.findById(sourceId);
    if (!source || source.notebookId !== notebookId || !source.storagePath) {
      throw new NotFoundError('source', sourceId);
    }
    return this.storage.signedUrl(source.storagePath, 120);
  }

  private async assertCapacity(notebookId: string): Promise<void> {
    const count = await this.sources.countByNotebook(notebookId);
    if (count >= MAX_SOURCES_PER_NOTEBOOK) {
      throw new QuotaExceededError(
        'source.limit_reached',
        `a notebook can hold at most ${MAX_SOURCES_PER_NOTEBOOK} sources`,
      );
    }
  }
}

const stripExtension = (filename: string): string => {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, '').trim() || 'Untitled document';
};
