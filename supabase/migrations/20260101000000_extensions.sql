-- Everlast :: extensions
-- Extensions are installed into the dedicated `extensions` schema so that the
-- public schema stays free of vendor objects (Supabase linter requirement).

create schema if not exists extensions;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;
-- Case-insensitive e-mail comparison without lower() on every lookup.
create extension if not exists "citext" with schema extensions;

-- Make the operators/types resolvable without schema-qualifying every usage.
alter database postgres set search_path to "$user", public, extensions;
