-- ROLLBACK-1001. APPLY THIS FILE WHOLE. It contains SQL and plpgsql between dollar quotes. Run this before ROLLBACK-1000.
-- Returns the note table and the notebook search to their 1000 shape. Refuses while any note is on a topic, because that note holds what this removes.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'individual_scholar_note' and column_name = 'topic') then
    if exists (select 1 from individual_scholar_note where target_kind = 'topic' or topic is not null) then
      raise exception 'ROLLBACK-1001 refused: notes linked to a topic exist';
    end if;
  end if;
end $$;

drop function if exists public.individual_scholar_notebook_1001();

create or replace function public.individual_scholar_notebook_search(p_user_id uuid, p_query text, p_limit integer, p_offset integer)
returns table (id uuid, headline text, rank real, total bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with q as (
    select to_tsquery('english', array_to_string(array(
             select quote_literal(w) || ':*'
               from regexp_split_to_table(lower(regexp_replace(left(coalesce(p_query, ''), 200), '[^[:alnum:]]+', ' ', 'g')), ' ') as w
              where w <> ''
              limit 8), ' & ')) as tsq
  ), hits as (
    select n.id, coalesce(n.title || ' ', '') || coalesce(n.body, '') || ' ' || coalesce(n.quote, '') || ' ' || array_to_string(n.tags, ' ') as doc,
           ts_rank(n.search_tsv, q.tsq) as rank, n.updated_at
      from individual_scholar_note n, q
     where n.user_id = p_user_id and n.kind <> 'bookmark' and n.search_tsv @@ q.tsq
  ), page as (
    select h.*, count(*) over () as total
      from hits h
     order by h.rank desc, h.updated_at desc, h.id
     limit least(greatest(coalesce(p_limit, 25), 1), 50)
    offset least(greatest(coalesce(p_offset, 0), 0), 5000)
  )
  select p.id,
         ts_headline('english', replace(replace(p.doc, '{{hl}}', ''), '{{/hl}}', ''), q.tsq,
           'StartSel={{hl}}, StopSel={{/hl}}, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" ... "'),
         p.rank, p.total
    from page p, q
   order by p.rank desc, p.updated_at desc, p.id
$$;

alter table individual_scholar_note drop constraint if exists individual_scholar_note_target_check;
alter table individual_scholar_note add constraint individual_scholar_note_target_check
  check (target_kind in ('artefact', 'lesson', 'material', 'section', 'free')
     and (target_kind <> 'artefact' or artefact_id is not null)
     and (target_kind <> 'lesson' or (session_id is not null and step is not null))
     and (target_kind <> 'material' or material_id is not null)
     and (target_kind <> 'section' or (material_id is not null and chunk_id is not null))
     and (target_kind <> 'free' or (kind = 'note' and client_key is not null and artefact_id is null and material_id is null
          and chunk_id is null and session_id is null and step is null))
     and ((session_id is null) = (step is null))
     and (step is null or step between 0 and 199));

drop index if exists idx_individual_scholar_note_topic;
alter table individual_scholar_note drop column if exists topic;

notify pgrst, 'reload schema';
