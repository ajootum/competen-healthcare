-- ============================================================
-- MIGRATION 216: CLINICAL REFLECTION (CPR-230)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THREE OF THIS MODULE'S SIX DATA-MODEL OBJECTS ALREADY EXIST. ONE NEW TABLE, NOT SIX.
--
-- The specification's data model lists Reflection, Learning Point, Improvement Action, Competency Link,
-- Portfolio Evidence and Reflection Category. Before writing any of them:
--
--   LEARNING POINT      already built -- practice_case_learning (CPR-220, migration 214), authored,
--                       kinded, and already listed across the practice.
--   IMPROVEMENT ACTION  is a TASK. practice_task (CPR-340, migration 198) already has an owner, a due
--                       date, a status, escalation and a board people actually look at. A second table
--                       with a due date would be a second place work goes to be forgotten -- the exact
--                       thing CPR-340 refused when it declined to make a reminder a third object.
--   COMPETENCY LINK,    CPR-250 and CPR-240, both unbuilt. Named as gaps rather than modelled empty,
--   PORTFOLIO EVIDENCE  because a foreign key to a module that does not exist is a promise, not a link.
--
-- So this migration adds the REFLECTION itself, its version history, and two foreign keys onto tables
-- that already work.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- THERE IS NO STREAK COLUMN, AND THAT IS A CLINICAL SAFETY DECISION, NOT AN OMISSION.
--
-- The comp shows "Reflection Streak: 12 days -- Keep it going!" with a flame. A streak rewards the ACT
-- of reflecting rather than the substance of it, and the predictable result is performative reflection:
-- entries written to keep a number alive. Reflective practice that is produced to satisfy a counter is
-- worth less than none, because it also makes the honest entries harder to find. A streak additionally
-- punishes annual leave, illness and a week of night shifts. No column, so no page can grow one.
--
-- NO SCORE COLUMN EITHER. "Growth Score 82/100" and the four "Reflection Impact" bars -- Better
-- Decisions 82%, Improved Outcomes 78%, Enhanced Knowledge 89%, Greater Confidence 76% -- are claims
-- that reflecting measurably improved this clinician's decisions and their patients' outcomes. Nothing
-- in this product, or in any product, measures that from a text box.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The reflection ---------------------------------------------------------------------------------
--
-- PRIVATE BY DEFAULT, because section 9 says so and because it is the only default that makes the
-- feature usable. "What could I have done better" is not something a clinician writes honestly into a
-- box their practice partner reads by default. Sharing is a deliberate act, per reflection.

create table if not exists practice_reflection (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- WHOSE IT IS. Section 5: reflections are practitioner-owned. Not nullable, never reassigned.
  author_id uuid not null,

  -- What it is about. All optional: a reflection on the week is as legitimate as one on a consultation,
  -- and forcing an encounter would make the general case unrecordable.
  encounter_id uuid references practice_encounter(id) on delete set null,
  procedure_id uuid references practice_procedure(id) on delete set null,

  category text not null default 'clinical_outcome'
    check (category in ('clinical_outcome', 'decision_making', 'patient_communication',
                        'systems_process', 'professional_growth')),

  -- THE FOUR STRUCTURED PROMPTS, from the comp, which are the same four questions every time and
  -- therefore need no model to generate. At least one must be answered -- see the check below.
  went_well text,
  could_improve text,
  learned text,
  will_do_differently text,
  -- Free-text reflection, section 2. Some reflections do not fit four boxes.
  narrative text,

  visibility text not null default 'private' check (visibility in ('private', 'practice')),

  -- SECTION 5: "editable until locked by the practitioner". Locking is THEIR act, never the system's --
  -- an auto-lock after N days would take away the ability to correct a note about one's own conduct.
  locked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- AN EMPTY REFLECTION IS NOT A REFLECTION. Five nullable text columns with no constraint would let a
-- practice accumulate rows that count towards "28 reflections this period" while saying nothing --
-- which is the same failure as the streak, arriving through the back door.
alter table practice_reflection drop constraint if exists practice_reflection_not_empty;
alter table practice_reflection add constraint practice_reflection_not_empty check (
  coalesce(char_length(trim(went_well)), 0)
  + coalesce(char_length(trim(could_improve)), 0)
  + coalesce(char_length(trim(learned)), 0)
  + coalesce(char_length(trim(will_do_differently)), 0)
  + coalesce(char_length(trim(narrative)), 0) >= 20
);

create index if not exists idx_practice_reflection_author
  on practice_reflection(workspace_id, author_id, created_at desc);
create index if not exists idx_practice_reflection_encounter
  on practice_reflection(encounter_id);
create index if not exists idx_practice_reflection_shared
  on practice_reflection(workspace_id, created_at desc) where visibility = 'practice';

-- ---- 2. Version history ------------------------------------------------------------------------------
--
-- Section 9 asks for it, and CPR-130 already settled the shape: APPEND-ONLY SNAPSHOTS, not an in-place
-- row with a version number. "What did this reflection say before I revised it" is a question that
-- matters most for exactly the entries somebody later wishes they had worded differently.

create table if not exists practice_reflection_version (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  reflection_id uuid not null references practice_reflection(id) on delete cascade,
  version integer not null,
  went_well text,
  could_improve text,
  learned text,
  will_do_differently text,
  narrative text,
  category text,
  captured_at timestamptz not null default now(),
  captured_by uuid
);

create unique index if not exists ux_practice_reflection_version
  on practice_reflection_version(reflection_id, version);

-- ---- 3. The two links onto tables that already work -----------------------------------------------------

-- AN IMPROVEMENT ACTION IS A TASK. See the header.
alter table practice_task add column if not exists reflection_id uuid references practice_reflection(id) on delete set null;
create index if not exists idx_practice_task_reflection
  on practice_task(reflection_id) where reflection_id is not null;

-- 198 allowed admin / clinical_admin / supplies / billing / referral / equipment / other. An improvement
-- action is none of those, and filing one as "other" would make it invisible on a board that groups by
-- category.
alter table practice_task drop constraint if exists practice_task_category_check;
alter table practice_task add constraint practice_task_category_check
  check (category in ('admin', 'clinical_admin', 'supplies', 'billing', 'referral',
                      'equipment', 'improvement', 'other'));

-- A LEARNING POINT MAY COME FROM A REFLECTION. Promoting one is how something private becomes something
-- the practice can read -- a deliberate crossing, recorded, never automatic.
alter table practice_case_learning add column if not exists reflection_id uuid references practice_reflection(id) on delete set null;
create index if not exists idx_practice_case_learning_reflection
  on practice_case_learning(reflection_id) where reflection_id is not null;

-- ---- 4. Capabilities -------------------------------------------------------------------------------------
--
-- NO NEW CAPABILITY, AND NO EXISTING ONE EITHER. Reflecting on your own practice is not a permission
-- somebody grants you; every member may write their own and read their own. What is gated is what the
-- reflection TOUCHES: linking one to a consultation needs encounter.list, and promoting a learning point
-- needs encounter.edit, both already enforced by CPR-220.

-- ---- 5. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_reflection enable row level security;
alter table practice_reflection_version enable row level security;

notify pgrst, 'reload schema';
