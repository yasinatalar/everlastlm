import type { SourceKind, SourceStatus } from '@everlast/contracts';
import { domainEvent } from '../../../shared/kernel/domain-event';
import { AggregateRoot, newId } from '../../../shared/kernel/entity';
import { ConflictError } from '../../../shared/kernel/domain-error';
import { requireNonEmpty } from '../../../shared/kernel/guard';

export interface SourceState {
  notebookId: string;
  createdBy: string | null;
  kind: SourceKind;
  title: string;
  originUri: string | null;
  storagePath: string | null;
  byteSize: number | null;
  checksum: string | null;
  status: SourceStatus;
  failureReason: string | null;
  summary: string | null;
  keyTopics: string[];
  tokenCount: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Legal status transitions. Ingestion is a pipeline, and a source that has
 * already failed or completed must not be silently dragged backwards by a
 * late-arriving worker callback.
 */
const TRANSITIONS: Record<SourceStatus, readonly SourceStatus[]> = {
  pending: ['extracting', 'failed'],
  extracting: ['chunking', 'failed'],
  chunking: ['embedding', 'failed'],
  embedding: ['ready', 'failed'],
  ready: [],
  failed: ['extracting'], // retry re-enters the pipeline from the top
};

export class Source extends AggregateRoot {
  private constructor(
    id: string,
    private state: SourceState,
  ) {
    super(id);
  }

  static create(input: {
    notebookId: string;
    createdBy: string;
    kind: SourceKind;
    title: string;
    originUri?: string | null;
    storagePath?: string | null;
    byteSize?: number | null;
    checksum?: string | null;
  }): Source {
    const now = new Date();
    const source = new Source(newId(), {
      notebookId: requireNonEmpty(input.notebookId, 'source.notebook_id'),
      createdBy: input.createdBy,
      kind: input.kind,
      title: requireNonEmpty(input.title, 'source.title'),
      originUri: input.originUri ?? null,
      storagePath: input.storagePath ?? null,
      byteSize: input.byteSize ?? null,
      checksum: input.checksum ?? null,
      status: 'pending',
      failureReason: null,
      summary: null,
      keyTopics: [],
      tokenCount: 0,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    source.record(
      domainEvent(
        'source.added',
        { kind: input.kind, title: source.state.title },
        { notebookId: input.notebookId, actorId: input.createdBy },
      ),
    );
    return source;
  }

  static rehydrate(id: string, state: SourceState): Source {
    return new Source(id, state);
  }

  private transition(next: SourceStatus): void {
    const allowed = TRANSITIONS[this.state.status];
    if (!allowed.includes(next)) {
      throw new ConflictError(
        'source.invalid_transition',
        `cannot move a source from ${this.state.status} to ${next}`,
      );
    }
    this.state = { ...this.state, status: next, updatedAt: new Date() };
  }

  beginExtraction(): void {
    this.transition('extracting');
  }

  beginChunking(): void {
    this.transition('chunking');
  }

  beginEmbedding(chunkCount: number, tokenCount: number): void {
    this.transition('embedding');
    this.state = { ...this.state, chunkCount, tokenCount };
  }

  markReady(summary: string | null, keyTopics: string[]): void {
    this.transition('ready');
    this.state = {
      ...this.state,
      summary,
      keyTopics: keyTopics.slice(0, 12),
      failureReason: null,
    };
    this.record(
      domainEvent(
        'source.ready',
        { chunkCount: this.state.chunkCount },
        { notebookId: this.state.notebookId },
      ),
    );
  }

  /**
   * Failure is reachable from any non-terminal state, and the reason shown to
   * the user is a short domain phrase — never an upstream exception message,
   * which could echo internal hostnames or file paths back to the browser.
   */
  markFailed(reason: string): void {
    this.state = {
      ...this.state,
      status: 'failed',
      failureReason: reason.slice(0, 300),
      updatedAt: new Date(),
    };
    this.record(
      domainEvent('source.failed', { reason }, { notebookId: this.state.notebookId }),
    );
  }

  /**
   * Records where the original bytes were stored. Only valid before ingestion
   * starts — rebinding a ready source's object would orphan its chunks.
   */
  attachStorage(storagePath: string): void {
    if (this.state.status !== 'pending') {
      throw new ConflictError(
        'source.already_ingesting',
        'storage can only be attached before ingestion begins',
      );
    }
    this.state = { ...this.state, storagePath, updatedAt: new Date() };
  }

  rename(title: string): void {
    this.state = {
      ...this.state,
      title: requireNonEmpty(title, 'source.title'),
      updatedAt: new Date(),
    };
  }

  get notebookId(): string {
    return this.state.notebookId;
  }

  get kind(): SourceKind {
    return this.state.kind;
  }

  get status(): SourceStatus {
    return this.state.status;
  }

  get storagePath(): string | null {
    return this.state.storagePath;
  }

  get originUri(): string | null {
    return this.state.originUri;
  }

  get title(): string {
    return this.state.title;
  }

  get snapshot(): Readonly<SourceState> {
    return this.state;
  }
}
