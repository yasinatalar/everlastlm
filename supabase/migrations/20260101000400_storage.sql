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
