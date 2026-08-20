import { AggregateRoot, newId } from '../../../shared/kernel/entity';
import { domainEvent } from '../../../shared/kernel/domain-event';
import { requireNonEmpty } from '../../../shared/kernel/guard';

export interface NotebookState {
  ownerId: string;
  title: string;
  description: string | null;
  emoji: string | null;
  sourceCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * A notebook is the consistency boundary for everything a user researches
 * together: its sources, chats, notes and studio outputs. Nothing outside a
 * notebook may reference those children directly — they are always reached
 * through the notebook, which is what makes "may this user see this?" a single
 * question rather than one per table.
 */
export class Notebook extends AggregateRoot {
  private constructor(
    id: string,
    private state: NotebookState,
  ) {
    super(id);
  }

  static create(input: {
    ownerId: string;
    title: string;
    description?: string | null;
    emoji?: string | null;
  }): Notebook {
    const now = new Date();
    const notebook = new Notebook(newId(), {
      ownerId: requireNonEmpty(input.ownerId, 'notebook.owner_id'),
      title: requireNonEmpty(input.title, 'notebook.title'),
      description: input.description?.trim() || null,
      emoji: input.emoji?.trim() || null,
      sourceCount: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    notebook.record(
      domainEvent(
        'notebook.created',
        { title: notebook.state.title },
        { notebookId: notebook.id, actorId: input.ownerId },
      ),
    );
    return notebook;
  }

  /** Rebuilds an aggregate from storage without re-running creation rules. */
  static rehydrate(id: string, state: NotebookState): Notebook {
    return new Notebook(id, state);
  }

  rename(title: string): void {
    const next = requireNonEmpty(title, 'notebook.title');
    if (next === this.state.title) return;
    this.state = { ...this.state, title: next, updatedAt: new Date() };
    this.record(domainEvent('notebook.renamed', { title: next }, { notebookId: this.id }));
  }

  describe(description: string | null): void {
    this.state = {
      ...this.state,
      description: description?.trim() || null,
      updatedAt: new Date(),
    };
  }

  setEmoji(emoji: string | null): void {
    this.state = { ...this.state, emoji: emoji?.trim() || null, updatedAt: new Date() };
  }

  /**
   * Soft delete: a notebook may be referenced by audit records and by other
   * members' recent activity, so it is retired rather than erased. The RLS
   * policies filter `deleted_at is null`, so it disappears from every read path
   * immediately.
   */
  archive(actorId: string): void {
    if (this.state.deletedAt) return;
    this.state = { ...this.state, deletedAt: new Date(), updatedAt: new Date() };
    this.record(domainEvent('notebook.archived', {}, { notebookId: this.id, actorId }));
  }

  get isArchived(): boolean {
    return this.state.deletedAt !== null;
  }

  get ownerId(): string {
    return this.state.ownerId;
  }

  get title(): string {
    return this.state.title;
  }

  get snapshot(): Readonly<NotebookState> {
    return this.state;
  }
}
