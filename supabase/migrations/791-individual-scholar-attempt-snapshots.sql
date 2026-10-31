-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains two plpgsql trigger functions between dollar quotes.
-- ====================================================================================================
-- MIGRATION 791: COMPETEN SCHOLAR -- ASSESSMENT SNAPSHOTS AND CORRECTIONS (SCHOLAR-CONTINUITY-01, item 2)
--
-- Owner GO 31 Oct 2026, "Scholar Learning Continuity and Assessment Attempt Integrity", items 1 and 2.
--
-- WHY. An attempt (372, 416) keeps the answer and its mark, but not the question as it was shown. A choice attempt
-- (mcq, case) cannot keep anything beside chosen_index, because the 416 CHECK requires exactly one of chosen_index
-- and response. That CHECK is NOT changed here. Instead each attempt may have ONE snapshot row beside it, and any
-- number of corrections after it.
--
-- individual_scholar_attempt_snapshot (one per attempt, primary key attempt_id). What was assessed, at the time:
-- question_version (lib:<library version id> for a governed library copy, own:<content_version> for the learner
-- own question), content_hash (16 hex, the canonical hash of the stem, options, key and rationale -- a different
-- hash on the live question means it changed since), presented (the stem and the options IN THE ORDER SHOWN, each
-- with its original index, so a shuffled order can be reconstructed), response (the answer, a choice as both its
-- presented and original index), answer_key (the key and the rationale), rubric and rubric_hash (the 416 rubric
-- snapshot, rubric-snapshot.ts, where the question has a marking guide), score, outcome (correct, partial,
-- incorrect), marking, feedback (the formative feedback an AI-evaluated answer was shown, where any), competency_ids
-- and assessed_at. At most 16384 bytes of json in all.
--
-- IMMUTABLE. A trigger refuses every UPDATE, and refuses DELETE except when it comes through a cascade
-- (pg_trigger_depth() greater than 1), so deleting the attempt, its question, its material or the learner still
-- works. On INSERT it checks that the attempt exists, is this learner own, and is of this question.
--
-- individual_scholar_attempt_correction (append-only, the same guard). A correction never overwrites the original.
-- It records previous_score and previous_outcome (FILLED BY THE TRIGGER from the effective result at that moment:
-- the latest correction, else the attempt itself), corrected_score, corrected_outcome, reason (10 to 500
-- characters), basis (rubric_error, key_error, marking_error, other), and who: corrected_by_kind hq_actor with
-- corrected_by the actor id, or system_rule with no id. corrected_by has no foreign key, so removing an actor
-- account never has to rewrite the trail. A correction that changes nothing is refused. Corrections of one attempt
-- are serialised by a row lock on the attempt.
-- EFFECTIVE RESULT = the latest correction (created_at, then id), else the original attempt. Shown with the
-- original beside it.
--
-- PRIVATE AND ERASABLE. Both tables cascade from the attempt (which cascades from its question, material and the
-- learner). RLS read-own. No table grants. Writes come only from the server: snapshots through the Scholar store,
-- corrections through the store function recordAttemptCorrection, each with an audit_log row (codes only).
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 372 and 416.
-- Independent of 790. Re-running it is a no-op. Rollback: ROLLBACK-791.sql (refuses while any row exists).
--
-- FAIL CLOSED WITHOUT IT. While 791 is absent an answer is recorded exactly as before and no snapshot is kept, with
-- no error to the learner. Feedback shown again then reads the live question, as before.
--
-- FORMATIVE. A snapshot or a correction is a record of a private practice attempt, never competence, an assessment
-- outcome for a regulator, or a Passport record.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE SNAPSHOT ---------------------------------------------------------------------------------

create table if not exists individual_scholar_attempt_snapshot (
  attempt_id        uuid primary key references individual_scholar_attempt(id) on delete cascade,
  user_id           uuid not null,
  question_id       uuid not null,
  question_version  text not null,
  content_hash      text not null,
  presented         jsonb not null,
  response          jsonb not null,
  answer_key        jsonb not null,
  rubric            jsonb,
  rubric_hash       text,
  score             numeric,
  outcome           text not null,
  marking           text not null,
  feedback          jsonb,
  competency_ids    uuid[] not null default '{}',
  assessed_at       timestamptz not null,
  created_at        timestamptz not null default now()
);

alter table individual_scholar_attempt_snapshot drop constraint if exists individual_scholar_attempt_snapshot_shape_check;
alter table individual_scholar_attempt_snapshot add constraint individual_scholar_attempt_snapshot_shape_check
  check (question_version ~ '^(lib:[0-9a-f-]{36}|own:[0-9]{1,6})$'
     and content_hash ~ '^[0-9a-f]{16}$'
     and (rubric_hash is null or rubric_hash ~ '^[0-9a-f]{16}$')
     and jsonb_typeof(presented) = 'object'
     and jsonb_typeof(response) = 'object'
     and jsonb_typeof(answer_key) = 'object'
     and (rubric is null or jsonb_typeof(rubric) = 'object')
     and (feedback is null or jsonb_typeof(feedback) = 'object')
     and octet_length(presented::text) + octet_length(response::text) + octet_length(answer_key::text)
         + coalesce(octet_length(rubric::text), 0) + coalesce(octet_length(feedback::text), 0) <= 16384
     and (score is null or (score >= 0 and score <= 1))
     and outcome in ('correct', 'partial', 'incorrect')
     and marking in ('deterministic', 'self_graded', 'ai_evaluation')
     and cardinality(competency_ids) <= 20);

create index if not exists idx_individual_scholar_attempt_snapshot_user
  on individual_scholar_attempt_snapshot(user_id, question_id);

-- ---- 2. THE CORRECTIONS ------------------------------------------------------------------------------

create table if not exists individual_scholar_attempt_correction (
  id                 uuid primary key default gen_random_uuid(),
  attempt_id         uuid not null references individual_scholar_attempt(id) on delete cascade,
  user_id            uuid not null,
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

alter table individual_scholar_attempt_correction drop constraint if exists individual_scholar_attempt_correction_shape_check;
alter table individual_scholar_attempt_correction add constraint individual_scholar_attempt_correction_shape_check
  check ((previous_score is null or (previous_score >= 0 and previous_score <= 1))
     and (corrected_score is null or (corrected_score >= 0 and corrected_score <= 1))
     and previous_outcome in ('correct', 'partial', 'incorrect')
     and corrected_outcome in ('correct', 'partial', 'incorrect')
     and char_length(btrim(reason)) between 10 and 500
     and basis in ('rubric_error', 'key_error', 'marking_error', 'other')
     and corrected_by_kind in ('hq_actor', 'system_rule')
     and ((corrected_by_kind = 'hq_actor') = (corrected_by is not null)));

create index if not exists idx_individual_scholar_attempt_correction_attempt
  on individual_scholar_attempt_correction(attempt_id, created_at desc);
create index if not exists idx_individual_scholar_attempt_correction_user
  on individual_scholar_attempt_correction(user_id);

-- ---- 3. THE GUARDS: write once, never changed, removed only with the attempt -----------------------------

create or replace function public.individual_scholar_attempt_snapshot_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'attempt_snapshot: a snapshot is never deleted, only removed with its attempt';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'attempt_snapshot: a snapshot is never changed. Record a correction instead';
  end if;
  if not exists (select 1 from individual_scholar_attempt a
                  where a.id = new.attempt_id and a.user_id = new.user_id and a.question_id = new.question_id) then
    raise exception 'attempt_snapshot: the attempt is not this learner own answer to this question';
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists individual_scholar_attempt_snapshot_guard on individual_scholar_attempt_snapshot;
create trigger individual_scholar_attempt_snapshot_guard
  before insert or update or delete on individual_scholar_attempt_snapshot
  for each row execute function public.individual_scholar_attempt_snapshot_guard();

create or replace function public.individual_scholar_attempt_correction_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  a_correct boolean;
  a_score numeric;
  prev_score numeric;
  prev_outcome text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'attempt_correction: a correction is never deleted, only removed with its attempt';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'attempt_correction: a correction is never changed. Record another correction instead';
  end if;
  select a.correct, a.score into a_correct, a_score from individual_scholar_attempt a
   where a.id = new.attempt_id and a.user_id = new.user_id for update;
  if not found then
    raise exception 'attempt_correction: the attempt is not this learner own';
  end if;
  select c.corrected_score, c.corrected_outcome into prev_score, prev_outcome from individual_scholar_attempt_correction c
   where c.attempt_id = new.attempt_id order by c.created_at desc, c.id desc limit 1;
  if not found then
    prev_score := a_score;
    prev_outcome := case when a_correct then 'correct' when coalesce(a_score, 0) > 0 then 'partial' else 'incorrect' end;
  end if;
  if new.corrected_outcome = prev_outcome and new.corrected_score is not distinct from prev_score then
    raise exception 'attempt_correction: the correction changes nothing';
  end if;
  new.previous_score := prev_score;
  new.previous_outcome := prev_outcome;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists individual_scholar_attempt_correction_guard on individual_scholar_attempt_correction;
create trigger individual_scholar_attempt_correction_guard
  before insert or update or delete on individual_scholar_attempt_correction
  for each row execute function public.individual_scholar_attempt_correction_guard();

revoke execute on function public.individual_scholar_attempt_snapshot_guard() from public, anon, authenticated;
revoke execute on function public.individual_scholar_attempt_correction_guard() from public, anon, authenticated;

-- ---- RLS: READ OWN. Writes come only from the server, through the Scholar store. ------------------------

alter table individual_scholar_attempt_snapshot enable row level security;
alter table individual_scholar_attempt_correction enable row level security;

drop policy if exists individual_scholar_attempt_snapshot_read_own on individual_scholar_attempt_snapshot;
create policy individual_scholar_attempt_snapshot_read_own on individual_scholar_attempt_snapshot
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_attempt_correction_read_own on individual_scholar_attempt_correction;
create policy individual_scholar_attempt_correction_read_own on individual_scholar_attempt_correction
  for select using (auth.uid() = user_id);

comment on table individual_scholar_attempt_snapshot is
  'SCHOLAR-CONTINUITY-01 (791). What one attempt was assessed against, at the time: the question as presented (order and original indexes), the answer, the key, the rubric and its hash, the result. Immutable. Formative, never competence.';
comment on table individual_scholar_attempt_correction is
  'SCHOLAR-CONTINUITY-01 (791). Append-only corrections of an attempt result. previous_* is filled from the effective result at the time. The effective result is the latest correction, else the attempt. The original is never overwritten.';

notify pgrst, 'reload schema';
