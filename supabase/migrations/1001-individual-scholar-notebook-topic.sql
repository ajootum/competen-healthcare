-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains SQL functions between dollar quotes.
-- ====================================================================================================
-- MIGRATION 1001: COMPETEN SCHOLAR -- TOPIC-LINKED NOTES (COMPETEN-NOTEBOOK-001 P1, register CE-02-1)
--
-- Owner decision of 6 Nov 2026, "Coordinated Learning Experience Completion", in their words: "Permit optional topic-linked and
-- free-standing notebook entries." Additive, on the 820 note table as widened by 1000. No new table.
--
-- 1. THE TOPIC TARGET. target_kind topic with a new nullable column, topic: the words of one of the learner own topics, or their own.
--    A topic is a label in this product, not a row with an id (the 414 session topic and the section topics are text), so there is nothing
--    for a foreign key to point at. Same bounds as the 414 session topic, 2 to 120 characters. Only a note written through the Notebook
--    may be on a topic (kind note, client_key set), which also keeps it out of the Ask saved-learning source, as 1000 does for a free note.
--    A topic note holds no artefact, material, section or lesson, so no cascade or detach reaches it.
--
-- 2. SEARCH. individual_scholar_notebook_search also finds a note by its topic. The result and signature are unchanged. Topic is matched
--    beside search_tsv, within one learner rows, so no index or generated column changes. The library search is left as 1000 made it.
--
-- 3. THE MARKER. individual_scholar_notebook_1001() returns true. The application asks it, and offers the Notebook only where it answers, so
--    no statement names the topic column while 1001 is absent. SECURITY INVOKER, reads nothing, service_role only.
--
-- PRIVATE AND ERASABLE. No RLS change. Nothing here is read by Professional, by any employer surface or by the HQ plane. No AI.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 1000: apply 1000, then 1001. Re-running it is
-- a no-op. Rollback: docs/evidence/COMPETEN-NOTEBOOK-001/ROLLBACK-1001.sql (refuses while any topic note exists).
--
-- FAIL CLOSED WITHOUT IT. The marker is absent, so policy scholar_personal_notebook cannot turn anything on, exactly as without 1000.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_note add column if not exists topic text;

alter table individual_scholar_note drop constraint if exists individual_scholar_note_target_check;
alter table individual_scholar_note add constraint individual_scholar_note_target_check
  check (target_kind in ('artefact', 'lesson', 'material', 'section', 'free', 'topic')
     and (target_kind <> 'artefact' or artefact_id is not null)
     and (target_kind <> 'lesson' or (session_id is not null and step is not null))
     and (target_kind <> 'material' or material_id is not null)
     and (target_kind <> 'section' or (material_id is not null and chunk_id is not null))
     and (target_kind not in ('free', 'topic') or (kind = 'note' and client_key is not null and artefact_id is null and material_id is null
          and chunk_id is null and session_id is null and step is null))
     and ((target_kind = 'topic') = (topic is not null))
     and (topic is null or char_length(btrim(topic)) between 2 and 120)
     and ((session_id is null) = (step is null))
     and (step is null or step between 0 and 199));

create index if not exists idx_individual_scholar_note_topic
  on individual_scholar_note(user_id, topic);

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
    select n.id, coalesce(n.title || ' ', '') || coalesce(n.body, '') || ' ' || coalesce(n.quote, '') || ' ' || array_to_string(n.tags, ' ') || ' ' || coalesce(n.topic, '') as doc,
           ts_rank(n.search_tsv || to_tsvector('english', coalesce(n.topic, '')), q.tsq) as rank, n.updated_at
      from individual_scholar_note n, q
     where n.user_id = p_user_id and n.kind <> 'bookmark' and (n.search_tsv || to_tsvector('english', coalesce(n.topic, ''))) @@ q.tsq
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

create or replace function public.individual_scholar_notebook_1001()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select true
$$;

revoke all on function public.individual_scholar_notebook_1001() from public;
revoke all on function public.individual_scholar_notebook_1001() from anon, authenticated;
grant execute on function public.individual_scholar_notebook_1001() to service_role;
revoke all on function public.individual_scholar_notebook_search(uuid, text, integer, integer) from public;
revoke all on function public.individual_scholar_notebook_search(uuid, text, integer, integer) from anon, authenticated;
grant execute on function public.individual_scholar_notebook_search(uuid, text, integer, integer) to service_role;

comment on column individual_scholar_note.topic is
  'COMPETEN-NOTEBOOK-001 (1001). The words of the topic a note is linked to, written only by the learner. Optional. A topic is a label in this product, so there is no id to key on.';

notify pgrst, 'reload schema';
