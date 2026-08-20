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
