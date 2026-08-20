import { Injectable } from '@nestjs/common';
import type {
  ChangeMemberRoleInput,
  InviteMemberInput,
  NotebookMember,
} from '@everlast/contracts';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../../../shared/context/request-context';
import { ConflictError, InvariantViolationError, NotFoundError } from '../../../shared/kernel/domain-error';
import { AuditService } from '../../../shared/security/audit.service';

interface MemberJoinRow {
  notebook_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  created_at: string;
  profiles: {
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
}

/**
 * Sharing. Only an owner reaches these operations — enforced by
 * `@RequiresNotebookRole('owner')` at the controller, by this service, and by
 * the `members_*_owner` RLS policies.
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
    private readonly audit: AuditService,
  ) {}

  async list(notebookId: string): Promise<NotebookMember[]> {
    const { data, error } = await this.supabase
      .forUser()
      .from('notebook_members')
      .select('notebook_id, user_id, role, created_at, profiles(display_name, email, avatar_url)')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: true })
      .overrideTypes<MemberJoinRow[]>();

    if (error) this.supabase.fail('notebook_members.list', error);

    return (data ?? []).map((row) => ({
      userId: row.user_id,
      notebookId: row.notebook_id,
      role: row.role,
      displayName: row.profiles?.display_name ?? null,
      email: row.profiles?.email ?? null,
      avatarUrl: row.profiles?.avatar_url ?? null,
      createdAt: row.created_at,
    }));
  }

  /**
   * Adds an existing account to the notebook.
   *
   * The lookup runs with the service-role client because the invitee is, by
   * definition, not yet a collaborator and so is invisible under the profiles
   * RLS policy. That makes this endpoint an account-existence oracle for
   * notebook owners, which is the same trade every collaboration product makes;
   * it is contained by the AI/mutation rate limiter and every call is audited.
   */
  async invite(notebookId: string, input: InviteMemberInput): Promise<NotebookMember> {
    const actor = this.context.requireUser();
    const email = input.email.trim().toLowerCase();

    if (actor.email && email === actor.email.toLowerCase()) {
      throw new InvariantViolationError('member.self_invite', 'you are already a member');
    }

    const { data: invitee, error: lookupError } = await this.supabase.admin
      .from('profiles')
      .select('id, display_name, email, avatar_url')
      .eq('email', email)
      .maybeSingle();

    if (lookupError) this.supabase.fail('profiles.lookupByEmail', lookupError);

    if (!invitee) {
      await this.audit.record({
        action: 'notebook.invite_failed',
        notebookId,
        metadata: { reason: 'no_account' },
      });
      throw new NotFoundError('invitee');
    }

    const { error: insertError } = await this.supabase
      .forUser()
      .from('notebook_members')
      .insert({
        notebook_id: notebookId,
        user_id: invitee.id,
        role: input.role,
        invited_by: actor.id,
      });

    if (insertError) {
      if (insertError.code === '23505') {
        throw new ConflictError('member.already_present', 'user is already a member');
      }
      this.supabase.fail('notebook_members.insert', insertError);
    }

    await this.audit.record({
      action: 'notebook.member_added',
      notebookId,
      targetType: 'user',
      targetId: invitee.id,
      metadata: { role: input.role },
    });

    return {
      userId: invitee.id,
      notebookId,
      role: input.role,
      displayName: invitee.display_name,
      email: invitee.email,
      avatarUrl: invitee.avatar_url,
      createdAt: new Date().toISOString(),
    };
  }

  async changeRole(
    notebookId: string,
    userId: string,
    input: ChangeMemberRoleInput,
  ): Promise<void> {
    await this.assertNotLastOwnerChange(notebookId, userId);

    const { error } = await this.supabase
      .forUser()
      .from('notebook_members')
      .update({ role: input.role })
      .eq('notebook_id', notebookId)
      .eq('user_id', userId);

    if (error) this.supabase.fail('notebook_members.changeRole', error);

    await this.audit.record({
      action: 'notebook.member_role_changed',
      notebookId,
      targetType: 'user',
      targetId: userId,
      metadata: { role: input.role },
    });
  }

  async remove(notebookId: string, userId: string): Promise<void> {
    await this.assertNotLastOwnerChange(notebookId, userId);

    const { error } = await this.supabase
      .forUser()
      .from('notebook_members')
      .delete()
      .eq('notebook_id', notebookId)
      .eq('user_id', userId);

    if (error) this.supabase.fail('notebook_members.remove', error);

    await this.audit.record({
      action: 'notebook.member_removed',
      notebookId,
      targetType: 'user',
      targetId: userId,
    });
  }

  /**
   * A notebook without an owner can never be shared or deleted again, so the
   * last owner may not be demoted or removed. `notebooks.owner_id` still points
   * at them, which is what makes this the real invariant rather than a nicety.
   */
  private async assertNotLastOwnerChange(notebookId: string, userId: string): Promise<void> {
    const { data, error } = await this.supabase
      .forUser()
      .from('notebook_members')
      .select('user_id')
      .eq('notebook_id', notebookId)
      .eq('role', 'owner');

    if (error) this.supabase.fail('notebook_members.owners', error);

    const owners = data ?? [];
    if (owners.length <= 1 && owners.some((row) => row.user_id === userId)) {
      throw new InvariantViolationError(
        'member.last_owner',
        'a notebook must always have at least one owner',
      );
    }
  }
}
