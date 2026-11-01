-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql trigger function and one SQL search function between dollar quotes.
-- ====================================================================================================
-- MIGRATION 820: COMPETEN SCHOLAR -- THE PERSONAL LEARNING LIBRARY (SCHOLAR-LIBRARY-01)
--
-- Owner instruction 1 Nov 2026, "Competen Scholar -- Persistent Learning Library and Search" (GO to implement), and the
-- coordinator additions of the same day (flashcards in search, linked versus matched lessons, version history, deck
-- archive column). Additive only: one new table, new nullable columns, indexes, one widened CHECK, two functions.
--
-- 1. LEARNER NOTES, BOOKMARKS AND HIGHLIGHTS. individual_scholar_note, written only by the learner. target_kind says
--    what it is attached to: an artefact (a saved teaching), a lesson (a 414 session and step), a material or a
--    section (a material and one of its chunks). kind note (a body), bookmark (no text) or highlight (a quote of at
--    most 500 characters from the lesson, with an optional comment). Composite foreign keys onto the learner own
--    artefact, material and session, ON DELETE CASCADE, so a note on another learner record is unstorable and goes with
--    what it is about. chunk_id is a hint only (no foreign key, as 790 section_chunk_id) and is checked by the store.
--    One bookmark per target, by a generated bookmark_key under a plain unique index (null for every other kind, and
--    nulls are distinct, so no partial unique index is needed). A generated english tsvector of body and quote, GIN.
--
-- 2. ARTEFACT FULL TEXT. A generated stored english tsvector of content and background on individual_scholar_artefact,
--    GIN indexed. Written by the database, never by the application.
--
-- 3. THE LESSON LINK. Nullable session_id and step on individual_scholar_artefact, written on NEW saves only, when the
--    request was for a lesson of the learner own recorded session. Old rows stay null: the application may MATCH them
--    to a lesson by its exact chunk set (learn-journey coversLesson) and labels that "matched by sections", never
--    "linked". Composite foreign key onto the learner own session with ON DELETE SET NULL (session_id) only, so a
--    deleted session leaves the teaching (it belongs to its material) and drops the link. Needs PostgreSQL 15 or later.
--
-- 4. REFRESH KEEPS THE ORIGINAL. superseded_at on individual_scholar_artefact. A refresh no longer deletes the saved
--    teaching: the store marks the previous row superseded (superseded_at set, dedupe_key rewritten to
--    key:superseded:id so the existing unique (user_id, dedupe_key) still holds) and inserts the new one. The 415
--    content CHECK is widened to accept exactly that suffix, and a new CHECK ties the suffix to superseded_at. Reads of
--    a saved lesson use the newest row that is not superseded. Earlier versions stay readable.
--
-- 5. SEARCH. individual_scholar_library_search(p_user_id, p_query, p_limit, p_offset): one deterministic full-text
--    search (websearch_to_tsquery english, ts_rank then recency) over the learner own current saved teaching, notes,
--    session titles, flashcards (front and back) and flashcard notes, with ts_headline snippets marked by the plain
--    text markers {{hl}} and {{/hl}} that the page renders as mark elements (never as HTML). Every branch is keyed on
--    p_user_id. SECURITY INVOKER, executable by service_role only, called by the Scholar store with the caller own id.
--    An expression GIN index serves the flashcard branch. No AI anywhere.
--
-- 6. DECK ARCHIVE. archived_at on individual_scholar_flashcard_deck (730), for the flashcards archive work, which
--    fails closed while it is absent.
--
-- PRIVATE AND ERASABLE. RLS on the new table, read own. No table grants. Everything stays Individual owned under
-- user_id and is never read by Professional or by any employer surface.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 372, 414, 415, 416, 730.
-- Re-running it is a no-op. Rollback: ROLLBACK-820.sql (refuses while any note, superseded version or archived deck
-- exists).
--
-- FAIL CLOSED WITHOUT IT. The store detects 820. Without it the library still lists and filters, search falls back to
-- a basic match over the newest saved teaching and says so, notes are hidden, and a refresh replaces as before.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ====================================================================================================

-- ---- 1. LEARNER NOTES, BOOKMARKS AND HIGHLIGHTS -----------------------------------------------------------

create table if not exists individual_scholar_note (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  target_kind  text not null,
  artefact_id  uuid,
  material_id  uuid,
  chunk_id     uuid,
  session_id   uuid,
  step         integer,
  kind         text not null,
  body         text,
  quote        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint individual_scholar_note_artefact_fk foreign key (artefact_id, user_id)
    references individual_scholar_artefact(id, user_id) on delete cascade,
  constraint individual_scholar_note_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade,
  constraint individual_scholar_note_session_fk foreign key (session_id, user_id)
    references individual_scholar_learning_session(id, user_id) on delete cascade
);

alter table individual_scholar_note add column if not exists tsv tsvector
  generated always as (to_tsvector('english', coalesce(body, '') || ' ' || coalesce(quote, ''))) stored;
alter table individual_scholar_note add column if not exists bookmark_key text
  generated always as (case when kind = 'bookmark' then target_kind || ':' || coalesce(artefact_id::text, '') || ':' || coalesce(material_id::text, '')
    || ':' || coalesce(chunk_id::text, '') || ':' || coalesce(session_id::text, '') || ':' || coalesce(step::text, '') end) stored;

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
  check (kind in ('note', 'bookmark', 'highlight')
     and (kind <> 'note' or (body is not null and char_length(btrim(body)) between 1 and 4000 and quote is null))
     and (kind <> 'bookmark' or (body is null and quote is null))
     and (kind <> 'highlight' or (quote is not null and char_length(btrim(quote)) between 1 and 500
          and (body is null or char_length(btrim(body)) between 1 and 4000))));

create unique index if not exists ux_individual_scholar_note_bookmark
  on individual_scholar_note(user_id, bookmark_key);
create index if not exists idx_individual_scholar_note_user
  on individual_scholar_note(user_id, created_at desc);
create index if not exists idx_individual_scholar_note_artefact
  on individual_scholar_note(user_id, artefact_id);
create index if not exists idx_individual_scholar_note_lesson
  on individual_scholar_note(user_id, session_id, step);
create index if not exists idx_individual_scholar_note_tsv
  on individual_scholar_note using gin (tsv);

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

drop trigger if exists individual_scholar_note_touch on individual_scholar_note;
create trigger individual_scholar_note_touch before update on individual_scholar_note
  for each row execute function public.individual_scholar_note_touch();

alter table individual_scholar_note enable row level security;

drop policy if exists individual_scholar_note_read_own on individual_scholar_note;
create policy individual_scholar_note_read_own on individual_scholar_note
  for select using (auth.uid() = user_id);

-- ---- 2, 3 AND 4. THE ARTEFACT: FULL TEXT, LESSON LINK, KEPT VERSIONS --------------------------------------

alter table individual_scholar_artefact add column if not exists tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, '') || ' ' || coalesce(background, ''))) stored;
alter table individual_scholar_artefact add column if not exists session_id uuid;
alter table individual_scholar_artefact add column if not exists step integer;
alter table individual_scholar_artefact add column if not exists superseded_at timestamptz;

alter table individual_scholar_artefact drop constraint if exists individual_scholar_artefact_session_fk;
alter table individual_scholar_artefact add constraint individual_scholar_artefact_session_fk foreign key (session_id, user_id)
  references individual_scholar_learning_session(id, user_id) on delete set null (session_id);

-- The 415 content CHECK, unchanged but for the dedupe_key pattern, which now also accepts key:superseded:id.
alter table individual_scholar_artefact drop constraint if exists individual_scholar_artefact_content_check;
alter table individual_scholar_artefact add constraint individual_scholar_artefact_content_check
  check (char_length(content) between 1 and 20000
     and (background is null or char_length(background) between 1 and 2000)
     and jsonb_typeof(flags) = 'array' and jsonb_typeof(refs) = 'array'
     and dedupe_key ~ '^[0-9a-f]{64}(:superseded:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
     and char_length(model) between 1 and 200 and char_length(prompt_version) between 1 and 200);

alter table individual_scholar_artefact drop constraint if exists individual_scholar_artefact_library_check;
alter table individual_scholar_artefact add constraint individual_scholar_artefact_library_check
  check ((superseded_at is null) = (position(':superseded:' in dedupe_key) = 0)
     and (step is null or step between 0 and 199)
     and (session_id is null or step is not null));

create index if not exists idx_individual_scholar_artefact_tsv
  on individual_scholar_artefact using gin (tsv);
create index if not exists idx_individual_scholar_artefact_recent
  on individual_scholar_artefact(user_id, created_at desc, id desc);
create index if not exists idx_individual_scholar_artefact_lesson
  on individual_scholar_artefact(user_id, session_id, step);

-- ---- 5. SEARCH: one deterministic full-text query over the learner own records ----------------------------

create index if not exists idx_individual_scholar_question_card_tsv
  on individual_scholar_question using gin (to_tsvector('english', stem || ' ' || coalesce(answer ->> 'back', '')));

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

revoke execute on function public.individual_scholar_library_search(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.individual_scholar_library_search(uuid, text, integer, integer) to service_role;
revoke execute on function public.individual_scholar_note_touch() from public, anon, authenticated;

-- ---- 6. DECK ARCHIVE --------------------------------------------------------------------------------------

alter table individual_scholar_flashcard_deck add column if not exists archived_at timestamptz;

-- ---- COMMENTS ---------------------------------------------------------------------------------------------

comment on table individual_scholar_note is
  'SCHOLAR-LIBRARY-01 (820). The learner own notes, bookmarks and highlights on their saved teaching, lessons, materials and sections. Learner-authored, private, never AI output, never assessment evidence. Goes with what it is about.';
comment on column individual_scholar_artefact.session_id is
  'SCHOLAR-LIBRARY-01 (820). The lesson (414 session, with step) this teaching was saved for. Written on new saves only, never inferred for old rows. Set null when the session is deleted.';
comment on column individual_scholar_artefact.superseded_at is
  'SCHOLAR-LIBRARY-01 (820). Set when a refresh replaced this version. The row is kept, with dedupe_key rewritten to key:superseded:id. Null on the current version.';
comment on column individual_scholar_flashcard_deck.archived_at is
  'SCHOLAR-LIBRARY-01 (820). When the learner archived the deck. Null on an active deck.';
comment on function public.individual_scholar_library_search(uuid, text, integer, integer) is
  'SCHOLAR-LIBRARY-01 (820). Deterministic full-text search over one learner own saved teaching, notes, session titles, flashcards and card notes, ranked by ts_rank then recency, with {{hl}} marked snippets. No AI. service_role only, called with the caller own id.';

notify pgrst, 'reload schema';
