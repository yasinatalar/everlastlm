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
