-- Everlast :: row level security
--
-- Threat model: the API server holds a service-role key, but every request that
-- originates from a browser is executed through a Supabase client bound to that
-- user's access token, so these policies are the authoritative access check.
-- The application layer performs the same check first; RLS is the backstop that
-- survives an application bug.
--
-- Recursion note: membership lookups run inside SECURITY DEFINER functions.
-- Referencing `notebook_members` directly from a `notebooks` policy (and vice
-- versa) would re-enter RLS and abort with `infinite recursion detected`.

-- ---------------------------------------------------------------------------
-- Authorisation helpers
-- ---------------------------------------------------------------------------

create or replace function public.notebook_role_of(p_notebook_id uuid)
returns public.notebook_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.notebook_members m
  where m.notebook_id = p_notebook_id
    and m.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_notebook_member(p_notebook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notebook_members m
    join public.notebooks n on n.id = m.notebook_id
    where m.notebook_id = p_notebook_id
      and m.user_id = (select auth.uid())
      and n.deleted_at is null
  );
$$;

create or replace function public.can_edit_notebook(p_notebook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notebook_members m
    join public.notebooks n on n.id = m.notebook_id
    where m.notebook_id = p_notebook_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'editor')
      and n.deleted_at is null
  );
$$;

create or replace function public.is_notebook_owner(p_notebook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notebook_members m
    where m.notebook_id = p_notebook_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

/**
 * Membership-only editor check, deliberately blind to `deleted_at`.
 *
 * `can_edit_notebook` refuses on an archived notebook, which is right for its
 * children but wrong for the notebooks table's own UPDATE policy: archiving IS
 * an update that sets `deleted_at`, and a WITH CHECK calling `can_edit_notebook`
 * re-reads the row it is validating and rejects the archive it was asked to
 * approve. The notebooks policies pair this with a plain `deleted_at is null`
 * on the OLD row instead.
 */
create or replace function public.is_notebook_editor_member(p_notebook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notebook_members m
    where m.notebook_id = p_notebook_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'editor')
  );
$$;

create or replace function public.shares_notebook_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notebook_members mine
    join public.notebook_members theirs on theirs.notebook_id = mine.notebook_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

revoke execute on function public.notebook_role_of(uuid) from public;
revoke execute on function public.is_notebook_member(uuid) from public;
revoke execute on function public.can_edit_notebook(uuid) from public;
revoke execute on function public.is_notebook_owner(uuid) from public;
revoke execute on function public.is_notebook_editor_member(uuid) from public;
revoke execute on function public.shares_notebook_with(uuid) from public;

grant execute on function public.notebook_role_of(uuid) to authenticated, service_role;
grant execute on function public.is_notebook_member(uuid) to authenticated, service_role;
grant execute on function public.can_edit_notebook(uuid) to authenticated, service_role;
grant execute on function public.is_notebook_owner(uuid) to authenticated, service_role;
grant execute on function public.is_notebook_editor_member(uuid) to authenticated, service_role;
grant execute on function public.shares_notebook_with(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Nothing in `public` is readable without a policy.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.notebooks enable row level security;
alter table public.notebook_members enable row level security;
alter table public.sources enable row level security;
alter table public.source_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.notes enable row level security;
alter table public.studio_artifacts enable row level security;
alter table public.audit_events enable row level security;

-- The anon role never touches domain data; it only exists for auth flows.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy profiles_select_self_or_collaborator on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_notebook_with(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- notebooks
-- ---------------------------------------------------------------------------

create policy notebooks_select_member on public.notebooks
  for select to authenticated
  using (deleted_at is null and public.is_notebook_member(id));

create policy notebooks_insert_self_owned on public.notebooks
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- Editors may rename, describe and archive a notebook. `deleted_at is null` is
-- asserted on the OLD row through USING — reading the column directly rather
-- than via a function that would re-read the row mid-update. Transferring
-- ownership is guarded by `notebooks_guard_owner_transfer` below, because a
-- WITH CHECK clause cannot see the OLD row.
create policy notebooks_update_editor on public.notebooks
  for update to authenticated
  using (deleted_at is null and public.is_notebook_editor_member(id))
  with check (public.is_notebook_editor_member(id));

create policy notebooks_delete_owner on public.notebooks
  for delete to authenticated
  using (public.is_notebook_owner(id));

/**
 * Archiving is the one write that must produce a row the read policy rejects.
 *
 * PostgreSQL applies a table's SELECT policy to the NEW row of an UPDATE, and
 * `notebooks_select_member` requires `deleted_at is null`. A plain
 * `update ... set deleted_at = now()` is therefore always refused with
 * "new row violates row-level security policy", no matter what the UPDATE
 * policy says.
 *
 * Rather than weaken the read policy — which is what actually hides archived
 * notebooks from every query in the system — the soft delete goes through this
 * SECURITY DEFINER function, which re-checks ownership itself before writing.
 */
create or replace function public.archive_notebook(p_notebook_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_notebook_owner(p_notebook_id) then
    raise exception 'only the notebook owner may archive it'
      using errcode = '42501';
  end if;

  update public.notebooks
     set deleted_at = now()
   where id = p_notebook_id
     and deleted_at is null;
end;
$$;

revoke execute on function public.archive_notebook(uuid) from public;
grant execute on function public.archive_notebook(uuid) to authenticated, service_role;

-- Ownership transfer is an owner-only operation, and the previous owner is
-- demoted to editor rather than silently losing access.
create or replace function public.notebooks_guard_owner_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    if auth.uid() is not null and not public.is_notebook_owner(old.id) then
      raise exception 'only the notebook owner may transfer ownership'
        using errcode = '42501';
    end if;

    insert into public.notebook_members (notebook_id, user_id, role, invited_by)
    values (new.id, new.owner_id, 'owner', old.owner_id)
    on conflict (notebook_id, user_id) do update set role = 'owner';

    update public.notebook_members
      set role = 'editor'
      where notebook_id = new.id and user_id = old.owner_id;
  end if;

  return new;
end;
$$;

create trigger notebooks_owner_transfer_guard
  before update of owner_id on public.notebooks
  for each row execute function public.notebooks_guard_owner_transfer();

-- ---------------------------------------------------------------------------
-- notebook_members
-- ---------------------------------------------------------------------------

create policy members_select_member on public.notebook_members
  for select to authenticated
  using (public.is_notebook_member(notebook_id));

create policy members_insert_owner on public.notebook_members
  for insert to authenticated
  with check (public.is_notebook_owner(notebook_id));

create policy members_update_owner on public.notebook_members
  for update to authenticated
  using (public.is_notebook_owner(notebook_id))
  with check (public.is_notebook_owner(notebook_id));

-- An owner may remove anybody; any member may remove themselves (leave).
create policy members_delete_owner_or_self on public.notebook_members
  for delete to authenticated
  using (public.is_notebook_owner(notebook_id) or user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------

create policy sources_select_member on public.sources
  for select to authenticated
  using (public.is_notebook_member(notebook_id));

create policy sources_insert_editor on public.sources
  for insert to authenticated
  with check (public.can_edit_notebook(notebook_id));

create policy sources_update_editor on public.sources
  for update to authenticated
  using (public.can_edit_notebook(notebook_id))
  with check (public.can_edit_notebook(notebook_id));

create policy sources_delete_editor on public.sources
  for delete to authenticated
  using (public.can_edit_notebook(notebook_id));

-- ---------------------------------------------------------------------------
-- source_chunks — readable by members, written only by the ingestion worker
-- (service role). No insert/update/delete policy exists for `authenticated`,
-- which denies those verbs by default.
-- ---------------------------------------------------------------------------

create policy chunks_select_member on public.source_chunks
  for select to authenticated
  using (public.is_notebook_member(notebook_id));

-- ---------------------------------------------------------------------------
-- conversations & messages — every member may ask questions, including viewers.
-- ---------------------------------------------------------------------------

create policy conversations_select_member on public.conversations
  for select to authenticated
  using (public.is_notebook_member(notebook_id));

create policy conversations_insert_member on public.conversations
  for insert to authenticated
  with check (public.is_notebook_member(notebook_id) and created_by = (select auth.uid()));

create policy conversations_update_author on public.conversations
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_notebook_owner(notebook_id))
  with check (created_by = (select auth.uid()) or public.is_notebook_owner(notebook_id));

create policy conversations_delete_author on public.conversations
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_notebook_owner(notebook_id));

create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_notebook_member(notebook_id));

create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (public.is_notebook_member(notebook_id));

create policy messages_delete_owner on public.messages
  for delete to authenticated
  using (public.is_notebook_owner(notebook_id));

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------

create policy notes_select_member on public.notes
  for select to authenticated
  using (public.is_notebook_member(notebook_id));

create policy notes_insert_editor on public.notes
  for insert to authenticated
  with check (public.can_edit_notebook(notebook_id) and created_by = (select auth.uid()));

create policy notes_update_editor on public.notes
  for update to authenticated
  using (public.can_edit_notebook(notebook_id))
  with check (public.can_edit_notebook(notebook_id));

create policy notes_delete_editor on public.notes
  for delete to authenticated
  using (public.can_edit_notebook(notebook_id));

-- ---------------------------------------------------------------------------
-- studio_artifacts
-- ---------------------------------------------------------------------------

create policy studio_select_member on public.studio_artifacts
  for select to authenticated
  using (public.is_notebook_member(notebook_id));

create policy studio_insert_editor on public.studio_artifacts
  for insert to authenticated
  with check (public.can_edit_notebook(notebook_id));

create policy studio_delete_editor on public.studio_artifacts
  for delete to authenticated
  using (public.can_edit_notebook(notebook_id));

-- ---------------------------------------------------------------------------
-- audit_events — read-only for notebook owners, append-only via service role.
-- ---------------------------------------------------------------------------

create policy audit_select_owner on public.audit_events
  for select to authenticated
  using (notebook_id is not null and public.is_notebook_owner(notebook_id));
