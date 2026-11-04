-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql function between dollar quotes.
--
-- MIGRATION 955: COMPETEN SCHOLAR -- RE-CUTTING THE LESSONS OF A LEARN SESSION WITHOUT LOSING COMPLETED WORK
-- (LEARNING-CLOSE-2026-11, owner decision D03, workstream WS03 LE-03)
--
-- Owner decision D03 (4 Nov 2026): a learner may reorganise lesson boundaries, split or combine lesson sections and
-- re-cut a session's lessons without losing completed work. Identities and the mapping to the original material stay
-- stable. Progress, annotations, saved explanations, questions, flashcards, attempts and citations are preserved. Where
-- the scope of a lesson changes, the progress that depends on it is recalculated safely, never transferred as a whole.
--
-- WHAT A LESSON IS. A Learn session (414) is a list of lessons (steps), each a set of the learner's own sections
-- (individual_scholar_learning_step: session_id, step, chunk_id). Questions, flashcards, attempts, citations, saved
-- explanations (415 artefact sources) and section notes all hang off the SECTIONS, never off a step number. So a re-cut
-- moves no learning content at all: it rewrites which step holds which section, and then re-points the three things
-- that do name a step: learning events (414), the learning position (790), and lesson-targeted notes and lesson-linked
-- artefacts (820).
--
-- WHAT IT CHANGES.
--   1. individual_scholar_learning_session.lesson_titles jsonb: the names the learner gave the lessons (a JSON array,
--      one text or null per lesson, null meaning the name Scholar reads from the notes). Null: no names given.
--   2. individual_scholar_learning_event.detached_at timestamptz: set on an event whose lesson, after a re-cut, has no
--      lesson wholly inside it any more. The event is kept as history (study days, last studied) and is no longer
--      counted as progress of any lesson. Null: the event counts for its step as before.
--   3. The function individual_scholar_learning_session_recut(user, session, steps, titles). In one transaction it
--      checks the new lessons hold exactly the sections the session holds (regrouped, nothing added or dropped),
--      rewrites the step rows, and re-attributes by CONTAINMENT: an event counts for every new lesson whose sections
--      all lay inside the old lesson it was about, or inside the sections the event itself recorded as its sources
--      (the event moves to the first such lesson, and is copied to the others when the old lesson was split), and is
--      detached when no new lesson lies wholly inside either (the old lesson was merged into something larger than
--      anything the event covered, which the learner has not yet been taught as one). The position
--      (790) follows its section, else the new lesson that holds the first section of the old lesson. Notes targeting a
--      lesson and artefacts linked to a lesson (820) follow the first section of the old lesson. The session's current step
--      follows the same rule. Returns the counts, for the audit row the route writes.
--
-- NOT COMPETENCE. Nothing here is assessment evidence, verified competence or a Passport record. The events moved or
-- copied are the learning history of the learner, re-attributed to the lessons they covered.
--
-- FAIL CLOSED WITHOUT IT. The store calls the function only after a schema probe finds it. Where 955 is absent the
-- route answers that re-cutting is not available here and the session is unchanged.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 414 (session, step,
-- event, event_source), 790 (position) and 820 (note and artefact session columns). Re-running it is a no-op (add column
-- if not exists, create or replace). Rollback: ROLLBACK-955.sql (refuses while any detached event or lesson title exists).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_learning_session add column if not exists lesson_titles jsonb;
alter table individual_scholar_learning_event add column if not exists detached_at timestamptz;

alter table individual_scholar_learning_session drop constraint if exists individual_scholar_learning_session_lesson_titles_check;
alter table individual_scholar_learning_session add constraint individual_scholar_learning_session_lesson_titles_check
  check (lesson_titles is null or (jsonb_typeof(lesson_titles) = 'array' and jsonb_array_length(lesson_titles) <= 200));

create index if not exists individual_scholar_learning_event_session_step_idx
  on individual_scholar_learning_event (user_id, session_id, step);

create or replace function public.individual_scholar_learning_session_recut(
  p_user_id uuid, p_session_id uuid, p_steps jsonb, p_titles jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  ses individual_scholar_learning_session%rowtype;
  n_steps integer;
  n_old integer;
  i integer;
  k integer;
  el jsonb;
  t jsonb;
  cid uuid;
  mat uuid;
  ev record;
  pos record;
  art record;
  target integer;
  first_target integer;
  new_id uuid;
  moved integer := 0;
  copied integer := 0;
  detached integer := 0;
  notes_moved integer := 0;
  arts_moved integer := 0;
  pos_moved boolean := false;
  new_current integer;
  new_furthest integer;
  anchor text;
begin
  if p_user_id is null or p_session_id is null or p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'learning_recut: user, session and steps are required' using errcode = '22023';
  end if;
  n_steps := jsonb_array_length(p_steps);
  if n_steps < 1 or n_steps > 200 then
    raise exception 'learning_recut: between 1 and 200 lessons' using errcode = '22023';
  end if;
  if p_titles is not null and (jsonb_typeof(p_titles) <> 'array' or jsonb_array_length(p_titles) <> n_steps) then
    raise exception 'learning_recut: one title (or null) per lesson' using errcode = '22023';
  end if;

  select * into ses from individual_scholar_learning_session where id = p_session_id and user_id = p_user_id for update;
  if not found then
    raise exception 'learning_recut: not the caller''s session' using errcode = 'P0002';
  end if;

  -- The old lessons, with the place of each section in its material (for "the first section of a lesson").
  create temp table recut_old (step integer not null, chunk_id uuid not null, material_id uuid not null, ordinal integer not null) on commit drop;
  insert into recut_old (step, chunk_id, material_id, ordinal)
    select s.step, s.chunk_id, s.material_id, coalesce(c.ordinal, 0)
      from individual_scholar_learning_step s
      left join individual_scholar_chunk c on c.id = s.chunk_id and c.user_id = s.user_id
     where s.session_id = p_session_id and s.user_id = p_user_id;
  select count(*) into n_old from recut_old;
  if n_old = 0 then
    raise exception 'learning_recut: the session has no lessons to re-cut' using errcode = '22023';
  end if;

  -- The new lessons: every section must be one the session already holds, each exactly once, none left out.
  create temp table recut_new (step integer not null, chunk_id uuid not null, material_id uuid not null, ordinal integer not null) on commit drop;
  create unique index recut_new_chunk_uq on recut_new (chunk_id);
  i := 0;
  for el in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(el) <> 'array' or jsonb_array_length(el) < 1 or jsonb_array_length(el) > 200 then
      raise exception 'learning_recut: each lesson is a non-empty list of sections' using errcode = '22023';
    end if;
    for t in select value from jsonb_array_elements(el) loop
      if jsonb_typeof(t) <> 'string' then
        raise exception 'learning_recut: a section is named by its id' using errcode = '22023';
      end if;
      begin
        cid := (t #>> '{}')::uuid;
      exception when others then
        raise exception 'learning_recut: a section is named by its id' using errcode = '22023';
      end;
      select o.material_id into mat from recut_old o where o.chunk_id = cid limit 1;
      if mat is null then
        raise exception 'learning_recut: a section is not in this session' using errcode = '22023';
      end if;
      begin
        insert into recut_new (step, chunk_id, material_id, ordinal)
          select i, o.chunk_id, o.material_id, o.ordinal from recut_old o where o.chunk_id = cid limit 1;
      exception when unique_violation then
        raise exception 'learning_recut: a section is named twice' using errcode = '22023';
      end;
    end loop;
    i := i + 1;
  end loop;
  if (select count(*) from recut_new) <> n_old then
    raise exception 'learning_recut: every section of the session must be in exactly one lesson' using errcode = '22023';
  end if;

  if p_titles is not null then
    for t in select value from jsonb_array_elements(p_titles) loop
      if jsonb_typeof(t) not in ('null', 'string') or (jsonb_typeof(t) = 'string' and char_length(btrim(t #>> '{}')) > 120) then
        raise exception 'learning_recut: a lesson title is text of at most 120 characters, or null' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- 1. EVENTS, BY CONTAINMENT. An event of old lesson k counts for each new lesson whose sections all lay inside old
  --    lesson k, or all lay inside the sections the event recorded as its sources (so two halves joined back into the
  --    lesson they were taught as keep that teaching): it moves to the first such lesson and is copied to the others.
  --    None: detached.
  for ev in select e.id, e.step, e.action, e.verdict, e.created_at
              from individual_scholar_learning_event e
             where e.session_id = p_session_id and e.user_id = p_user_id and e.detached_at is null
             order by e.created_at, e.id loop
    first_target := null;
    for target in select n.step from recut_new n
                   group by n.step
                  having bool_and(exists (select 1 from recut_old o where o.step = ev.step and o.chunk_id = n.chunk_id))
                      or bool_and(exists (select 1 from individual_scholar_learning_event_source s where s.event_id = ev.id and s.chunk_id = n.chunk_id))
                   order by n.step loop
      if first_target is null then
        first_target := target;
        if target <> ev.step then
          update individual_scholar_learning_event set step = target where id = ev.id;
          moved := moved + 1;
        end if;
      else
        insert into individual_scholar_learning_event (session_id, user_id, step, action, verdict, created_at)
          values (p_session_id, p_user_id, target, ev.action, ev.verdict, ev.created_at)
          returning id into new_id;
        insert into individual_scholar_learning_event_source (event_id, user_id, chunk_id)
          select new_id, p_user_id, s.chunk_id from individual_scholar_learning_event_source s where s.event_id = ev.id;
        copied := copied + 1;
      end if;
    end loop;
    if first_target is null then
      update individual_scholar_learning_event set detached_at = now() where id = ev.id;
      detached := detached + 1;
    end if;
  end loop;

  -- 2. THE STEP ROWS: the same sections, regrouped.
  delete from individual_scholar_learning_step where session_id = p_session_id and user_id = p_user_id;
  insert into individual_scholar_learning_step (session_id, user_id, step, chunk_id, material_id)
    select p_session_id, p_user_id, n.step, n.chunk_id, n.material_id from recut_new n;

  -- 3. THE CURRENT STEP: the new lesson holding the first section of the old current lesson (else the first lesson).
  select n.step into new_current
    from recut_old o join recut_new n on n.chunk_id = o.chunk_id
   where o.step = ses.current_step
   order by o.material_id, o.ordinal limit 1;
  new_current := coalesce(new_current, 0);
  update individual_scholar_learning_session
     set current_step = new_current, lesson_titles = p_titles, last_active_at = now()
   where id = p_session_id and user_id = p_user_id;

  -- 4. THE POSITION (790): follows its section where it names one, else the first section of the old lesson. The section
  --    anchor (the place of the section in the notes) is kept only when the section itself was followed.
  select * into pos from individual_scholar_learning_position where user_id = p_user_id and session_id = p_session_id for update;
  if found then
    target := null;
    anchor := null;
    if pos.section_chunk_id is not null then
      select n.step into target from recut_new n where n.chunk_id = pos.section_chunk_id;
      if target is not null and position(':' in pos.card_id) > 0 then
        anchor := substr(pos.card_id, position(':' in pos.card_id));
      end if;
    end if;
    if target is null then
      select n.step into target
        from recut_old o join recut_new n on n.chunk_id = o.chunk_id
       where o.step = pos.step
       order by o.material_id, o.ordinal limit 1;
    end if;
    target := coalesce(target, new_current);
    select n.step into new_furthest
      from recut_old o join recut_new n on n.chunk_id = o.chunk_id
     where o.step = pos.furthest_step
     order by o.material_id, o.ordinal limit 1;
    new_furthest := greatest(target, coalesce(new_furthest, target));
    update individual_scholar_learning_position
       set step = target,
           furthest_step = new_furthest,
           card_id = 'lesson-' || target::text || coalesce(anchor, ''),
           section_chunk_id = case when anchor is null then null else section_chunk_id end,
           offset_hint = case when anchor is null then null else offset_hint end,
           unfinished = null,
           revision = revision + 1,
           updated_at = now()
     where user_id = p_user_id and session_id = p_session_id;
    pos_moved := true;
  end if;

  -- 5. NOTES TARGETING A LESSON (820): follow the first section of the old lesson.
  for ev in select nt.id, nt.step from individual_scholar_note nt
             where nt.session_id = p_session_id and nt.user_id = p_user_id and nt.step is not null loop
    select n.step into target
      from recut_old o join recut_new n on n.chunk_id = o.chunk_id
     where o.step = ev.step
     order by o.material_id, o.ordinal limit 1;
    target := coalesce(target, new_current);
    if target <> ev.step then
      update individual_scholar_note set step = target where id = ev.id;
      notes_moved := notes_moved + 1;
    end if;
  end loop;

  -- 6. ARTEFACTS LINKED TO A LESSON (820): follow their own first source section, else the first section of the old lesson.
  for art in select a.id, a.step from individual_scholar_artefact a
              where a.session_id = p_session_id and a.user_id = p_user_id and a.step is not null loop
    select n.step into target
      from individual_scholar_artefact_source s join recut_new n on n.chunk_id = s.chunk_id
     where s.artefact_id = art.id and s.user_id = p_user_id
     order by s.ordinal limit 1;
    if target is null then
      select n.step into target
        from recut_old o join recut_new n on n.chunk_id = o.chunk_id
       where o.step = art.step
       order by o.material_id, o.ordinal limit 1;
    end if;
    target := coalesce(target, new_current);
    if target <> art.step then
      update individual_scholar_artefact set step = target where id = art.id;
      arts_moved := arts_moved + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'steps', n_steps, 'sections', n_old, 'current_step', new_current,
    'events_moved', moved, 'events_copied', copied, 'events_detached', detached,
    'position_moved', pos_moved, 'notes_moved', notes_moved, 'artefacts_moved', arts_moved);
end;
$$;

revoke execute on function public.individual_scholar_learning_session_recut(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.individual_scholar_learning_session_recut(uuid, uuid, jsonb, jsonb) to service_role;

comment on column individual_scholar_learning_session.lesson_titles is
  'LEARNING-CLOSE-2026-11 LE-03 (955). The lesson names the learner gave: a JSON array with one text or null per lesson (null: the name read from the notes). Null: no names given.';
comment on column individual_scholar_learning_event.detached_at is
  'LEARNING-CLOSE-2026-11 LE-03 (955). Set when, after a re-cut, no lesson lies wholly inside the lesson this event was about. Kept as history, no longer counted as progress of any lesson.';
comment on function public.individual_scholar_learning_session_recut(uuid, uuid, jsonb, jsonb) is
  'LEARNING-CLOSE-2026-11 LE-03 (955). Re-cut the lessons of one Learn session (the same sections, regrouped) in one transaction: step rows rewritten, events re-attributed by old-lesson containment (moved, copied on a split, detached on a merge), the 790 position, 820 lesson notes and artefact links and the current step re-pointed. service_role only.';

notify pgrst, 'reload schema';
