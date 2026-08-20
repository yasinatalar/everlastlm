import { Injectable } from '@nestjs/common';
import type {
  CreateNotebookInput,
  Notebook as NotebookDto,
  Page,
  UpdateNotebookInput,
} from '@everlast/contracts';
import { RequestContextService } from '../../../shared/context/request-context';
import { NotFoundError } from '../../../shared/kernel/domain-error';
import { AuditService } from '../../../shared/security/audit.service';
import { Notebook } from '../domain/notebook.entity';
import { NotebookReadModel, NotebookRepository } from '../domain/notebook.repository';

/**
 * Use cases for the notebook aggregate. Authorisation for `:notebookId` routes
 * has already been enforced by `NotebookAccessGuard` before anything here runs,
 * and RLS re-checks it at the database. This layer therefore concentrates on
 * orchestration: load, invoke domain behaviour, persist, publish, audit.
 */
@Injectable()
export class NotebookService {
  constructor(
    private readonly repository: NotebookRepository,
    private readonly readModel: NotebookReadModel,
    private readonly context: RequestContextService,
    private readonly audit: AuditService,
  ) {}

  async list(params: { limit: number; cursor?: string; search?: string }): Promise<
    Page<NotebookDto>
  > {
    return this.readModel.list(params);
  }

  async getById(notebookId: string): Promise<NotebookDto> {
    const notebook = await this.readModel.findOne(notebookId);
    if (!notebook) throw new NotFoundError('notebook', notebookId);
    return notebook;
  }

  async create(input: CreateNotebookInput): Promise<NotebookDto> {
    const user = this.context.requireUser();

    const notebook = Notebook.create({
      ownerId: user.id,
      title: input.title,
      description: input.description ?? null,
      emoji: input.emoji ?? null,
    });

    await this.repository.insert(notebook);
    await this.publish(notebook);

    const created = await this.readModel.findOne(notebook.id);
    if (!created) throw new NotFoundError('notebook', notebook.id);
    return created;
  }

  async update(notebookId: string, input: UpdateNotebookInput): Promise<NotebookDto> {
    const notebook = await this.repository.findById(notebookId);
    if (!notebook) throw new NotFoundError('notebook', notebookId);

    if (input.title !== undefined) notebook.rename(input.title);
    if (input.description !== undefined) notebook.describe(input.description ?? null);
    if (input.emoji !== undefined) notebook.setEmoji(input.emoji ?? null);

    await this.repository.update(notebook);
    await this.publish(notebook);

    return this.getById(notebookId);
  }

  async archive(notebookId: string): Promise<void> {
    const user = this.context.requireUser();
    const notebook = await this.repository.findById(notebookId);
    if (!notebook) throw new NotFoundError('notebook', notebookId);

    notebook.archive(user.id);
    await this.repository.archive(notebook.id);
    await this.publish(notebook);
  }

  /**
   * Domain events currently drive the audit trail only. Routing them to a real
   * bus later means changing this method and nothing in the domain.
   */
  private async publish(notebook: Notebook): Promise<void> {
    for (const event of notebook.pullEvents()) {
      await this.audit.record({
        action: event.name,
        notebookId: event.notebookId ?? null,
        targetType: 'notebook',
        targetId: notebook.id,
        metadata: event.payload,
      });
    }
  }
}
