-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains four plpgsql trigger functions between dollar quotes. A runner that
-- splits on semicolons would cut a function body apart. Paste the whole file, or use scripts/apply-migrations.ts.
-- ====================================================================================================
-- MIGRATION 810: COMPETEN SCHOLAR -- CLINICAL CASE ATTEMPT INTEGRITY (SCHOLAR-CASE-INTEGRITY-01)
--
-- Owner GO 31 Oct 2026, "Scholar Learning Continuity and Assessment Attempt Integrity", item 3 (and item 4 for
-- cases). Build record: docs/evidence/CASE-INTEGRITY/810-build-record.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. ADDITIVE: three new tables, four
-- trigger functions, and one new trigger on individual_scholar_case (435). No existing column, CHECK, policy or row is
-- changed. The 435 answer CHECK (a choice OR a written answer, never both) is NOT changed. Re-running it is a no-op.
-- It depends on 435 and 436 (the private case, session and answer tables) and 423 and 424 (case_library_session),
-- and 422 (case_library_version and its content_hash).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT IS FOR.
--
-- 1. individual_scholar_case_reason. The learner reason for a CHOICE decision in a private case, where the case asks
--    for one (askReason). 435 keeps a choice or a written answer on an answer row, never both, so the reason sits
--    beside the answer here, one per decision, keyed on the private session. It is written only after the answer it
--    explains exists (the guard checks), and never changed. A LIBRARY play keeps its reasons where it always has,
--    with the answer on case_library_session (423), so there is one read path for each kind.
--
-- 2. individual_scholar_case_attempt_snapshot. ONE row per completed case attempt (private or library), written once
--    at completion and never changed: which case and version (case_ref own:<case id> or lib:<version id>, and the
--    content_hash the database held for it), the stages reached, the findings shown, every decision (what was chosen
--    or written, the reason, how it was marked, the safety criteria broken, any AI feedback labelled formative),
--    the rubric excerpt that applied (keys, expected responses, rubric criteria, safety criteria) with its hash, the
--    debrief summary, and when it was completed. The guard checks the session is this learner own and completed,
--    and that content_hash is what the case holds now, and takes completed_at from the session itself.
--    standing is always formative: the CHECK refuses anything else, so the schema cannot hold a snapshot as
--    verified competence.
--
-- 3. individual_scholar_case_attempt_correction. Append-only corrections of one decision result in a snapshot.
--    previous_* is filled by the guard from the effective result at that moment (the latest correction of that
--    decision, else the snapshot), a correction that changes nothing is refused, and corrections of one snapshot
--    are serialised by a row lock on it. reason 10 to 500 characters, basis rubric_error, key_error, marking_error
--    or other, corrected_by_kind hq_actor (with an id) or system_rule (without). The original is never overwritten.
--
-- 4. A private case blueprint is FIXED once written (new trigger on individual_scholar_case). No code edits one,
--    and none may: an in-progress or completed session must always be played and read against the case it started
--    on. Changing a case means writing a new one.
--
-- IMMUTABLE AND ERASABLE. Every guard refuses UPDATE, and refuses DELETE except through a cascade
-- (pg_trigger_depth() greater than 1), so deleting a session, a case, a material or the learner still removes
-- everything. Reasons and private snapshots cascade from the 435 session, library snapshots from case_library_session,
-- corrections from their snapshot.
--
-- RLS on, one read-own SELECT policy each. No table grants. Writes only from the server through the Scholar store.
--
-- FAIL CLOSED WITHOUT IT. While 810 is absent a case plays exactly as before: a private reason stays in the learner
-- browser, no snapshot is kept, and nothing is said to the learner.
--
-- FORMATIVE. Nothing here is assessment, competence or Passport evidence.
--
-- Rollback: ROLLBACK-810.sql (refuses while any reason, snapshot or correction row exists).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ====================================================================================================


-- ---- 1. THE REASON FOR A CHOICE IN A PRIVATE CASE ------------------------------------------------------

create table if not exists individual_scholar_case_reason (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null,
  user_id            uuid not null,
  decision_point_id  text not null,
  reason             text not null,
  created_at         timestamptz not null default now(),
  constraint individual_scholar_case_reason_session_fk foreign key (session_id, user_id)
    references individual_scholar_case_session(id, user_id) on delete cascade
);

alter table individual_scholar_case_reason drop constraint if exists individual_scholar_case_reason_shape_check;
alter table individual_scholar_case_reason add constraint individual_scholar_case_reason_shape_check
  check (decision_point_id ~ '^[a-z][a-z0-9_-]{0,30}$'
     and char_length(btrim(reason)) between 1 and 1500);

create unique index if not exists ux_individual_scholar_case_reason_decision
  on individual_scholar_case_reason(session_id, decision_point_id);
create index if not exists idx_individual_scholar_case_reason_user
  on individual_scholar_case_reason(user_id);


-- ---- 2. THE COMPLETED ATTEMPT, AS IT WAS ---------------------------------------------------------------

create table if not exists individual_scholar_case_attempt_snapshot (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  session_kind        text not null,
  private_session_id  uuid,
  library_session_id  uuid references case_library_session(id) on delete cascade,
  case_ref            text not null,
  content_hash        text not null,
  record              jsonb not null,
  rubric              jsonb,
  rubric_hash         text generated always as (md5(rubric::text)) stored,
  standing            text not null default 'formative',
  completed_at        timestamptz not null,
  created_at          timestamptz not null default now(),
  constraint individual_scholar_case_attempt_snapshot_private_fk foreign key (private_session_id, user_id)
    references individual_scholar_case_session(id, user_id) on delete cascade
);

alter table individual_scholar_case_attempt_snapshot drop constraint if exists individual_scholar_case_attempt_snapshot_shape_check;
alter table individual_scholar_case_attempt_snapshot add constraint individual_scholar_case_attempt_snapshot_shape_check
  check (session_kind in ('private', 'library')
     and ((session_kind = 'private') = (private_session_id is not null))
     and ((session_kind = 'library') = (library_session_id is not null))
     and ((session_kind = 'private' and case_ref ~ '^own:[0-9a-f-]{36}$') or (session_kind = 'library' and case_ref ~ '^lib:[0-9a-f-]{36}$'))
     and content_hash ~ '^[0-9a-f]{32}$'
     and jsonb_typeof(record) = 'object'
     and (rubric is null or jsonb_typeof(rubric) = 'object')
     and octet_length(record::text) + coalesce(octet_length(rubric::text), 0) <= 200000
     and standing = 'formative');

create unique index if not exists ux_individual_scholar_case_attempt_snapshot_private
  on individual_scholar_case_attempt_snapshot(private_session_id);
create unique index if not exists ux_individual_scholar_case_attempt_snapshot_library
  on individual_scholar_case_attempt_snapshot(library_session_id);
create index if not exists idx_individual_scholar_case_attempt_snapshot_user
  on individual_scholar_case_attempt_snapshot(user_id, completed_at desc);


-- ---- 3. CORRECTIONS, APPEND-ONLY -----------------------------------------------------------------------

create table if not exists individual_scholar_case_attempt_correction (
  id                 uuid primary key default gen_random_uuid(),
  snapshot_id        uuid not null references individual_scholar_case_attempt_snapshot(id) on delete cascade,
  user_id            uuid not null,
  decision_point_id  text not null,
  previous_score     numeric,
  previous_outcome   text not null,
  corrected_score    numeric,
  corrected_outcome  text not null,
  reason             text not null,
  basis              text not null,
  corrected_by       uuid,
  corrected_by_kind  text not null,
  created_at         timestamptz not null default now()
);

alter table individual_scholar_case_attempt_correction drop constraint if exists individual_scholar_case_attempt_correction_shape_check;
alter table individual_scholar_case_attempt_correction add constraint individual_scholar_case_attempt_correction_shape_check
  check (decision_point_id ~ '^[a-z][a-z0-9_-]{0,30}$'
     and (previous_score is null or (previous_score >= 0 and previous_score <= 1))
     and (corrected_score is null or (corrected_score >= 0 and corrected_score <= 1))
     and previous_outcome in ('correct', 'partial', 'incorrect', 'unmarked')
     and corrected_outcome in ('correct', 'partial', 'incorrect')
     and char_length(btrim(reason)) between 10 and 500
     and basis in ('rubric_error', 'key_error', 'marking_error', 'other')
     and corrected_by_kind in ('hq_actor', 'system_rule')
     and ((corrected_by_kind = 'hq_actor') = (corrected_by is not null)));

create index if not exists idx_individual_scholar_case_attempt_correction_snapshot
  on individual_scholar_case_attempt_correction(snapshot_id, decision_point_id, created_at desc);
create index if not exists idx_individual_scholar_case_attempt_correction_user
  on individual_scholar_case_attempt_correction(user_id);


-- ---- 4. THE GUARDS -------------------------------------------------------------------------------------

create or replace function public.individual_scholar_case_reason_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'case_reason: a reason is never deleted, only removed with its session';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'case_reason: a reason is kept as it was given';
  end if;
  if not exists (select 1 from individual_scholar_case_answer a
                  where a.session_id = new.session_id and a.user_id = new.user_id
                    and a.decision_point_id = new.decision_point_id and a.chosen_option_ids is not null) then
    raise exception 'case_reason: a reason explains a choice this learner has made in this session';
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists individual_scholar_case_reason_guard on individual_scholar_case_reason;
create trigger individual_scholar_case_reason_guard
  before insert or update or delete on individual_scholar_case_reason
  for each row execute function public.individual_scholar_case_reason_guard();

create or replace function public.individual_scholar_case_attempt_snapshot_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  done_at timestamptz;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'case_attempt_snapshot: a snapshot is never deleted, only removed with its session';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'case_attempt_snapshot: a snapshot is never changed. Record a correction instead';
  end if;
  if new.session_kind = 'private' then
    select s.completed_at into done_at
      from individual_scholar_case_session s
      join individual_scholar_case c on c.id = s.private_case_id and c.user_id = s.user_id
     where s.id = new.private_session_id and s.user_id = new.user_id and s.status = 'completed'
       and c.blueprint_hash = new.content_hash and new.case_ref = 'own:' || c.id::text;
  else
    select s.completed_at into done_at
      from case_library_session s
      join case_library_version v on v.id = s.version_id
     where s.id = new.library_session_id and s.user_id = new.user_id and s.status = 'completed'
       and v.content_hash = new.content_hash and new.case_ref = 'lib:' || v.id::text;
  end if;
  if done_at is null then
    raise exception 'case_attempt_snapshot: the session is not this learner own completed play of this case as it is held';
  end if;
  new.completed_at := done_at;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists individual_scholar_case_attempt_snapshot_guard on individual_scholar_case_attempt_snapshot;
create trigger individual_scholar_case_attempt_snapshot_guard
  before insert or update or delete on individual_scholar_case_attempt_snapshot
  for each row execute function public.individual_scholar_case_attempt_snapshot_guard();

create or replace function public.individual_scholar_case_attempt_correction_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  rec jsonb;
  dec jsonb;
  prev_score numeric;
  prev_outcome text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'case_attempt_correction: a correction is never deleted, only removed with its snapshot';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'case_attempt_correction: a correction is never changed. Record another correction instead';
  end if;
  select s.record into rec from individual_scholar_case_attempt_snapshot s
   where s.id = new.snapshot_id and s.user_id = new.user_id for update;
  if not found then
    raise exception 'case_attempt_correction: the snapshot is not this learner own';
  end if;
  select d into dec from jsonb_array_elements(coalesce(rec -> 'decisions', '[]'::jsonb)) d
   where d ->> 'id' = new.decision_point_id limit 1;
  if dec is null then
    raise exception 'case_attempt_correction: that decision is not in the attempt';
  end if;
  select c.corrected_score, c.corrected_outcome into prev_score, prev_outcome from individual_scholar_case_attempt_correction c
   where c.snapshot_id = new.snapshot_id and c.decision_point_id = new.decision_point_id
   order by c.created_at desc, c.id desc limit 1;
  if not found then
    prev_score := case when jsonb_typeof(dec -> 'score') = 'number' then (dec ->> 'score')::numeric end;
    prev_outcome := case when jsonb_typeof(dec -> 'correct') <> 'boolean' then 'unmarked'
                         when (dec ->> 'correct')::boolean then 'correct'
                         when coalesce(prev_score, 0) > 0 then 'partial'
                         else 'incorrect' end;
  end if;
  if new.corrected_outcome = prev_outcome and new.corrected_score is not distinct from prev_score then
    raise exception 'case_attempt_correction: the correction changes nothing';
  end if;
  new.previous_score := prev_score;
  new.previous_outcome := prev_outcome;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists individual_scholar_case_attempt_correction_guard on individual_scholar_case_attempt_correction;
create trigger individual_scholar_case_attempt_correction_guard
  before insert or update or delete on individual_scholar_case_attempt_correction
  for each row execute function public.individual_scholar_case_attempt_correction_guard();

create or replace function public.individual_scholar_case_blueprint_fixed()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.blueprint is distinct from old.blueprint then
    raise exception 'individual_scholar_case: a private case is fixed once written. Write a new case instead';
  end if;
  return new;
end;
$$;

drop trigger if exists individual_scholar_case_blueprint_fixed on individual_scholar_case;
create trigger individual_scholar_case_blueprint_fixed
  before update of blueprint on individual_scholar_case
  for each row execute function public.individual_scholar_case_blueprint_fixed();

revoke execute on function public.individual_scholar_case_reason_guard() from public, anon, authenticated;
revoke execute on function public.individual_scholar_case_attempt_snapshot_guard() from public, anon, authenticated;
revoke execute on function public.individual_scholar_case_attempt_correction_guard() from public, anon, authenticated;
revoke execute on function public.individual_scholar_case_blueprint_fixed() from public, anon, authenticated;


-- ---- 5. RLS: READ OWN. Writes come only from the server, through the Scholar store. ---------------------

alter table individual_scholar_case_reason enable row level security;
alter table individual_scholar_case_attempt_snapshot enable row level security;
alter table individual_scholar_case_attempt_correction enable row level security;

drop policy if exists individual_scholar_case_reason_read_own on individual_scholar_case_reason;
create policy individual_scholar_case_reason_read_own on individual_scholar_case_reason
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_case_attempt_snapshot_read_own on individual_scholar_case_attempt_snapshot;
create policy individual_scholar_case_attempt_snapshot_read_own on individual_scholar_case_attempt_snapshot
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_case_attempt_correction_read_own on individual_scholar_case_attempt_correction;
create policy individual_scholar_case_attempt_correction_read_own on individual_scholar_case_attempt_correction
  for select using (auth.uid() = user_id);

comment on table individual_scholar_case_reason is
  'SCHOLAR-CASE-INTEGRITY-01 (810). The learner reason for a choice in a private case, beside the 435 answer it explains. Kept as given. Formative.';
comment on table individual_scholar_case_attempt_snapshot is
  'SCHOLAR-CASE-INTEGRITY-01 (810). One completed case attempt as it was: case and version with its content hash, stages, findings, decisions, reasons, marking, rubric excerpt and hash, debrief. Immutable. Always formative, never competence.';
comment on table individual_scholar_case_attempt_correction is
  'SCHOLAR-CASE-INTEGRITY-01 (810). Append-only corrections of one decision result in a case attempt. previous_* is filled from the effective result at the time. The original is never overwritten.';

notify pgrst, 'reload schema';
