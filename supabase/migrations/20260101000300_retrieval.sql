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
