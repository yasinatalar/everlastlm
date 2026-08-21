import { Injectable, Logger } from '@nestjs/common';
import type {
  ChangeMemberRoleInput,
  InviteMemberInput,
  InviteMemberResult,
  NotebookMember,
} from '@everlast/contracts';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../../../shared/context/request-context';
import {
  ConflictError,
  DependencyFailureError,
  DependencyNotConfiguredError,
  InvariantViolationError,
  QuotaExceededError,
} from '../../../shared/kernel/domain-error';
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
    confirmed_at: string | null;
  } | null;
}

interface InviteeProfile {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  confirmed_at: string | null;
}

/**
 * Nobody is behind this membership yet.
 *
 * `profiles.confirmed_at` mirrors `auth.users.confirmed_at`, which stays null
 * for an invitation nobody has opened and for a signup nobody finished. Both
 * mean the same thing to an owner reading the list: this person cannot sign in,
 * so they have not seen the notebook.
 */
const isPending = (confirmedAt: string | null | undefined): boolean => !confirmedAt;

/**
 * Sharing. Only an owner reaches these operations — enforced by
 * `@RequiresNotebookRole('owner')` at the controller, by this service, and by
 * the `members_*_owner` RLS policies.
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
    private readonly audit: AuditService,
  ) {}

  async list(notebookId: string): Promise<NotebookMember[]> {
    const { data, error } = await this.supabase
      .forUser()
      .from('notebook_members')
      .select(
        'notebook_id, user_id, role, created_at, profiles(display_name, email, avatar_url, confirmed_at)',
      )
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
      pending: isPending(row.profiles?.confirmed_at),
      createdAt: row.created_at,
    }));
  }

  /**
   * Grants an email address access to the notebook, whether or not it has an
   * account yet.
   *
   * An address with no account is not a dead end: an account is created for it
   * and Supabase mails an invitation, so sharing works the way a person expects
   * it to — you type an address, they get an email. The membership row is
   * written immediately either way, so the notebook is waiting for them the
   * moment they open the link.
   *
   * The lookup runs with the service-role client because the invitee is, by
   * definition, not yet a collaborator and so is invisible under the profiles
   * RLS policy. Because both branches now succeed and return the same shape,
   * this endpoint no longer tells an owner whether an address has an account —
   * the enumeration oracle it used to be is gone. Outbound mail is what has to
   * be contained instead: the route carries the strict rate limit, Supabase caps
   * `email_sent` on top of that, and every call is audited.
   */
  async invite(notebookId: string, input: InviteMemberInput): Promise<InviteMemberResult> {
    const actor = this.context.requireUser();
    const email = input.email.trim().toLowerCase();

    if (actor.email && email === actor.email.toLowerCase()) {
      throw new InvariantViolationError('member.self_invite', 'you are already a member');
    }

    const existing = await this.findProfileByEmail(email);
    const invitationSent = existing === null;
    const invitee = existing ?? (await this.createInvitedAccount(email));

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
      action: invitationSent ? 'notebook.invitation_sent' : 'notebook.member_added',
      notebookId,
      targetType: 'user',
      targetId: invitee.id,
      metadata: { role: input.role },
    });

    return {
      member: {
        userId: invitee.id,
        notebookId,
        role: input.role,
        displayName: invitee.display_name,
        email: invitee.email,
        avatarUrl: invitee.avatar_url,
        pending: isPending(invitee.confirmed_at),
        createdAt: new Date().toISOString(),
      },
      invitationSent,
    };
  }

  private async findProfileByEmail(email: string): Promise<InviteeProfile | null> {
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('id, display_name, email, avatar_url, confirmed_at')
      .eq('email', email)
      .maybeSingle();

    if (error) this.supabase.fail('profiles.lookupByEmail', error);
    return data;
  }

  /**
   * Creates a passwordless account for an address nobody has signed up with and
   * asks Supabase to mail it an invitation.
   *
   * The `profiles` row this needs is not written here: the `on_auth_user_created`
   * trigger mirrors `auth.users` into `profiles` inside the same statement, so
   * by the time this returns the row the membership's foreign key points at
   * already exists. Reading it back rather than assembling it from the auth
   * response keeps one definition of how an invitee is named — the trigger's.
   *
   * If the membership insert that follows fails, the account and its email are
   * already out the door. That leaves someone holding an invitation to nothing,
   * which is the mildest of the available failures and needs no compensation:
   * the insert is an owner writing a row they are allowed to write, so the only
   * way past this point is an outage.
   */
  private async createInvitedAccount(email: string): Promise<InviteeProfile> {
    const { error } = await this.supabase.admin.auth.admin.inviteUserByEmail(email);

    if (error) {
      // Someone signed up, or was invited to another notebook, in the moment
      // between the lookup above and this call. Their account is what we wanted.
      if (error.status === 422 || error.code === 'email_exists') {
        const raced = await this.findProfileByEmail(email);
        if (raced) return raced;
      }

      if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
        throw new QuotaExceededError(
          'invite.email_rate_limited',
          'too many invitations sent just now; try again in a few minutes',
        );
      }

      // No working sender is a configuration fault, not a transient one, and
      // retrying will never fix it — see docs/deployment.md on custom SMTP.
      if (error.code === 'error_sending_email') {
        this.logger.error(
          { requestId: this.context.requestId, code: error.code },
          `invitation email could not be sent: ${error.message}`,
        );
        throw new DependencyNotConfiguredError('email');
      }

      this.logger.error(
        { requestId: this.context.requestId, code: error.code, status: error.status },
        `auth.admin.inviteUserByEmail failed: ${error.message}`,
      );
      throw new DependencyFailureError('supabase', 'invite failed');
    }

    const profile = await this.findProfileByEmail(email);
    if (!profile) {
      // The mirror trigger is part of the same transaction as the insert, so
      // this cannot happen without the schema having drifted.
      throw new DependencyFailureError('supabase', 'invited account has no profile');
    }

    return profile;
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
