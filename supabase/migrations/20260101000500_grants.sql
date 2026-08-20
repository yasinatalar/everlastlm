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
