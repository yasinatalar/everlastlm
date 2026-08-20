-- Everlast — complete schema, generated from supabase/migrations/
-- Regenerate with: pnpm db:schema
--
-- Paste into the Supabase SQL Editor to provision a hosted project in one
-- shot. Equivalent to `supabase db push`, which is the repeatable route.

-- ============================================================
-- 20260101000000_extensions.sql
-- ============================================================
-- Everlast :: extensions
-- Extensions are installed into the dedicated `extensions` schema so that the
-- public schema stays free of vendor objects (Supabase linter requirement).

create schema if not exists extensions;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;
-- Case-insensitive e-mail comparison without lower() on every lookup.
create extension if not exists "citext" with schema extensions;

-- Convenience only: every object below is schema-qualified (`extensions.vector`),
-- so nothing depends on this. Guarded because the database is not always named
-- `postgres`, and a hosted role may lack ALTER DATABASE — neither of which
-- should abort the migration.
do $$
begin
  execute format(
    'alter database %I set search_path to "$user", public, extensions',
    current_database()
  );
exception
  when insufficient_privilege or undefined_object then
    raise notice 'skipped search_path default (not permitted here)';
end
$$;

-- ============================================================
-- 20260101000100_core_schema.sql
-- ============================================================
-- Everlast :: core schema
-- One table per aggregate root (+ owned child collections). Every table that
-- holds tenant data carries a `notebook_id` so row level security can be
-- expressed as a single membership check without recursive joins.

-- ---------------------------------------------------------------------------
-- Enumerations (part of the ubiquitous language — see docs/domain-model.md)
-- ---------------------------------------------------------------------------

create type public.notebook_role as enum ('owner', 'editor', 'viewer');

create type public.source_kind as enum ('pdf', 'docx', 'text', 'markdown', 'url');

create type public.source_status as enum (
  'pending',
  'extracting',
  'chunking',
  'embedding',
  'ready',
  'failed'
);

create type public.message_role as enum ('user', 'assistant');

create type public.note_origin as enum ('manual', 'chat', 'studio');

create type public.studio_kind as enum (
  'study_guide',
  'briefing_doc',
  'faq',
  'timeline',
  'audio_overview'
);

create type public.studio_status as enum ('pending', 'generating', 'ready', 'failed');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Mirrored from auth.users so collaborator lists and invite lookups do not
  -- need the admin API. Readable only by the user and their collaborators.
  email extensions.citext unique,
  display_name text check (char_length(display_name) between 1 and 120),
  avatar_url text,
  locale text not null default 'en' check (locale in ('en', 'de')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Application-visible profile mirroring auth.users. Never stores credentials.';

-- ---------------------------------------------------------------------------
-- Notebook aggregate
-- ---------------------------------------------------------------------------

create table public.notebooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  emoji text check (char_length(emoji) <= 8),
  source_count integer not null default 0 check (source_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index notebooks_owner_idx on public.notebooks (owner_id) where deleted_at is null;
create index notebooks_updated_idx on public.notebooks (updated_at desc) where deleted_at is null;

create table public.notebook_members (
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  -- References `profiles` rather than `auth.users` so PostgREST can resolve the
  -- relationship and embed the member's name and avatar in one round trip.
  -- `profiles.id` is itself a cascading FK to `auth.users`, so deleting an
  -- account still removes the membership.
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.notebook_role not null default 'viewer',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (notebook_id, user_id)
);

create index notebook_members_user_idx on public.notebook_members (user_id);

-- ---------------------------------------------------------------------------
-- Source aggregate
-- ---------------------------------------------------------------------------

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  kind public.source_kind not null,
  title text not null check (char_length(title) between 1 and 300),
  origin_uri text check (char_length(origin_uri) <= 2048),
  storage_path text check (char_length(storage_path) <= 1024),
  byte_size bigint check (byte_size >= 0),
  checksum text,
  status public.source_status not null default 'pending',
  failure_reason text,
  summary text,
  key_topics text[] not null default '{}',
  token_count integer not null default 0 check (token_count >= 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sources_notebook_idx on public.sources (notebook_id, created_at desc);
create unique index sources_notebook_checksum_idx
  on public.sources (notebook_id, checksum)
  where checksum is not null;

create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  heading_path text[] not null default '{}',
  page_number integer,
  char_start integer,
  char_end integer,
  token_count integer not null default 0,
  embedding extensions.vector(1024),
  fts tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index source_chunks_notebook_idx on public.source_chunks (notebook_id);
create index source_chunks_source_idx on public.source_chunks (source_id, chunk_index);
create index source_chunks_fts_idx on public.source_chunks using gin (fts);

-- HNSW over cosine distance. Built after ingestion in production; safe here
-- because the table starts empty.
create index source_chunks_embedding_idx
  on public.source_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- Conversation aggregate
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null default 'New chat' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_notebook_idx on public.conversations (notebook_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  role public.message_role not null,
  content text not null default '',
  -- Citation[] as produced by the answering service; see packages/contracts.
  citations jsonb not null default '[]'::jsonb,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Note aggregate
-- ---------------------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null default 'Untitled note' check (char_length(title) <= 200),
  content text not null default '',
  origin public.note_origin not null default 'manual',
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_notebook_idx on public.notes (notebook_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Studio aggregate
-- ---------------------------------------------------------------------------

create table public.studio_artifacts (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  kind public.studio_kind not null,
  status public.studio_status not null default 'pending',
  title text not null default '' check (char_length(title) <= 200),
  content jsonb not null default '{}'::jsonb,
  source_ids uuid[] not null default '{}',
  audio_storage_path text,
  duration_seconds integer check (duration_seconds >= 0),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index studio_artifacts_notebook_idx on public.studio_artifacts (notebook_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit trail (append-only)
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  notebook_id uuid references public.notebooks (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_events_notebook_idx on public.audit_events (notebook_id, created_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger notebooks_touch before update on public.notebooks
  for each row execute function public.touch_updated_at();
create trigger sources_touch before update on public.sources
  for each row execute function public.touch_updated_at();
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();
create trigger studio_artifacts_touch before update on public.studio_artifacts
  for each row execute function public.touch_updated_at();

-- Owner is always a member with role `owner`; keeps membership the single
-- source of truth for authorisation.
create or replace function public.notebooks_add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notebook_members (notebook_id, user_id, role, invited_by)
  values (new.id, new.owner_id, 'owner', new.owner_id)
  on conflict (notebook_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger notebooks_owner_membership after insert on public.notebooks
  for each row execute function public.notebooks_add_owner_membership();

-- Denormalised counters so the notebook list does not need N+1 aggregates.
create or replace function public.sources_sync_notebook_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.notebooks set source_count = source_count + 1 where id = new.notebook_id;
  elsif tg_op = 'DELETE' then
    update public.notebooks
      set source_count = greatest(source_count - 1, 0)
      where id = old.notebook_id;
  end if;
  return null;
end;
$$;

create trigger sources_count_sync
  after insert or delete on public.sources
  for each row execute function public.sources_sync_notebook_count();

-- Mirror new auth users into profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the mirror honest when a user changes their address.
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_new_user();

-- ============================================================
-- 20260101000200_rls_policies.sql
-- ============================================================
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

-- ============================================================
-- 20260101000300_retrieval.sql
-- ============================================================
-- Everlast :: retrieval
--
-- Hybrid retrieval: dense (pgvector / cosine) fused with sparse (Postgres FTS)
-- using Reciprocal Rank Fusion. RRF needs no score normalisation between the
-- two very differently-scaled rankers, which is why it is preferred here over a
-- weighted sum of cosine similarity and ts_rank.
--
-- SECURITY INVOKER (the default) is deliberate: the caller's RLS policies decide
-- which chunks are visible, so this function cannot be used to read across
-- notebooks even if the caller passes an arbitrary p_notebook_id.

create or replace function public.match_source_chunks(
  p_notebook_id uuid,
  p_query_embedding extensions.vector(1024),
  p_query_text text default null,
  p_source_ids uuid[] default null,
  p_match_count integer default 12,
  p_rrf_k integer default 60
)
returns table (
  chunk_id uuid,
  source_id uuid,
  source_title text,
  source_kind public.source_kind,
  chunk_index integer,
  content text,
  heading_path text[],
  page_number integer,
  similarity double precision,
  score double precision
)
language sql
stable
set search_path = ''
as $$
  with pool as (
    select greatest(p_match_count * 4, 40) as size
  ),
  vector_hits as (
    select
      c.id,
      row_number() over (
        order by c.embedding operator(extensions.<=>) p_query_embedding
      ) as rank,
      1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity
    from public.source_chunks c
    where c.notebook_id = p_notebook_id
      and c.embedding is not null
      and (p_source_ids is null or c.source_id = any (p_source_ids))
    order by c.embedding operator(extensions.<=>) p_query_embedding
    limit (select size from pool)
  ),
  keyword_hits as (
    select
      c.id,
      row_number() over (order by ts_rank_cd(c.fts, q.query) desc) as rank
    from public.source_chunks c
    cross join websearch_to_tsquery('simple', coalesce(p_query_text, '')) as q (query)
    where p_query_text is not null
      and c.notebook_id = p_notebook_id
      and (p_source_ids is null or c.source_id = any (p_source_ids))
      and c.fts @@ q.query
    order by ts_rank_cd(c.fts, q.query) desc
    limit (select size from pool)
  ),
  fused as (
    select
      coalesce(v.id, k.id) as id,
      coalesce(1.0 / (p_rrf_k + v.rank), 0.0)
        + coalesce(1.0 / (p_rrf_k + k.rank), 0.0) as score,
      v.similarity
    from vector_hits v
    full outer join keyword_hits k on k.id = v.id
  )
  select
    c.id as chunk_id,
    c.source_id,
    s.title as source_title,
    s.kind as source_kind,
    c.chunk_index,
    c.content,
    c.heading_path,
    c.page_number,
    coalesce(f.similarity, 0.0) as similarity,
    f.score
  from fused f
  join public.source_chunks c on c.id = f.id
  join public.sources s on s.id = c.source_id
  where s.status = 'ready'
  order by f.score desc, c.chunk_index asc
  limit p_match_count;
$$;

revoke execute on function public.match_source_chunks(
  uuid, extensions.vector, text, uuid[], integer, integer
) from public;

grant execute on function public.match_source_chunks(
  uuid, extensions.vector, text, uuid[], integer, integer
) to authenticated, service_role;

comment on function public.match_source_chunks is
  'Hybrid dense+sparse chunk retrieval with reciprocal rank fusion. Runs as SECURITY INVOKER so notebook RLS applies.';

-- ============================================================
-- 20260101000400_storage.sql
-- ============================================================
-- Everlast :: private storage buckets
--
-- Object key convention: {notebook_id}/{source_id}/{sanitised-filename}
-- The first path segment is the tenant boundary, so a single membership check
-- on that segment authorises the object.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sources',
  'sources',
  false,
  52428800, -- 50 MB
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'studio-audio',
  'studio-audio',
  false,
  104857600, -- 100 MB
  array['audio/mpeg', 'audio/mp4', 'audio/wav']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

-- Casting an arbitrary folder name to uuid would raise 22P02 and surface as a
-- 500 rather than a clean deny, so parse defensively.
create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

grant execute on function public.try_uuid(text) to authenticated, service_role;

create or replace function public.storage_notebook_id(p_object_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select public.try_uuid((storage.foldername(p_object_name))[1]);
$$;

grant execute on function public.storage_notebook_id(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Object policies
-- ---------------------------------------------------------------------------

create policy "source objects readable by notebook members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sources'
    and public.is_notebook_member(public.storage_notebook_id(name))
  );

create policy "source objects writable by notebook editors"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sources'
    and public.can_edit_notebook(public.storage_notebook_id(name))
  );

create policy "source objects removable by notebook editors"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sources'
    and public.can_edit_notebook(public.storage_notebook_id(name))
  );

create policy "studio audio readable by notebook members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'studio-audio'
    and public.is_notebook_member(public.storage_notebook_id(name))
  );

-- Studio audio is written by the generation worker (service role) only; no
-- insert policy for `authenticated` means the verb is denied by default.

-- ============================================================
-- 20260101000500_grants.sql
-- ============================================================
-- Everlast :: table privileges
--
-- Current Supabase Postgres images do not hand new tables blanket DML
-- privileges for `anon` / `authenticated` / `service_role` — a fresh table
-- starts with only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Access therefore has
-- to be granted explicitly, which is the better arrangement anyway: it makes
-- the coarse gate visible next to the fine one.
--
-- Two independent layers, and a request must pass both:
--
--   1. GRANT  — which *verbs* a role may attempt on a table at all.
--   2. RLS    — which *rows* that role may see or touch.
--
-- The grants below mirror the policies in `20260101000200_rls_policies.sql`
-- exactly. Where a table has no policy for a verb, the verb is not granted
-- either, so the denial happens at the cheaper layer.

grant usage on schema public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- authenticated — the browser's role. Every statement is additionally filtered
-- by row level security.
-- ---------------------------------------------------------------------------

-- A user edits only their own profile row.
grant select, update on public.profiles to authenticated;

grant select, insert, update, delete on public.notebooks to authenticated;
grant select, insert, update, delete on public.notebook_members to authenticated;
grant select, insert, update, delete on public.sources to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.notes to authenticated;

-- Chunks and embeddings are produced by the ingestion pipeline. Read-only here
-- means a forged embedding cannot be inserted through the public API even if a
-- policy were added by mistake.
grant select on public.source_chunks to authenticated;

-- Messages are appended and read; an edited message would silently invalidate
-- the citations stored alongside it, so UPDATE is withheld.
grant select, insert, delete on public.messages to authenticated;

-- Studio artifacts are generated, then kept or discarded — never hand-edited.
grant select, insert, delete on public.studio_artifacts to authenticated;

-- The audit trail is append-only from the application's perspective: owners may
-- read their notebook's history and nobody may alter it.
grant select on public.audit_events to authenticated;

-- ---------------------------------------------------------------------------
-- service_role — the API's own identity. Bypasses RLS, so this is the only
-- boundary it has; it is used exclusively by the ingestion pipeline, the audit
-- writer and the invite lookup.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- anon — pre-authentication only. It reaches auth endpoints and nothing else.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

