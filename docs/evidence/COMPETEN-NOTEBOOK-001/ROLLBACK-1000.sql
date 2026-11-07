-- ROLLBACK-1000. APPLY THIS FILE WHOLE. It contains plpgsql and SQL functions between dollar quotes.
-- Returns individual_scholar_note and its functions to their 820 and 975 shape. Refuses while any note written through
-- the Notebook exists, because those notes hold what this would remove. Rows from before 1000 are untouched.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'individual_scholar_note' and column_name = 'client_key') then
    if exists (select 1 from individual_scholar_note where client_key is not null or target_kind = 'free') then
      raise exception 'ROLLBACK-1000 refused: notes written through the Notebook exist';
    end if;
    if exists (select 1 from individual_scholar_note where pinned_at is not null or title is not null or cardinality(tags) > 0 or char_length(coalesce(body, '')) > 4000) then
      raise exception 'ROLLBACK-1000 refused: notes hold a title, a tag, a pin or more than 4000 characters';
    end if;
  end if;
end $$;

drop trigger if exists individual_scholar_note_detach_material on individual_scholar_material;
drop trigger if exists individual_scholar_note_detach_session on individual_scholar_learning_session;
drop function if exists public.individual_scholar_note_detach_material();
drop function if exists public.individual_scholar_note_detach_session();
drop function if exists public.individual_scholar_notebook_1000();
drop function if exists public.individual_scholar_notebook_search(uuid, text, integer, integer);

create or replace function public.individual_scholar_note_touch()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  new.user_id := old.user_id;
  return new;
end;
$$;

create or replace function public.individual_scholar_library_search(p_user_id uuid, p_query text, p_limit integer, p_offset integer)
returns table (kind text, id uuid, material_id uuid, session_id uuid, step integer, artefact_id uuid, chunk_id uuid,
  label text, headline text, rank real, created_at timestamptz, total bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with q as (
    select websearch_to_tsquery('english', left(coalesce(p_query, ''), 200)) as tsq
  ), hits as (
    select 'artefact'::text as kind, a.id, a.material_id, a.session_id, a.step, a.id as artefact_id, null::uuid as chunk_id,
           a.action as label, a.content as doc, ts_rank(a.tsv, q.tsq) as rank, a.created_at
      from individual_scholar_artefact a, q
     where a.user_id = p_user_id and a.superseded_at is null and a.tsv @@ q.tsq
    union all
    select 'note', n.id, n.material_id, n.session_id, n.step, n.artefact_id, n.chunk_id,
           n.kind, coalesce(n.body, '') || ' ' || coalesce(n.quote, ''), ts_rank(n.tsv, q.tsq), n.created_at
      from individual_scholar_note n, q
     where n.user_id = p_user_id and n.tsv @@ q.tsq
    union all
    select 'lesson', s.id, null::uuid, s.id, null::integer, null::uuid, null::uuid,
           s.status, s.title || coalesce(' ' || s.topic, ''), ts_rank(to_tsvector('english', s.title || ' ' || coalesce(s.topic, '')), q.tsq), s.last_active_at
      from individual_scholar_learning_session s, q
     where s.user_id = p_user_id and to_tsvector('english', s.title || ' ' || coalesce(s.topic, '')) @@ q.tsq
    union all
    select 'flashcard', c.id, c.material_id, null::uuid, null::integer, null::uuid, c.chunk_id,
           c.stem, c.stem || ' ' || coalesce(c.answer ->> 'back', ''), ts_rank(to_tsvector('english', c.stem || ' ' || coalesce(c.answer ->> 'back', '')), q.tsq), c.created_at
      from individual_scholar_question c, q
     where c.user_id = p_user_id and c.kind = 'flashcard' and to_tsvector('english', c.stem || ' ' || coalesce(c.answer ->> 'back', '')) @@ q.tsq
    union all
    select 'card_note', m.question_id, c.material_id, null::uuid, null::integer, null::uuid, c.chunk_id,
           c.stem, m.note, ts_rank(to_tsvector('english', m.note), q.tsq), m.updated_at
      from individual_scholar_flashcard_mark m
      join individual_scholar_question c on c.id = m.question_id and c.user_id = p_user_id, q
     where m.user_id = p_user_id and m.note is not null and to_tsvector('english', m.note) @@ q.tsq
  ), page as (
    select h.*, count(*) over () as total
      from hits h
     order by h.rank desc, h.created_at desc, h.id
     limit least(greatest(coalesce(p_limit, 25), 1), 50)
    offset least(greatest(coalesce(p_offset, 0), 0), 5000)
  )
  select p.kind, p.id, p.material_id, p.session_id, p.step, p.artefact_id, p.chunk_id, left(p.label, 300),
         ts_headline('english', replace(replace(p.doc, '{{hl}}', ''), '{{/hl}}', ''), q.tsq,
           'StartSel={{hl}}, StopSel={{/hl}}, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" ... "'),
         p.rank, p.created_at, p.total
    from page p, q
   order by p.rank desc, p.created_at desc, p.id
$$;

alter table individual_scholar_note drop constraint if exists individual_scholar_note_notebook_check;
alter table individual_scholar_note drop constraint if exists individual_scholar_note_target_check;
alter table individual_scholar_note add constraint individual_scholar_note_target_check
  check (target_kind in ('artefact', 'lesson', 'material', 'section')
     and (target_kind <> 'artefact' or artefact_id is not null)
     and (target_kind <> 'lesson' or (session_id is not null and step is not null))
     and (target_kind <> 'material' or material_id is not null)
     and (target_kind <> 'section' or (material_id is not null and chunk_id is not null))
     and ((session_id is null) = (step is null))
     and (step is null or step between 0 and 199));
alter table individual_scholar_note drop constraint if exists individual_scholar_note_kind_check;
alter table individual_scholar_note add constraint individual_scholar_note_kind_check
  check (kind in ('note', 'bookmark', 'highlight', 'summary')
     and (kind <> 'note' or (body is not null and char_length(btrim(body)) between 1 and 4000 and quote is null))
     and (kind <> 'summary' or (body is not null and char_length(btrim(body)) between 1 and 4000 and quote is null))
     and (kind <> 'bookmark' or (body is null and quote is null))
     and (kind <> 'highlight' or (quote is not null and char_length(btrim(quote)) between 1 and 500
          and (body is null or char_length(btrim(body)) between 1 and 4000))));

alter table individual_scholar_note drop constraint if exists individual_scholar_note_study_fk;
drop index if exists ux_individual_scholar_note_client_key;
drop index if exists idx_individual_scholar_note_recent;
drop index if exists idx_individual_scholar_note_pinned;
drop index if exists idx_individual_scholar_note_chunk;
drop index if exists idx_individual_scholar_note_tags;
drop index if exists idx_individual_scholar_note_search_tsv;
alter table individual_scholar_note drop column if exists search_tsv;
drop function if exists public.individual_scholar_note_search_doc(text, text[], text, text);
alter table individual_scholar_note drop column if exists title;
alter table individual_scholar_note drop column if exists tags;
alter table individual_scholar_note drop column if exists pinned_at;
alter table individual_scholar_note drop column if exists client_key;
alter table individual_scholar_note drop column if exists revision;
alter table individual_scholar_note drop column if exists section_label;
alter table individual_scholar_note drop column if exists section_anchor;
alter table individual_scholar_note drop column if exists captured_in;
alter table individual_scholar_note drop column if exists competency_id;
alter table individual_scholar_note drop column if exists study_id;
alter table individual_scholar_note drop column if exists was_on;

notify pgrst, 'reload schema';
