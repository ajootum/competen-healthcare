-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains two SQL functions between dollar quotes.
-- ====================================================================================================
-- MIGRATION 992: COMPETEN SCHOLAR -- MY SEARCH HISTORY (SCHOLAR-SEARCH-HISTORY-01)
--
-- Owner directive 4 Nov 2026, "COMPETEN SCHOLAR -- MY SEARCH HISTORY" (P1, SALE learner continuity). One private,
-- searchable history of a learner own searches, AI questions and earlier learning, inside the Personal Learning
-- Library (820). Additive only: one new table and two functions. No existing table, column, constraint or row changes.
--
-- 1. THE HISTORY TABLE. individual_scholar_search_history, one row per learner-owned entry, of two origins.
--    captured   a search or question the learner SUBMITTED after this migration: a Learn material search, a library
--               search or an Ask Scholar question. The learner own words (2 to 300 characters, no control characters),
--               an optional topic, references (material, section hint, saved teaching, lesson and step) and the result
--               count. Never an answer: Scholar does not keep Ask answers (owner ruling D10) and saved teaching is
--               referenced by id, never copied. request_key is the client key of one submission (c: then 16 to 64 of
--               A-Z a-z 0-9 _ -), unique per learner, so a retried request is the same row and never a duplicate.
--    recovered  a MARK on an existing record that the list below already shows: the learner pinned it or removed it
--               from the history. request_key names the record (artefact:id or lesson:id). A mark copies nothing and
--               never changes the record it is about. Removing an entry from the history never deletes saved
--               teaching, a lesson, an assessment attempt, learning evidence or a source material.
--    Composite foreign keys onto the learner own material, saved teaching and lesson (ON DELETE SET NULL on the one
--    column), so another learner record is unreferenceable and a deleted record leaves the words of the search. A
--    generated english tsvector of the words and topic, GIN. One plain unique index on (user_id, request_key), which
--    is also the ON CONFLICT target. Needs PostgreSQL 15 or later (SET NULL on one column), as 820.
--
-- 2. THE LIST. individual_scholar_search_history_list(...): newest first, one deterministic list of
--    the captured entries, and the learner EXISTING records recovered at read time (nothing is backfilled or invented):
--    every current saved teaching (415 and 820, a teaching or, where it includes research, a research entry) and every
--    lesson (414 learning session). Recovered entries the learner removed are left out and pinned ones are marked.
--    Full text (websearch_to_tsquery english) over the words, the saved teaching and the lesson title and topic, and
--    filters for activity, material, topic, date range and pinned. ts_headline snippets marked {{hl}} and {{/hl}}, as
--    820. Every branch is keyed on p_user_id.
--
-- 3. CLEAR. individual_scholar_search_history_clear(p_user_id): deletes every captured entry of the learner and marks
--    every recovered record removed, in one statement. It touches nothing but this table.
--
-- Both functions SECURITY INVOKER, executable by service_role only, called by the Scholar server with the caller own
-- id. No AI anywhere. The history is never read by Personal AI memory, by Professional, by an employer, by an
-- educator or by the HQ plane.
--
-- PRIVATE AND ERASABLE. RLS on, read own. Learner owned under user_id, ON DELETE CASCADE from profiles. Kept until the
-- learner deletes it (owner retention decision 4 Nov 2026): deleting an entry or clearing deletes the primary rows at
-- once, and backups follow the documented backup and retention policy. No other retention rule is set here.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 372, 414, 415, 820.
-- Re-running it is a no-op. Rollback: docs/evidence/SEARCH-HISTORY/ROLLBACK-992.sql (refuses while any entry exists).
--
-- FAIL CLOSED WITHOUT IT. The server detects the list function. Without it the history page says it is not available
-- yet, the history route answers 409 and records nothing, and every other page is unchanged.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE HISTORY TABLE ---------------------------------------------------------------------------------

create table if not exists individual_scholar_search_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  origin        text not null,
  activity      text not null,
  query         text,
  topic         text,
  material_id   uuid,
  chunk_id      uuid,
  artefact_id   uuid,
  session_id    uuid,
  step          integer,
  result_count  integer,
  request_key   text not null,
  pinned_at     timestamptz,
  hidden_at     timestamptz,
  created_at    timestamptz not null default now(),
  constraint individual_scholar_search_history_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete set null (material_id),
  constraint individual_scholar_search_history_artefact_fk foreign key (artefact_id, user_id)
    references individual_scholar_artefact(id, user_id) on delete set null (artefact_id),
  constraint individual_scholar_search_history_session_fk foreign key (session_id, user_id)
    references individual_scholar_learning_session(id, user_id) on delete set null (session_id)
);

alter table individual_scholar_search_history add column if not exists tsv tsvector
  generated always as (to_tsvector('english', coalesce(query, '') || ' ' || coalesce(topic, ''))) stored;

alter table individual_scholar_search_history drop constraint if exists individual_scholar_search_history_entry_check;
alter table individual_scholar_search_history add constraint individual_scholar_search_history_entry_check
  check (origin in ('captured', 'recovered')
     and (origin <> 'captured' or (activity in ('material_search', 'library_search', 'ask')
          and query is not null and char_length(btrim(query)) between 2 and 300 and query !~ '[[:cntrl:]]'
          and request_key ~ '^c:[A-Za-z0-9_-]{16,64}$'
          and hidden_at is null))
     and (origin <> 'recovered' or (query is null and topic is null and result_count is null and chunk_id is null and step is null
          and material_id is null and (pinned_at is not null or hidden_at is not null)
          and ((activity = 'teaching' and session_id is null and request_key ~ '^artefact:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                and (artefact_id is null or request_key = 'artefact:' || artefact_id::text))
            or (activity = 'lesson' and artefact_id is null and request_key ~ '^lesson:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                and (session_id is null or request_key = 'lesson:' || session_id::text)))))
     and (topic is null or char_length(btrim(topic)) between 2 and 120)
     and (step is null or step between 0 and 199)
     and (result_count is null or result_count between 0 and 100000));

create unique index if not exists ux_individual_scholar_search_history_key
  on individual_scholar_search_history(user_id, request_key);
create index if not exists idx_individual_scholar_search_history_recent
  on individual_scholar_search_history(user_id, created_at desc, id desc);
create index if not exists idx_individual_scholar_search_history_tsv
  on individual_scholar_search_history using gin (tsv);

alter table individual_scholar_search_history enable row level security;

drop policy if exists individual_scholar_search_history_read_own on individual_scholar_search_history;
create policy individual_scholar_search_history_read_own on individual_scholar_search_history
  for select using (auth.uid() = user_id);

-- ---- 2. THE LIST: captured entries and the learner existing records, newest first -------------------------

create or replace function public.individual_scholar_search_history_list(p_user_id uuid, p_query text, p_activity text, p_material uuid,
  p_topic text, p_from timestamptz, p_to timestamptz, p_pinned boolean, p_limit integer, p_offset integer)
returns table (entry_key text, origin text, activity text, history_id uuid, query text, topic text, material_id uuid, chunk_id uuid,
  artefact_id uuid, session_id uuid, step integer, result_count integer, label text, headline text, pinned_at timestamptz,
  created_at timestamptz, total bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with q as (
    select case when btrim(coalesce(p_query, '')) = '' then null::tsquery else websearch_to_tsquery('english', left(p_query, 200)) end as tsq,
           nullif(lower(btrim(coalesce(p_topic, ''))), '') as topic
  ), marks as (
    select m.request_key, m.pinned_at, m.hidden_at
      from individual_scholar_search_history m
     where m.user_id = p_user_id and m.origin = 'recovered'
  ), hits as (
    select 'h:' || h.id::text as entry_key, 'captured'::text as origin, h.activity, h.id as history_id, h.query, h.topic, h.material_id,
           h.chunk_id, h.artefact_id, h.session_id, h.step, h.result_count, h.query as label,
           coalesce(h.query, '') || ' ' || coalesce(h.topic, '') as doc, h.pinned_at, h.created_at
      from individual_scholar_search_history h, q
     where h.user_id = p_user_id and h.origin = 'captured'
       and (q.tsq is null or h.tsv @@ q.tsq)
       and (q.topic is null or lower(h.topic) = q.topic)
       and (p_material is null or h.material_id = p_material)
    union all
    select 'artefact:' || a.id::text, 'recovered',
           case when a.content ~* '(^|\n)[\s*_#>-]*FROM RESEARCH' or a.refs @> '[{"kind":"external"}]'::jsonb then 'research' else 'teaching' end,
           null::uuid, null::text, s.topic, a.material_id, null::uuid, a.id, a.session_id, a.step, null::integer, a.action,
           a.content, mk.pinned_at, a.created_at
      from individual_scholar_artefact a
      left join individual_scholar_learning_session s on s.id = a.session_id and s.user_id = p_user_id
      left join marks mk on mk.request_key = 'artefact:' || a.id::text,
           q
     where a.user_id = p_user_id and a.superseded_at is null and mk.hidden_at is null
       and (q.tsq is null or a.tsv @@ q.tsq)
       and (q.topic is null or lower(s.topic) = q.topic)
       and (p_material is null or a.material_id = p_material)
    union all
    select 'lesson:' || s.id::text, 'recovered', 'lesson', null::uuid, null::text, s.topic,
           (select st.material_id from individual_scholar_learning_step st where st.session_id = s.id and st.user_id = p_user_id order by st.step limit 1),
           null::uuid, null::uuid, s.id, null::integer, null::integer, s.title, s.title || coalesce(' ' || s.topic, ''), mk.pinned_at, s.created_at
      from individual_scholar_learning_session s
      left join marks mk on mk.request_key = 'lesson:' || s.id::text,
           q
     where s.user_id = p_user_id and mk.hidden_at is null
       and (q.tsq is null or to_tsvector('english', s.title || ' ' || coalesce(s.topic, '')) @@ q.tsq)
       and (q.topic is null or lower(s.topic) = q.topic)
       and (p_material is null or exists (select 1 from individual_scholar_learning_step st
                                           where st.session_id = s.id and st.user_id = p_user_id and st.material_id = p_material))
  ), page as (
    select x.*, count(*) over () as total
      from hits x
     where (p_activity is null or x.activity = p_activity)
       and (p_from is null or x.created_at >= p_from)
       and (p_to is null or x.created_at < p_to)
       and (not coalesce(p_pinned, false) or x.pinned_at is not null)
     order by x.created_at desc, x.entry_key
     limit least(greatest(coalesce(p_limit, 25), 1), 50)
    offset least(greatest(coalesce(p_offset, 0), 0), 5000)
  )
  select p.entry_key, p.origin, p.activity, p.history_id, p.query, p.topic, p.material_id, p.chunk_id, p.artefact_id, p.session_id,
         p.step, p.result_count, left(p.label, 300),
         case when q.tsq is null then null::text
              else ts_headline('english', replace(replace(left(p.doc, 20000), '{{hl}}', ''), '{{/hl}}', ''), q.tsq,
                'StartSel={{hl}}, StopSel={{/hl}}, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" ... "') end,
         p.pinned_at, p.created_at, p.total
    from page p, q
   order by p.created_at desc, p.entry_key
$$;

revoke all on function public.individual_scholar_search_history_list(uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, integer, integer) from public;
revoke all on function public.individual_scholar_search_history_list(uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, integer, integer) from anon, authenticated;
grant execute on function public.individual_scholar_search_history_list(uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, integer, integer) to service_role;

-- ---- 3. CLEAR: every captured entry deleted, every recovered record marked removed ------------------------

create or replace function public.individual_scholar_search_history_clear(p_user_id uuid)
returns bigint
language sql
volatile
security invoker
set search_path = public, pg_catalog
as $$
  with gone as (
    delete from individual_scholar_search_history
     where user_id = p_user_id and origin = 'captured'
    returning 1
  ), teaching as (
    insert into individual_scholar_search_history (user_id, origin, activity, artefact_id, request_key, hidden_at)
    select a.user_id, 'recovered', 'teaching', a.id, 'artefact:' || a.id::text, now()
      from individual_scholar_artefact a
     where a.user_id = p_user_id and a.superseded_at is null
    on conflict (user_id, request_key) do update set hidden_at = excluded.hidden_at, pinned_at = null
    returning 1
  ), lessons as (
    insert into individual_scholar_search_history (user_id, origin, activity, session_id, request_key, hidden_at)
    select s.user_id, 'recovered', 'lesson', s.id, 'lesson:' || s.id::text, now()
      from individual_scholar_learning_session s
     where s.user_id = p_user_id
    on conflict (user_id, request_key) do update set hidden_at = excluded.hidden_at, pinned_at = null
    returning 1
  )
  select (select count(*) from gone) + (select count(*) from teaching) + (select count(*) from lessons)
$$;

revoke all on function public.individual_scholar_search_history_clear(uuid) from public;
revoke all on function public.individual_scholar_search_history_clear(uuid) from anon, authenticated;
grant execute on function public.individual_scholar_search_history_clear(uuid) to service_role;

-- ---- COMMENTS ---------------------------------------------------------------------------------------------

comment on table individual_scholar_search_history is
  'SCHOLAR-SEARCH-HISTORY-01 (992). The learner own search history: searches and questions they submitted (captured, their words and references, never an answer) and their pins and removals on existing records (recovered marks). Private, never AI memory, never assessment evidence, never read by HQ, employers or educators. Kept until the learner deletes it.';
comment on column individual_scholar_search_history.request_key is
  'SCHOLAR-SEARCH-HISTORY-01 (992). captured: the client key of one submission, so a retry is the same row. recovered: the record it marks, artefact:id or lesson:id.';
comment on function public.individual_scholar_search_history_list(uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, integer, integer) is
  'SCHOLAR-SEARCH-HISTORY-01 (992). One learner history, newest first: captured entries plus current saved teaching and lessons read at request time, without removed ones. Full text and filters. No AI. service_role only, called with the caller own id.';
comment on function public.individual_scholar_search_history_clear(uuid) is
  'SCHOLAR-SEARCH-HISTORY-01 (992). Clears one learner history: deletes their captured entries and marks every recovered record removed. Touches no other table. service_role only.';

notify pgrst, 'reload schema';
