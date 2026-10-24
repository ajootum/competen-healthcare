-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql trigger function between dollar quotes. A runner that splits
-- on the statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 393: COMPETEN PROFESSIONAL COMPETENCY MAPPING -- THE OWN STORE OF EACH PERSON
--
-- COMPETEN-HOLDINGS-SHARED-ENGINES-01, the Professional vertical slice (owner GO 2026-10-23). Range 393-395.
--
-- APPLY ON STAGING FIRST. Two new tables, their append-only trigger, and two (id, user_id) unique indexes on
-- existing Professional tables (373) so the new rows can name them by composite key. No existing row is
-- changed. Re-running it is a no-op. OPS-001 s8: proposed Medium (new trigger function), so it carries a
-- staging rollback rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets a person link their development goals, CPD entries and evidence to many competencies of the
-- catalogues Professional offers, through the shared Holdings mapping engine (src/lib/competency/mapping.ts),
-- with every link self-declared or AI-proposed and every acceptance or rejection kept -- never verified.
--
-- ----------------------------------------------------------------------------------------------------
-- THE SHAPE. The same as Scholar (388), owned by Professional, keyed to the person (owner ruling D1).
--
--   individual_professional_competency_map       one row per (subject, competency). The subject is exactly
--                                                ONE of a goal, a CPD entry or an evidence row, each by
--                                                composite (id, user_id) foreign key, so a link can never
--                                                point at the record of another person. source is person or ai,
--                                                and only an ai row carries model, prompt version and
--                                                confidence.
--   individual_professional_competency_decision  APPEND-ONLY: accepted or rejected, by the person. A
--                                                correction is a new row. Update and delete are refused,
--                                                except a delete that arrives by CASCADE from a parent
--                                                (pg_trigger_depth() > 1), so erasing a record still works.
--
-- RLS: on for both, own-row SELECT only (owner ruling D6). No insert, update or delete policy: the server
-- writes through the service role, and a browser session can write nothing.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/PROF-SLICE/ROLLBACK-393.sql drops the two tables, the function and
--   the two indexes. Mapping rows made on staging are lost.
-- ====================================================================================================

create unique index if not exists ux_individual_professional_cpd_id_user
  on individual_professional_cpd(id, user_id);
create unique index if not exists ux_individual_professional_evidence_id_user
  on individual_professional_evidence(id, user_id);


-- ---- 1. individual_professional_competency_map ----------------------------------------------------------

create table if not exists individual_professional_competency_map (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  goal_id         uuid,
  cpd_id          uuid,
  evidence_id     uuid,
  competency_id   uuid not null references framework_competencies(id) on delete cascade,
  source          text not null,
  confidence      numeric(3, 2),
  rationale       text,
  model           text,
  prompt_version  text,
  created_at      timestamptz not null default now(),
  constraint individual_professional_competency_map_goal_fk foreign key (goal_id, user_id)
    references individual_professional_goal(id, user_id) on delete cascade,
  constraint individual_professional_competency_map_cpd_fk foreign key (cpd_id, user_id)
    references individual_professional_cpd(id, user_id) on delete cascade,
  constraint individual_professional_competency_map_evidence_fk foreign key (evidence_id, user_id)
    references individual_professional_evidence(id, user_id) on delete cascade
);

-- Exactly one subject.
alter table individual_professional_competency_map drop constraint if exists individual_professional_competency_map_subject_check;
alter table individual_professional_competency_map add constraint individual_professional_competency_map_subject_check
  check ((goal_id is not null)::int + (cpd_id is not null)::int + (evidence_id is not null)::int = 1);

alter table individual_professional_competency_map drop constraint if exists individual_professional_competency_map_source_check;
alter table individual_professional_competency_map add constraint individual_professional_competency_map_source_check
  check (source in ('person', 'ai'));

-- An AI proposal says which model and prompt made it and how sure it was. A link made by the person says neither.
alter table individual_professional_competency_map drop constraint if exists individual_professional_competency_map_provenance_check;
alter table individual_professional_competency_map add constraint individual_professional_competency_map_provenance_check
  check ((source = 'ai') = (model is not null and prompt_version is not null and confidence is not null)
     and (confidence is null or (confidence >= 0 and confidence <= 1))
     and (rationale is null or char_length(rationale) <= 500));

create unique index if not exists ux_individual_professional_competency_map_id_user
  on individual_professional_competency_map(id, user_id);
create unique index if not exists ux_individual_professional_competency_map_goal
  on individual_professional_competency_map(goal_id, competency_id);
create unique index if not exists ux_individual_professional_competency_map_cpd
  on individual_professional_competency_map(cpd_id, competency_id);
create unique index if not exists ux_individual_professional_competency_map_evidence
  on individual_professional_competency_map(evidence_id, competency_id);
create index if not exists idx_individual_professional_competency_map_user_competency
  on individual_professional_competency_map(user_id, competency_id);

alter table individual_professional_competency_map enable row level security;

drop policy if exists individual_professional_competency_map_read_own on individual_professional_competency_map;
create policy individual_professional_competency_map_read_own on individual_professional_competency_map
  for select using (auth.uid() = user_id);


-- ---- 2. individual_professional_competency_decision -- APPEND-ONLY ------------------------------------

create table if not exists individual_professional_competency_decision (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  map_id      uuid not null,
  decision    text not null,
  decided_by  text not null,
  created_at  timestamptz not null default now(),
  constraint individual_professional_competency_decision_map_fk foreign key (map_id, user_id)
    references individual_professional_competency_map(id, user_id) on delete cascade
);

alter table individual_professional_competency_decision drop constraint if exists individual_professional_competency_decision_check;
alter table individual_professional_competency_decision add constraint individual_professional_competency_decision_check
  check (decision in ('accepted', 'rejected') and decided_by = 'person');

create index if not exists idx_individual_professional_competency_decision_map
  on individual_professional_competency_decision(map_id, created_at desc);

alter table individual_professional_competency_decision enable row level security;

drop policy if exists individual_professional_competency_decision_read_own on individual_professional_competency_decision;
create policy individual_professional_competency_decision_read_own on individual_professional_competency_decision
  for select using (auth.uid() = user_id);

create or replace function public.individual_professional_decision_append_only()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'individual_professional_competency_decision is append-only: record a new decision instead';
end;
$$;

drop trigger if exists individual_professional_competency_decision_append_only on individual_professional_competency_decision;
create trigger individual_professional_competency_decision_append_only
  before update or delete on individual_professional_competency_decision
  for each row execute function public.individual_professional_decision_append_only();


-- Verification: two tables, RLS on, own-row policies, the trigger, and no rows.
select c.relname, c.relrowsecurity
  from pg_class c
 where c.relname in ('individual_professional_competency_map', 'individual_professional_competency_decision')
 order by c.relname;

select tablename, policyname, cmd
  from pg_policies
 where tablename in ('individual_professional_competency_map', 'individual_professional_competency_decision')
 order by tablename, policyname;

select tgname from pg_trigger where tgname = 'individual_professional_competency_decision_append_only';

notify pgrst, 'reload schema';
