-- Everlast :: invitation status
--
-- Sharing with an address that has no account creates that account and mails it
-- an invitation. Until the invitation is opened the membership exists but
-- nobody is behind it, and a collaborator list that cannot tell the two apart
-- quietly misreports who has access — the owner sees a colleague who, as far as
-- they know, has read everything, and who has in fact never arrived.
--
-- The fact lives in `auth.users`, which the application deliberately never
-- reads. `profiles` exists precisely to mirror that table so collaborator lists
-- do not need the admin API, so the mirror gains one column rather than the
-- member list gaining a privileged lookup per row.

alter table public.profiles
  add column confirmed_at timestamptz;

comment on column public.profiles.confirmed_at is
  'Mirror of auth.users.confirmed_at. Null means the account has never been confirmed: an invitation nobody opened, or a signup nobody finished.';

-- Rows that predate the column: take the truth from auth.users rather than
-- assuming, so an unconfirmed signup is not backfilled as confirmed.
update public.profiles p
   set confirmed_at = u.confirmed_at
  from auth.users u
 where u.id = p.id;

-- ---------------------------------------------------------------------------
-- Keeping the mirror honest
-- ---------------------------------------------------------------------------

-- Extends the existing mirror trigger (insert + email change) to carry the
-- confirmation timestamp as well.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url, confirmed_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    new.confirmed_at
  )
  on conflict (id) do update
    set email = excluded.email,
        confirmed_at = excluded.confirmed_at;
  return new;
end;
$$;

create or replace function public.sync_profile_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set confirmed_at = new.confirmed_at
   where id = new.id;
  return new;
end;
$$;

/**
 * Fires on every update to `auth.users` and filters in WHEN, rather than the
 * narrower `after update of confirmed_at` that this obviously wants to be.
 *
 * `auth.users.confirmed_at` is `GENERATED ALWAYS AS (least(email_confirmed_at,
 * phone_confirmed_at))`, and `UPDATE OF <column>` fires when that column is
 * named in the statement's SET list — which a generated column can never be.
 * The narrower trigger would therefore be silently dead, and every invitation
 * would stay marked pending forever after being accepted.
 */
create trigger on_auth_user_confirmed
  after update on auth.users
  for each row
  when (old.confirmed_at is distinct from new.confirmed_at)
  execute function public.sync_profile_confirmation();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

/**
 * `confirmed_at` is a mirror, not a preference: it must not be writable by the
 * person it describes.
 *
 * `20260101000500_grants.sql` grants UPDATE on the whole table, which combined
 * with `profiles_update_self` would let anyone mark their own invitation
 * accepted — and, already today, rewrite the mirrored `email` that sharing
 * looks addresses up by. Narrowing the grant to the columns a profile genuinely
 * owns closes both. `ProfileService.update` writes only these three.
 */
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, locale, theme)
  on public.profiles to authenticated;
