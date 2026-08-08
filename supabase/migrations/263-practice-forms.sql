-- MIGRATION 263: PRACTICE FORMS (CPR-KS-001 section 4, Phase 3)
--
-- Form, question, submission and answer, for a practice_workspace. Section 4's thirteen offered
-- kinds, its eleven storable question types, its range and mandatory rules, its conditional
-- questions and a narrow calculated field.
--
-- NOT the patient registration form (that is one per practice, resolved automatically for every
-- registration, with its answers written onto the patient row), NOT a checklist (migration 262's
-- answer column is a CHECK over three values on purpose), NOT a guidance document (prose with eight
-- named sections and nowhere to record an answer), and NOT a note template (a body of text applied
-- to a patient inside a consultation).
--
-- Approval routes through the existing practice_approval_request with subject_kind 'other', so there
-- is no approval migration.
--
-- WARNING: NOTHING IN THIS SCHEMA CHECKS THAT AN ANSWER IS TRUE, AND NO COLUMN HERE IS A SIGNATURE.
-- A completed consent form records that somebody with a practice login typed answers. There is no
-- handwritten mark, no drawing, no attachment and no fresh identity check anywhere in this build,
-- and the asset says so on screen and on paper.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql, and no semicolon anywhere
-- except ending a statement.
-- ============================================================

-- ---- 1. The form ----------------------------------------------------------------------------

create table if not exists practice_form (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- The practice's own reference, e.g. CONS-01. Not a uuid: it is what people say out loud, and the
  -- partial unique index below is about this and not about the id.
  code text not null check (btrim(code) <> '' and char_length(code) <= 40),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  purpose text check (purpose is null or char_length(purpose) <= 600),

  -- WARNING: THIRTEEN KINDS, AND SECTION 4 NAMES FOURTEEN. The fourteenth is "Registration forms" and
  -- it is left out on purpose: this product already has one, it is a different object with a floor
  -- of its own, and a second thing called the registration form that the registration desk never
  -- sees is a support call waiting to happen. FORM_TYPE_NOT_OFFERED says so on the screen.
  -- WARNING: A FOURTEENTH KIND IS A MIGRATION BEFORE THE UI OFFERS IT, NEVER AFTER. A studio that
  -- lets somebody invent a kind produces rows the DATABASE rejects and no front-end work fixes it.
  form_type text not null check (form_type in (
    'clinical_assessment', 'referral', 'consent', 'procedure', 'audit', 'research',
    'questionnaire', 'patient_survey', 'risk_assessment', 'inspection', 'incident',
    'teaching', 'custom')),

  -- WARNING: WHAT ONE COMPLETED FORM IS ABOUT, DECLARED ON THE FORM. TWO VALUES AND NOT THREE, which
  -- is migration 262's decision taken again: "you may name a patient" means half a practice's
  -- consent forms have one and nothing can then tell a deliberate omission from a forgotten one.
  -- WARNING: THE MATCH IS THE ENGINE'S RULE, NOT A CONSTRAINT. This column is on the form and the
  -- patient is on the submission, and a CHECK cannot see a sibling table.
  subject text not null default 'none' check (subject in ('patient', 'none')),

  specialty text,
  tags text[] not null default '{}'
    check (array_length(tags, 1) is null or array_length(tags, 1) <= 12),

  -- ACCOUNTABILITY, NOT PERMISSION. Naming an owner does not restrict who may edit, and the screen
  -- says so -- an owner column that looked like an access rule and was not would be worse than none.
  owner_id uuid,

  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
  version integer not null default 1 check (version >= 1),

  -- EVERY VERSION IS A ROW, linked backwards, because a completed form names the version it answered
  -- and a reader has to be able to open the questions that were actually in front of the person.
  supersedes_id uuid references practice_form(id) on delete set null,

  -- WARNING: NO `on delete` CLAUSE, AND IT IS THE CONSIDERED CHOICE OF THREE, exactly as migrations
  -- 256 and 262 reasoned. Deleting the approval out from under a form in use would leave it in use
  -- with nothing behind it, so a lone deletion must be refused -- but `on delete restrict` checks
  -- IMMEDIATELY and both tables cascade from practice_workspace, so dropping a workspace could abort
  -- depending on which cascade Postgres ran first. `on delete set null` is worse: it is an UPDATE, so
  -- it would trip practice_form_in_force on any published row. The DEFAULT (`no action`) is checked
  -- at END OF STATEMENT, which refuses the lone deletion and lets the workspace cascade run.
  approval_request_id uuid references practice_approval_request(id),

  -- A DATE, NOT A TIMESTAMP. "In use from 1 January" is a day, and rendering a timezone-shifted
  -- instant for it is how a form appears to start the evening before.
  effective_from date,
  review_on date,

  published_at timestamptz,
  published_by uuid,
  archived_at timestamptz,
  archived_reason text,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  -- WARNING: IN USE MEANS IN USE, AND IT NEEDS BOTH FACTS. THE ENGINE DOES NOT REPEAT THIS -- it
  -- reports the gap so somebody sees it before trying, and when they try anyway the database refuses
  -- and the constraint is named in the refusal.
  -- WARNING: WHAT IT CANNOT SEE: whether that approval was actually DECIDED. A PENDING request
  -- satisfies this constraint. APPROVAL_DECIDED in form-constants.ts is the engine's, and the split
  -- of authority is written down so nobody later assumes the database covered both.
  constraint practice_form_in_force
    check (status <> 'published'
           or (effective_from is not null and approval_request_id is not null)),

  constraint practice_form_review_after_effect
    check (review_on is null or effective_from is null or review_on > effective_from),

  -- WARNING: `btrim(...) <> ''` AND NOT `is not null`. Migration 257's correction, applied the first
  -- time: a blank string is not null, so `is not null` alone lets somebody withdraw a consent form by
  -- pressing the space bar.
  constraint practice_form_archived_reason
    check (status <> 'archived'
           or (archived_reason is not null and btrim(archived_reason) <> '')),

  constraint practice_form_not_self_superseding
    check (supersedes_id is null or supersedes_id <> id)
);

-- WARNING: ONE REFERENCE, ONE FORM IN USE, AND IT IS PARTIAL ON PURPOSE. A practice may hold ten
-- drafts of CONS-01 and exactly one in use. Two forms in use under one reference is how half a
-- practice fills in a different set of questions, and no amount of engine care prevents it if the
-- database allows it. Publishing a new version therefore requires withdrawing the old one, in that
-- order.
create unique index if not exists ux_practice_form_published_code
  on practice_form(workspace_id, lower(code)) where status = 'published';

create index if not exists idx_practice_form_library
  on practice_form(workspace_id, status, form_type);
create index if not exists idx_practice_form_review_due
  on practice_form(workspace_id, review_on) where status = 'published';
create index if not exists idx_practice_form_supersedes
  on practice_form(supersedes_id) where supersedes_id is not null;

-- ---- 2. The questions -------------------------------------------------------------------------
--
-- WARNING: THE ELEVEN TYPES ARE MIGRATION 223's NINE, IN 223's ORDER, PLUS TWO. That ordering is
-- load-bearing rather than tidy: practice_registration_field.field_type carries the same nine as a
-- CHECK, and PRACTICE_FIELD_TYPES in form-field.ts carries all eleven, and the harness asserts the
-- three lists against one another including against 223's SQL text. If they drift, an author builds
-- a form whose submission the database refuses and the practitioner has no way to tell which of the
-- choices on their own screen was the impossible one.
--
-- `time` is added because section 4 names it. `calculated` is added because section 4 asks for
-- calculated fields -- narrowed here to adding up or counting other answers, with no expression
-- language anywhere, and nothing of the sort is added to the registration table.

create table if not exists practice_form_field (
  id uuid primary key default gen_random_uuid(),

  -- WARNING: DENORMALISED FROM THE PARENT ON PURPOSE. It lets every write scope itself IN THE UPDATE
  -- STATEMENT rather than after a prior read -- a bulk write verified by an earlier read is one that
  -- writes whatever it was passed if the read and the write disagree. Written on insert, never after.
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  form_id uuid not null references practice_form(id) on delete cascade,

  -- THE STABLE NAME A CONDITION AND A CALCULATION POINT AT. Same pattern and same regex as
  -- practice_registration_field.field_key, so one authoring habit covers both.
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,40}$'),

  -- NULL means the question is not under a heading. The btrim guard is there because a section of
  -- spaces renders as a heading with no name.
  section text check (section is null or (btrim(section) <> '' and char_length(section) <= 120)),

  position integer not null check (position >= 1),
  label text not null check (btrim(label) <> '' and char_length(label) <= 240),
  help text check (help is null or char_length(help) <= 2000),

  field_type text not null default 'text' check (field_type in (
    'text', 'long_text', 'number', 'date', 'select', 'multi_select', 'boolean', 'phone', 'email',
    'time', 'calculated')),

  -- REQUIRED means a completed form cannot be submitted without an answer to it. An answer of spaces
  -- is not an answer -- see practice_form_answer_not_empty below, and isBlankAnswer in form-field.ts,
  -- which are the same rule in the two places it has to hold.
  required boolean not null default true,

  -- [{"value":"yes","label":"Agreed"}]. A select with nothing in it is refused at publish by
  -- RULES_COHERENT rather than by a CHECK, because "this type needs options" is a fact about two
  -- columns at once and a CHECK reading both would have to be rewritten for every new type.
  options jsonb not null default '[]'::jsonb,

  -- Section 4's Ranges and Calculations. {"min":0,"max":10} or
  -- {"calculate":{"of":"sum","fields":["a","b"]}}. WARNING: THERE IS NO `pattern` KEY AND THERE MAY
  -- NEVER BE ONE. An author-written regular expression run on the server for every submission is a
  -- denial of service somebody can create by accident. validateAnswer refuses a rules object carrying
  -- one BY NAME rather than ignoring it, so an author finds out at once instead of believing a rule
  -- is in force.
  rules jsonb,

  -- Section 4's "Conditional questions", and it is practice_registration_field.condition's COLUMN,
  -- shape for shape. Three forms and no fourth --
  --   {"when": "has_allergy", "equals": "yes"}
  --   {"when": "referral_source", "in": ["gp", "self"]}
  --   {"when": "weight_kg", "isPresent": true}
  -- `when` is another question's field_key ON THIS FORM and the value compared against is THAT
  -- QUESTION'S ANSWER -- which is the difference from migration 262, where it was one of three
  -- response codes. Evaluated by ONE function, conditionMet in registration-condition.ts, which the
  -- server and the fill-in screen both import.
  -- WARNING: NOT A CHECK CONSTRAINT: whether a condition names a question that exists, and one that
  -- comes EARLIER, is a fact about sibling rows. CONDITIONS_RESOLVE is the engine's, at publish.
  condition jsonb,

  created_at timestamptz not null default now()
);

-- One question per name, and one question per slot. The second is not redundant: without it two
-- questions can both claim position 3 and the order of a consent form becomes whatever the planner
-- returns.
create unique index if not exists ux_practice_form_field_key
  on practice_form_field(form_id, field_key);
create unique index if not exists ux_practice_form_field_position
  on practice_form_field(form_id, position);
create index if not exists idx_practice_form_field_list
  on practice_form_field(form_id, position);

-- ---- 3. The completed form --------------------------------------------------------------------

create table if not exists practice_form_submission (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- WARNING: NO `on delete` CLAUSE, DELIBERATELY. Deleting a form would take with it the record of
  -- what people answered against it, which is the one thing nobody may lose. The default
  -- (`no action`) refuses the lone deletion and is checked at END OF STATEMENT, so the workspace
  -- cascade that removes both still succeeds. Withdrawing a form is `archived`, never a delete.
  form_id uuid not null references practice_form(id),

  -- WARNING: WHICH VERSION WAS ON THE SCREEN. Snapshotted rather than joined, because the form can be
  -- revised and a reader of last year's record has to see which questions were actually asked. It is
  -- a number and not a copy of the questions -- the questions are immutable once published, since
  -- editing anything that is not a draft is refused.
  form_version integer not null check (form_version >= 1),

  -- WARNING: NO `on delete` CLAUSE HERE EITHER. A patient row is never deleted by this product -- a
  -- merge marks the loser `merged` with merged_into_patient_id -- so nothing legitimate is blocked,
  -- and `on delete set null` would quietly strip the subject off a completed form.
  -- WARNING: THE KNOWN GAP: mergePatients() repoints a fixed list of child tables and this is not on
  -- it, so a merged patient's completed forms stay attached to the row that was merged away.
  -- Declared in FORM_KNOWN_GAPS and shown on screen, because a gap recorded only in a commit message
  -- is one the next person rediscovers as a bug.
  patient_id uuid references practice_patient(id),

  -- Which clinic, which visit, which machine. Free text, because the alternative is a location
  -- vocabulary this phase has no business inventing.
  context_note text check (context_note is null or char_length(context_note) <= 200),

  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'abandoned')),

  started_at timestamptz not null default now(),
  started_by uuid,
  submitted_at timestamptz,
  submitted_by uuid,
  abandoned_reason text,

  -- A record marked submitted with no time on it cannot be read as a record of anything.
  constraint practice_form_submission_submitted
    check (status <> 'submitted' or submitted_at is not null),

  -- Started and left, with no word about why, tells the next person nothing. Written with btrim for
  -- migration 257's reason.
  constraint practice_form_submission_abandoned_reason
    check (status <> 'abandoned'
           or (abandoned_reason is not null and btrim(abandoned_reason) <> ''))
);

create index if not exists idx_practice_form_submission_list
  on practice_form_submission(workspace_id, form_id, started_at desc);
create index if not exists idx_practice_form_submission_open
  on practice_form_submission(workspace_id, status) where status = 'in_progress';
create index if not exists idx_practice_form_submission_patient
  on practice_form_submission(workspace_id, patient_id) where patient_id is not null;

-- ---- 4. The answers ---------------------------------------------------------------------------
--
-- WARNING: ONE ROW PER ANSWER AND NOT ONE jsonb BLOB PER SUBMISSION, and this is the one place this
-- phase deliberately does NOT copy the registration model. custom_fields is a blob because it belongs
-- to a person and is read whole. A form answer has to be countable across submissions -- section 4
-- lists Analytics as an output -- and a blob makes that a jsonb scan over every completed form. It
-- also makes "which answers were cleared when a condition withdrew a question" a read-modify-write of
-- the whole record, which is exactly the shape that loses somebody else's concurrent answer.

create table if not exists practice_form_answer (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  submission_id uuid not null references practice_form_submission(id) on delete cascade,

  -- WARNING: NO `on delete` CLAUSE. Deleting a question somebody has already answered would erase the
  -- answer and leave the record shorter than it was, with nothing saying so. Through the engine it
  -- cannot happen -- only a draft is editable and a form may only be filled in when published -- but
  -- a direct write must be refused rather than allowed to cascade quietly.
  field_id uuid not null references practice_form_field(id),

  -- jsonb, because an answer is a string, a number, a boolean or a list depending on the question,
  -- and eleven typed columns would be ten nulls per row. The TYPE is the question's, not this
  -- column's, and validateAnswer in form-field.ts is what makes the two agree before anything is
  -- written -- it returns the NORMALISED value and the engine writes that rather than what it was
  -- given, so "12" from an HTML input is stored as the number 12.
  value jsonb not null,

  answered_at timestamptz not null default now(),
  answered_by uuid,

  -- WARNING: AN ANSWER OF SPACES IS NOT AN ANSWER, AND NEITHER IS AN EMPTY LIST. This is migration
  -- 257's `btrim` correction carried onto a jsonb column, and it is load-bearing rather than tidy:
  -- without it, a required question could be satisfied with the space bar, the form would submit, and
  -- the completed record would show a blank beside a question that the engine had counted as
  -- answered. There is no row for an unanswered question, so "unanswered" and "answered blank" can
  -- never be confused for one another.
  constraint practice_form_answer_not_empty
    check (value <> 'null'::jsonb
           and (jsonb_typeof(value) <> 'string' or btrim(value #>> '{}') <> '')
           and (jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 0))
);

-- One answer per question per completed form.
create unique index if not exists ux_practice_form_answer_once
  on practice_form_answer(submission_id, field_id);
create index if not exists idx_practice_form_answer_submission
  on practice_form_answer(submission_id);
-- Section 4's Analytics output would start here: every answer to one question, across every completed
-- form. Nothing reads it yet and FORM_OUTPUTS says so.
create index if not exists idx_practice_form_answer_field
  on practice_form_answer(workspace_id, field_id);

-- ---- Capabilities ------------------------------------------------------------------------------
--
-- NONE MINTED. Reading takes document.view, authoring takes template.manage, and FILLING ONE IN takes
-- task.manage -- probed live, 50 codes seeded, no form.* among them. task.manage is an approximation
-- and is declared as one in form-constants.ts: it is the closest seeded code for "recording that
-- practice work was done" and it is held by practitioner, practice_assistant and practice_owner,
-- which is the right audience. The honest consequence is that anybody who can close a task can fill
-- in a form, including a consent form. Six invented capability codes have shipped in this product --
-- an invented code compiles, 403s for everybody including the practice owner, and errors nowhere.

-- ---- RLS: deny-by-default ----------------------------------------------------------------------
alter table practice_form enable row level security;
alter table practice_form_field enable row level security;
alter table practice_form_submission enable row level security;
alter table practice_form_answer enable row level security;

notify pgrst, 'reload schema';
