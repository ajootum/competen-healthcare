-- ====================================================================================================
-- MIGRATION 402: COMPETEN SCHOLAR -- EDUCATIONAL CONTEXT (PROGRAMME, LEVEL, INSTITUTION) WITH HISTORY
--
-- !! APPLY THIS FILE WHOLE. It contains two plpgsql trigger functions. A runner that splits on semicolons
-- !! would cut a function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-SCHOLAR-JOIN-01 Stage 1 Join, J2. Owner ruling: preserve current AND historical educational
-- context -- a programme change must not overwrite the context of earlier learning activities. Reserved
-- number 402. Development authorised, production activation not. Build record:
-- docs/COMPETEN-SCHOLAR-JOIN-01-stage1-join.md.
--
-- APPLY ON STAGING FIRST. It adds four nullable columns to individual_scholar_learner (migration 387),
-- creates one table and two trigger functions, and backfills one history row per learner who chose a
-- programme before this file existed. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- individual_scholar_learner (387) holds ONE row per person, keyed on user_id, so changing programme
-- overwrites it and the context earlier study was done in is lost. This file keeps that row as the CURRENT
-- pointer and adds an append-only history beside it, written by the database itself on every change.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY A TRIGGER, NOT THE APPLICATION.
--
-- A history written by the service layer dies with the second writer who does not know it exists. The
-- trigger runs for every insert, update and delete of the pointer, whoever makes it, so the history cannot
-- fall behind the pointer. Its periods are stamped with the DATABASE clock (now()), the same clock every
-- learning record takes its created_at from -- so the context any record was made in is found by time,
-- without stamping a column onto every learning table.
--
--   individual_scholar_learner           CURRENT context. Unchanged key and meaning, plus level and
--                                        institution (code and the label shown at the time).
--   individual_scholar_learner_context   One row per context period: effective_from, and effective_to once
--                                        replaced. The open row (effective_to null) is the current one.
--
-- APPEND-ONLY. An UPDATE is refused unless it comes from the pointer trigger closing the open period
-- (pg_trigger_depth() > 1) and changes nothing but effective_to. A period can therefore never be rewritten
-- to claim a different programme. DELETE is allowed: a cascade from profiles, and erasure, must work --
-- the trail that can never be removed by anybody is a bug this estate has already fixed more than once.
--
-- LABELS ARE COPIED. Levels and institutions are governed in the Individual policy (WCE, COMPETEN-CONFIG-002)
-- as code and label. The label in force when the person chose is stored, so renaming or retiring an option
-- later never rewrites what a past period says.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. APPLY-WHOLE banner above (plpgsql).
--   No partial unique indexes. RLS on the history with an own-row SELECT policy only, like the pointer.
--   notify pgrst last.
--
-- ROLLBACK (staging): docs/COMPETEN-SCHOLAR-JOIN-01-stage1-join.md, section Rollback.
-- ====================================================================================================


-- ---- 1. THE POINTER GAINS LEVEL AND INSTITUTION ------------------------------------------------------

alter table individual_scholar_learner add column if not exists level_code text;
alter table individual_scholar_learner add column if not exists level_label text;
alter table individual_scholar_learner add column if not exists institution_code text;
alter table individual_scholar_learner add column if not exists institution_label text;

alter table individual_scholar_learner drop constraint if exists individual_scholar_learner_context_shape;
alter table individual_scholar_learner add constraint individual_scholar_learner_context_shape check (
  (level_code is null) = (level_label is null)
  and (institution_code is null) = (institution_label is null)
  and (level_code is null or level_code ~ '^[a-z0-9][a-z0-9-]{0,62}$')
  and (institution_code is null or institution_code ~ '^[a-z0-9][a-z0-9-]{0,62}$')
  and (level_label is null or char_length(btrim(level_label)) between 1 and 120)
  and (institution_label is null or char_length(btrim(institution_label)) between 1 and 160)
);


-- ---- 2. THE HISTORY ----------------------------------------------------------------------------------

create table if not exists individual_scholar_learner_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  programme_code text not null references individual_scholar_programme(code),
  level_code text,
  level_label text,
  institution_code text,
  institution_label text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now()
);

alter table individual_scholar_learner_context drop constraint if exists individual_scholar_learner_context_period;
alter table individual_scholar_learner_context add constraint individual_scholar_learner_context_period
  check (effective_to is null or effective_to >= effective_from);

alter table individual_scholar_learner_context drop constraint if exists individual_scholar_learner_context_shape;
alter table individual_scholar_learner_context add constraint individual_scholar_learner_context_shape check (
  (level_code is null) = (level_label is null)
  and (institution_code is null) = (institution_label is null)
);

create index if not exists idx_individual_scholar_learner_context_user
  on individual_scholar_learner_context(user_id, effective_from desc);

alter table individual_scholar_learner_context enable row level security;

drop policy if exists individual_scholar_learner_context_read_own on individual_scholar_learner_context;
create policy individual_scholar_learner_context_read_own on individual_scholar_learner_context
  for select using (auth.uid() = user_id);

comment on table individual_scholar_learner_context is
  'COMPETEN-SCHOLAR-JOIN-01 J2. Append-only history of a learner''s educational context, one row per period, written by trigger from individual_scholar_learner. The context of any learning record is the period containing its created_at (database clock). Own-row read, service-role and trigger write.';


-- ---- 3. THE POINTER WRITES THE HISTORY -------------------------------------------------------------

create or replace function individual_scholar_learner_history() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and old.programme_code is not distinct from new.programme_code
     and old.level_code is not distinct from new.level_code
     and old.institution_code is not distinct from new.institution_code then
    return null;
  end if;

  update individual_scholar_learner_context
     set effective_to = now()
   where user_id = coalesce(new.user_id, old.user_id)
     and effective_to is null;

  if tg_op in ('INSERT', 'UPDATE') then
    insert into individual_scholar_learner_context
      (user_id, programme_code, level_code, level_label, institution_code, institution_label, effective_from)
    values
      (new.user_id, new.programme_code, new.level_code, new.level_label, new.institution_code, new.institution_label, now());
  end if;
  return null;
end
$$;

drop trigger if exists trg_individual_scholar_learner_history on individual_scholar_learner;
create trigger trg_individual_scholar_learner_history
  after insert or update or delete on individual_scholar_learner
  for each row execute function individual_scholar_learner_history();


-- ---- 4. THE HISTORY REFUSES TO BE REWRITTEN ----------------------------------------------------------

create or replace function individual_scholar_learner_context_append_only() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1
     and old.effective_to is null and new.effective_to is not null
     and new.user_id = old.user_id
     and new.programme_code = old.programme_code
     and new.level_code is not distinct from old.level_code
     and new.level_label is not distinct from old.level_label
     and new.institution_code is not distinct from old.institution_code
     and new.institution_label is not distinct from old.institution_label
     and new.effective_from = old.effective_from then
    return new;
  end if;
  raise exception 'individual_scholar_learner_context is append-only: a past educational context cannot be rewritten';
end
$$;

drop trigger if exists trg_individual_scholar_learner_context_append_only on individual_scholar_learner_context;
create trigger trg_individual_scholar_learner_context_append_only
  before update on individual_scholar_learner_context
  for each row execute function individual_scholar_learner_context_append_only();


-- ---- 5. BACKFILL: ONE OPEN PERIOD PER LEARNER WHO CHOSE BEFORE THIS FILE ------------------------------
--
-- Their period starts when they chose (chosen_at), the only date 387 recorded. Idempotent: a learner who
-- already has a history row is skipped.

insert into individual_scholar_learner_context
  (user_id, programme_code, level_code, level_label, institution_code, institution_label, effective_from)
select l.user_id, l.programme_code, l.level_code, l.level_label, l.institution_code, l.institution_label, l.chosen_at
  from individual_scholar_learner l
 where not exists (select 1 from individual_scholar_learner_context c where c.user_id = l.user_id);


-- Verification: the four pointer columns, the history table with RLS and one policy, the two triggers, and
-- exactly one open period per learner (expect the two counts to match).
select column_name from information_schema.columns
 where table_name = 'individual_scholar_learner' and column_name in ('level_code', 'level_label', 'institution_code', 'institution_label')
 order by column_name;

select tgname from pg_trigger
 where tgname in ('trg_individual_scholar_learner_history', 'trg_individual_scholar_learner_context_append_only')
 order by tgname;

select (select count(*) from individual_scholar_learner) as learners,
       (select count(*) from individual_scholar_learner_context where effective_to is null) as open_periods;

notify pgrst, 'reload schema';
