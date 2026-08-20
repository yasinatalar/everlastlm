import type { Notebook, NotebookRole } from '@everlast/contracts';
import type { Page } from '@everlast/contracts';
import type { Notebook as NotebookAggregate } from './notebook.entity';

/**
 * Write side: loads and persists whole aggregates.
 */
export abstract class NotebookRepository {
  abstract findById(id: string): Promise<NotebookAggregate | null>;
  abstract insert(notebook: NotebookAggregate): Promise<void>;
  abstract update(notebook: NotebookAggregate): Promise<void>;
  /** Soft delete. Separate from `update` because it needs a privileged path. */
  abstract archive(notebookId: string): Promise<void>;
}

export interface NotebookListQuery {
  limit: number;
  cursor?: string;
  search?: string;
}

/**
 * Read side. Queries deliberately bypass the aggregate: rendering a notebook
 * list needs a projection (role, member count, source count) that no single
 * aggregate owns, and loading N aggregates to build it would be both slower and
 * a worse fit for the shape the UI wants.
 */
export abstract class NotebookReadModel {
  abstract list(query: NotebookListQuery): Promise<Page<Notebook>>;
  abstract findOne(id: string): Promise<Notebook | null>;
  abstract roleOf(notebookId: string, userId: string): Promise<NotebookRole | null>;
}
