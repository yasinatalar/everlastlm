import { Injectable } from '@nestjs/common';
import { roleAtLeast, type NotebookRole } from '@everlast/contracts';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../context/request-context';
import { ForbiddenError, NotFoundError } from '../kernel/domain-error';

/**
 * The single place that answers "may this caller touch this notebook?".
 *
 * The lookup runs through the *user-scoped* client, so it is itself subject to
 * RLS — a caller who is not a member sees no membership row and is treated as
 * having no role. That makes this check and the database's check impossible to
 * disagree.
 */
@Injectable()
export class NotebookAccessService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
  ) {}

  async roleFor(notebookId: string): Promise<NotebookRole | null> {
    const user = this.context.requireUser();

    return this.context.memo(`role:${notebookId}:${user.id}`, async () => {
      // The join is not decoration: membership rows outlive an archived
      // notebook, so without it a caller who kept a child id could still reach
      // the sources and chats of a notebook they had already deleted.
      const { data, error } = await this.supabase
        .forUser()
        .from('notebook_members')
        .select('role, notebooks!inner(deleted_at)')
        .eq('notebook_id', notebookId)
        .eq('user_id', user.id)
        .is('notebooks.deleted_at', null)
        .maybeSingle()
        .overrideTypes<{ role: NotebookRole }>();

      if (error) this.supabase.fail('notebook_members.select', error);
      return data?.role ?? null;
    });
  }

  /**
   * Enforces a minimum role. A caller with no membership gets `NotFoundError`
   * rather than `ForbiddenError` so the API does not confirm that a notebook
   * with that id exists. A member who is merely under-privileged does get
   * `ForbiddenError`, because they already know the notebook exists.
   */
  async require(notebookId: string, minimum: NotebookRole): Promise<NotebookRole> {
    const role = await this.roleFor(notebookId);
    if (!role) throw new NotFoundError('notebook', notebookId);
    if (!roleAtLeast(role, minimum)) {
      throw new ForbiddenError('notebook', `requires ${minimum} role`);
    }
    return role;
  }
}
