-- ============================================================
-- MIGRATION 239: FOLLOW-UP SOURCES, DEFERRAL, AND CONTINUITY PATHWAYS
-- CPR-FUP-001 / CPR-FUP-002 / CPR-FUP-003
--
-- ----------------------------------------------------------------------------------------------------
-- WARNING: THE SPECIFICATION'S LIFECYCLE AND THIS TABLE'S LIFECYCLE ARE NOT THE SAME LIST, AND THE
-- DIFFERENCE IS DELIBERATE.
--
-- CPR-FUP-002 s4 gives: Draft -> Active -> Due -> Completed, plus Deferred and Cancelled.
-- practice_follow_up has held: OPEN, SCHEDULED, COMPLETED, MISSED, CANCELLED since migration 196.
--
--   Active     is OPEN. Same state, different word. Renaming it would rewrite every row and every
--              engine for no behaviour, so the word stays and this comment is the mapping.
--   Due        IS NOT A STATUS AND MUST NEVER BECOME ONE. This is migration 196's central decision and
--              the reason it has a header explaining itself: a stored DUE needs something to run in
--              order to become true, and the thing it needs is exactly what a neglected practice does
--              not do. A follow-up would then become due only when somebody opened the app -- so the
--              board that exists to say who has been forgotten would go quietest for the practices that
--              had forgotten most. `due_on` against the practice's today, computed at read time, every
--              time. CPR-FUP-002 s11 asks for exactly this in its own words: "status calculations
--              should be automatic and based on local practice date/time without manual refresh."
--   Draft      is added below. A follow-up being composed and not yet owed by anybody.
--   Deferred   is added below, with the date it was deferred TO -- a deferral with no date is an
--              obligation nobody will ever be reminded of again.
--   MISSED     is NOT in the specification and is KEPT. It is a judgement somebody made with their name
--              on it ("we stopped chasing this person"), which is a different fact from a date having
--              passed, and CPR-140 built the whole distinction deliberately.
--   SCHEDULED  is kept for the same reason: a booked obligation is not the same as an open one.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the migration runner splits the file on them and a stray semicolon inside a
-- comment silently drops the statements around it while still reporting success. That happened on
-- migration 238.
-- ============================================================

-- ---- 1. WHERE A FOLLOW-UP CAME FROM (CPR-FUP-002 s3, s5) -------------------------------------------
--
-- s5 requires every follow-up to store its source. Until now the only trace was origin_encounter_id
-- being null or not, which cannot tell a manual commitment from one raised by a document, and cannot
-- record a source that has no row to point at.
--
-- The list is CLOSED and includes the sources s3 calls FUTURE (documents, investigation reviews,
-- referrals, assistant recommendations). They are in the constraint because migration 238 has just
-- created practice_encounter_investigation and practice_referral, so those rows now exist and will
-- raise obligations -- and a closed list that has to be widened on the day the feature lands is a
-- migration nobody remembers to write.
alter table practice_follow_up add column if not exists source text not null default 'encounter';

alter table practice_follow_up drop constraint if exists practice_follow_up_source_allowed;
alter table practice_follow_up add constraint practice_follow_up_source_allowed
  check (source in ('encounter', 'manual', 'document', 'investigation', 'referral', 'pathway', 'assistant'));

-- WHICH WORKSPACE RAISED IT (s5 "originating workspace"). Free text against a short list rather than a
-- foreign key: these are screens, not rows.
alter table practice_follow_up add column if not exists origin_workspace text;
alter table practice_follow_up drop constraint if exists practice_follow_up_origin_workspace_allowed;
alter table practice_follow_up add constraint practice_follow_up_origin_workspace_allowed
  check (origin_workspace is null or origin_workspace in
    ('encounters', 'patients', 'follow_ups', 'documents', 'planner', 'session', 'pathways'));

-- ---- 2. DRAFT AND DEFERRED (CPR-FUP-002 s4) --------------------------------------------------------
--
-- Widened rather than replaced. DROP THEN ADD, because Postgres has no "add constraint if not exists".
-- The dropped name is the one Postgres generates for migration 196's INLINE column check.
alter table practice_follow_up drop constraint if exists practice_follow_up_status_check;
alter table practice_follow_up drop constraint if exists practice_follow_up_status_allowed;
alter table practice_follow_up add constraint practice_follow_up_status_allowed
  check (status in ('DRAFT', 'OPEN', 'SCHEDULED', 'DEFERRED', 'COMPLETED', 'MISSED', 'CANCELLED'));

-- A DEFERRAL WITHOUT A DATE IS AN OBLIGATION NOBODY WILL BE REMINDED OF AGAIN, which is the failure
-- mode this whole module exists to prevent. So the date is required whenever the status is DEFERRED.
alter table practice_follow_up add column if not exists deferred_until date;
alter table practice_follow_up drop constraint if exists practice_follow_up_deferred_needs_date;
alter table practice_follow_up add constraint practice_follow_up_deferred_needs_date
  check (status <> 'DEFERRED' or deferred_until is not null);

-- ---- 3. RESCHEDULING KEEPS THE ORIGINAL DATE (CPR-FUP-002 s7, s9) ----------------------------------
--
-- s7: "changing the due date preserves audit history. The original due date remains available in the
-- audit log." practice_follow_up_event (migration 196) already records status transitions with an actor
-- and a note. It has nowhere to put a DATE, so a reschedule could only be written as prose -- and prose
-- cannot answer "how many times has this been pushed", which is the question a deferred obligation
-- eventually raises.
alter table practice_follow_up_event add column if not exists from_due_on date;
alter table practice_follow_up_event add column if not exists to_due_on date;

-- ---- 4. PATHWAY TEMPLATES (CPR-FUP-003 s5) ---------------------------------------------------------
--
-- WARNING: A PATHWAY IS A PLAN, NOT A PROTOCOL. CPR-FUP-003 s2 says "not protocol enforcement" and
-- "supports deviations" in the same breath as "practitioner-controlled". Nothing in this schema may
-- refuse a deviation: every stage can be skipped, repeated, delayed or cancelled, and the record of
-- that is the point rather than the exception. A pathway that could not be departed from would be a
-- protocol wearing a plan's name, and it would be wrong for exactly the patients who need thinking
-- about.
create table if not exists practice_pathway_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  specialty text check (specialty is null or char_length(specialty) between 1 and 120),
  description text check (description is null or char_length(description) between 1 and 2000),
  -- s13 asks for version history. A template in use must not change under the patients already on it,
  -- so publishing a change makes a NEW version and supersedes the old one.
  version integer not null default 1,
  supersedes_template_id uuid references practice_pathway_template(id) on delete set null,
  is_active boolean not null default true,
  -- s5 "entry criteria" as recorded intent, not executable rules. A machine-evaluated criterion would
  -- make this protocol enforcement, which s2 forbids -- so it is text a practitioner reads before
  -- assigning, and assignment stays a decision somebody makes.
  entry_criteria text check (entry_criteria is null or char_length(entry_criteria) between 1 and 1000),
  exit_criteria text check (exit_criteria is null or char_length(exit_criteria) between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists idx_practice_pathway_template_ws on practice_pathway_template(workspace_id, is_active);
alter table practice_pathway_template enable row level security;

create table if not exists practice_pathway_stage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  template_id uuid not null references practice_pathway_template(id) on delete cascade,
  position integer not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- TIMING IS AN OFFSET IN DAYS FROM THE PREVIOUS STAGE, not a date. s6's example is "review after 2
  -- weeks", "after 3 months" -- relative to when the patient actually reached the stage before, which
  -- is the only thing a template can know.
  offset_days integer not null check (offset_days between 0 and 3650),
  required_action text check (required_action is null or char_length(required_action) between 1 and 400),
  -- s5 "completion rule". Recorded as the KIND of thing that closes the stage, so the engine can watch
  -- for it -- and `manual` is always permitted whatever this says, because s9 requires deviation.
  completion_rule text not null default 'encounter'
    check (completion_rule in ('encounter', 'procedure', 'investigation', 'manual')),
  -- The follow-up this stage raises when it is entered. Null means the stage raises nothing.
  follow_up_kind text,
  follow_up_priority text check (follow_up_priority is null or follow_up_priority in ('routine', 'soon', 'urgent')),
  created_at timestamptz not null default now(),
  created_by uuid
);

-- A template's stages are ordered, and two stages cannot share a position -- a pathway whose order is
-- ambiguous cannot say what "stage 3 of 5" means.
create unique index if not exists ux_practice_pathway_stage_position
  on practice_pathway_stage(template_id, position);
alter table practice_pathway_stage enable row level security;

-- ---- 5. A PATIENT ON A PATHWAY (CPR-FUP-003 s4, s10) -----------------------------------------------
--
-- s10: a patient may be on several at once (hydrocephalus AND epilepsy AND nutrition), so there is no
-- unique constraint on patient. What IS refused is the same patient on the same TEMPLATE twice while
-- both are live, which is a double-booking of the same plan rather than concurrent care.
create table if not exists practice_patient_pathway (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  template_id uuid not null references practice_pathway_template(id) on delete restrict,
  -- The encounter it was started from, when there was one (s6's trigger events).
  origin_encounter_id uuid references practice_encounter(id) on delete set null,
  trigger text not null default 'manual'
    check (trigger in ('diagnosis', 'procedure', 'first_consultation', 'referral', 'manual', 'import')),
  -- ACTIVE / COMPLETED / STOPPED. `stopped` covers s9's "end pathway early" and s4's "interruption":
  -- one word, because the difference between abandoning and finishing early is a REASON, not a state.
  status text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  stopped_reason text check (stopped_reason is null or char_length(stopped_reason) between 1 and 500),
  started_on date not null default current_date,
  ended_on date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table practice_patient_pathway drop constraint if exists practice_patient_pathway_ended_complete;
alter table practice_patient_pathway add constraint practice_patient_pathway_ended_complete
  check ((status = 'active' and ended_on is null) or (status <> 'active' and ended_on is not null));

-- One live enrolment per patient per template. Partial, so a patient may be re-enrolled on the same
-- pathway years later without the old record standing in the way.
create unique index if not exists ux_practice_patient_pathway_live
  on practice_patient_pathway(patient_id, template_id)
  where status = 'active';

create index if not exists idx_practice_patient_pathway_patient
  on practice_patient_pathway(patient_id, status);
alter table practice_patient_pathway enable row level security;

-- ---- 6. THE STAGES A PATIENT HAS ACTUALLY REACHED --------------------------------------------------
--
-- WARNING: THIS IS HISTORY, NOT A POINTER. It would be smaller to keep `current_stage_id` on the
-- enrolment above and move it along. That would also destroy the thing s4 asks to "preserve" and s14
-- asks to audit: which stages were entered, when, which were SKIPPED, which were repeated. s9 permits
-- repeating a stage, so the same stage may appear here more than once -- which a pointer cannot express
-- at all.
create table if not exists practice_patient_pathway_stage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_pathway_id uuid not null references practice_patient_pathway(id) on delete cascade,
  stage_id uuid not null references practice_pathway_stage(id) on delete restrict,
  -- entered: the patient is on it now. The rest are how it ended.
  state text not null default 'entered'
    check (state in ('entered', 'completed', 'skipped', 'cancelled')),
  entered_on date not null default current_date,
  due_on date,
  ended_on date,
  -- What closed it, when something did. Null for a manual advance, which is always permitted.
  closing_encounter_id uuid references practice_encounter(id) on delete set null,
  -- The obligation this stage raised, so the engine can tell whether it already raised one (s8: "no
  -- duplicate active follow-ups").
  follow_up_id uuid references practice_follow_up(id) on delete set null,
  note text check (note is null or char_length(note) between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_pathway_stage_progress
  on practice_patient_pathway_stage(patient_pathway_id, entered_on);
-- One live stage per enrolment. A patient cannot be at two points of the same pathway at once, and
-- without this a double advance would silently produce two.
create unique index if not exists ux_practice_pathway_stage_one_live
  on practice_patient_pathway_stage(patient_pathway_id)
  where state = 'entered';
alter table practice_patient_pathway_stage enable row level security;

-- ---- 7. THE PATHWAY AUDIT TRAIL (CPR-FUP-003 s14) --------------------------------------------------
--
-- Its own table rather than practice_audit_event, because s10's deviations are the thing this module is
-- judged on -- "every deviation is audited" is stated twice -- and a deviation history somebody has to
-- filter a general audit log to reconstruct is one nobody will reconstruct.
create table if not exists practice_pathway_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_pathway_id uuid not null references practice_patient_pathway(id) on delete cascade,
  stage_id uuid references practice_pathway_stage(id) on delete set null,
  event_type text not null check (event_type in (
    'assigned', 'stage_entered', 'stage_completed', 'stage_skipped', 'stage_delayed',
    'stage_cancelled', 'stage_repeated', 'pathway_completed', 'pathway_stopped')),
  -- The practitioner's reason. Required for the deviations, because a skipped stage with no reason is
  -- the record of a decision without the decision.
  reason text check (reason is null or char_length(reason) between 1 and 1000),
  occurred_at timestamptz not null default now(),
  actor_id uuid
);

create index if not exists idx_practice_pathway_event_pathway
  on practice_pathway_event(patient_pathway_id, occurred_at desc);
alter table practice_pathway_event enable row level security;

-- ---- 8. CAPABILITIES -------------------------------------------------------------------------------
--
-- WARNING: THESE ARE SEEDED HERE, WHICH IS WHY THEY MAY BE USED. A capability code is a string compared
-- against practice_role_capabilities. An invented one compiles perfectly and returns 403 for every user
-- INCLUDING the practice owner, so the feature is simply unreachable and nothing errors. Six have
-- shipped in this codebase that way.
--
-- Designing a pathway is a different act from putting a patient on one: the first is practice
-- configuration, the second is a clinical decision. The owner gets neither -- migration 191 withholds
-- clinical access from the business role and that is not undone here.
insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'pathway.design'),
  ('practitioner', 'pathway.assign'),
  ('practice_assistant', 'pathway.view'),
  ('practitioner', 'pathway.view')
on conflict do nothing;

-- ---- 9. RLS ----------------------------------------------------------------------------------------
alter table practice_follow_up enable row level security;
alter table practice_follow_up_event enable row level security;

notify pgrst, 'reload schema';
