-- MIGRATION 262: PRACTICE CHECKLISTS (CPR-KS-001 Engine 5, Phase 2)
--
-- Definition, item, run and response, for a practice_workspace. Engine 5's nine kinds and its six
-- capabilities -- tick boxes, conditional items, mandatory items, electronic completion, printing,
-- mobile mode.
--
-- NOT a guidance document (that is prose with eight named sections and nowhere to record a tick),
-- NOT a registration template (that is THE patient registration form, one per practice), NOT a task
-- template (migration 211 explicitly avoided being a checklist), and NOT skill_checklists (that is
-- the competency estate, keyed on competency_skills with no workspace_id anywhere).
--
-- Approval routes through the existing practice_approval_request with subject_kind 'other', so
-- there is no approval migration.
--
-- WARNING: NOTHING IN THIS SCHEMA CHECKS THAT AN ITEM WAS DONE. A response row records what a named person
-- said at a recorded time. There is no corroboration, no observation and no enforcement anywhere in
-- this product, and the asset says so on screen and on paper.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql, and no semicolon anywhere
-- except ending a statement.
-- ============================================================

-- ---- 1. The definition ----------------------------------------------------------------------

create table if not exists practice_checklist (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- The practice's own reference, e.g. WHO-01. Not a uuid: it is what people say out loud and write
  -- on a theatre wall, and the partial unique index below is about this and not about the id.
  code text not null check (btrim(code) <> '' and char_length(code) <= 40),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  purpose text check (purpose is null or char_length(purpose) <= 600),

  -- WARNING: THE NINE KINDS OF CPR-KS-001 ENGINE 5, AS A CHECK. The line the survey drew at its section 8
  -- and Phase 1 drew again: a studio offering a tenth kind produces rows the DATABASE rejects, and
  -- no front-end work fixes it. A tenth kind is a migration BEFORE the UI offers it, never after.
  checklist_type text not null check (checklist_type in (
    'who', 'ward_round', 'discharge', 'procedure', 'audit',
    'clinic', 'inspection', 'equipment', 'cpd')),

  -- WARNING: WHAT ONE COMPLETION IS ABOUT, DECLARED ON THE DEFINITION. A discharge checklist with no
  -- patient on it is a record nobody can use. An equipment checklist WITH a patient on it has put a
  -- machine in somebody's file. TWO VALUES AND NOT THREE: an optional-patient kind was drafted and
  -- cut, because "you may name a patient" means half a practice's discharge records have one and
  -- nothing can then tell a deliberate omission from a forgotten one.
  -- WARNING: THE MATCH IS THE ENGINE'S RULE, NOT A CONSTRAINT. This column is on the definition and the
  -- patient is on the run, and a CHECK cannot see a sibling table.
  run_subject text not null default 'none' check (run_subject in ('patient', 'none')),

  specialty text,
  -- Section 8 wants search by tag. Capped, because a hundred tags is a checklist nobody filed.
  tags text[] not null default '{}'
    check (array_length(tags, 1) is null or array_length(tags, 1) <= 12),

  -- ACCOUNTABILITY, NOT PERMISSION. Naming an owner does not restrict who may edit, and the screen
  -- says so -- an owner column that looked like an access rule and was not would be worse than none.
  owner_id uuid,

  -- CPR-KS-001 section 3's five, the same ladder Phase 1 built. `in_review` and not `review`,
  -- because `review_on` on this same row means something entirely different.
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
  version integer not null default 1 check (version >= 1),

  -- EVERY VERSION IS A ROW, linked backwards, so an earlier version is a checklist you can OPEN.
  -- That matters more here than for guidance: a completion record names the version it answered,
  -- and a reader has to be able to see the list that was actually in front of the person ticking.
  supersedes_id uuid references practice_checklist(id) on delete set null,

  -- THE APPROVAL, IN THE EXISTING GENERIC ENGINE. subject_kind 'other' already exists, so this
  -- reference is the whole of the approval integration.
  --
  -- WARNING: NO `on delete` CLAUSE, AND IT IS THE CONSIDERED CHOICE OF THREE, exactly as migration 256
  -- reasoned. Deleting the approval out from under a checklist in use would leave it in use with
  -- nothing behind it, so a lone deletion must be refused -- but `on delete restrict` checks
  -- IMMEDIATELY and both tables cascade from practice_workspace, so dropping a workspace could abort
  -- depending on which cascade Postgres ran first. `on delete set null` is worse: it is an UPDATE,
  -- so it would trip practice_checklist_in_force on any published row. The DEFAULT (`no action`) is
  -- checked at END OF STATEMENT, which refuses the lone deletion and lets the workspace cascade run.
  approval_request_id uuid references practice_approval_request(id),

  -- A DATE, NOT A TIMESTAMP. "In use from 1 January" is a day, and rendering a timezone-shifted
  -- instant for it is how a checklist appears to start the evening before.
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

  -- WARNING: IN USE MEANS IN USE, AND IT NEEDS BOTH FACTS. A checklist nobody approved, or one with no date
  -- it starts, is not something a theatre should be ticking. THE ENGINE DOES NOT REPEAT THIS -- it
  -- reports the gap so somebody sees it before trying, and when they try anyway the database refuses
  -- and the constraint is named in the refusal.
  -- WARNING: WHAT IT CANNOT SEE: whether that approval was actually DECIDED. A PENDING request satisfies
  -- this constraint. APPROVAL_DECIDED in checklist-constants.ts is the engine's, and the split of
  -- authority is written down so nobody later assumes the database covered both.
  constraint practice_checklist_in_force
    check (status <> 'published'
           or (effective_from is not null and approval_request_id is not null)),

  -- A review date on or before the day it starts is a checklist born overdue.
  constraint practice_checklist_review_after_effect
    check (review_on is null or effective_from is null or review_on > effective_from),

  -- WITHDRAWING A CHECKLIST WITHOUT SAYING WHY leaves the next person unable to tell "superseded"
  -- from "found to be wrong", which is the only thing they need to know.
  -- WARNING: `btrim(...) <> ''` AND NOT `is not null`. This is migration 257's correction, applied the
  -- first time rather than a year later: a blank string is not null, so `is not null` alone lets
  -- somebody withdraw a safety checklist by pressing the space bar.
  constraint practice_checklist_archived_reason
    check (status <> 'archived'
           or (archived_reason is not null and btrim(archived_reason) <> '')),

  constraint practice_checklist_not_self_superseding
    check (supersedes_id is null or supersedes_id <> id)
);

-- WARNING: THE RULE THAT DOES THE MOST WORK, AND IT IS PARTIAL ON PURPOSE. A practice may hold ten drafts
-- of WHO-01 and exactly ONE in use. Two checklists in use under one reference is how half a theatre
-- ticks a different list, and no amount of engine care prevents it if the database allows it.
-- Publishing a new version therefore requires withdrawing the old one, in that order.
create unique index if not exists ux_practice_checklist_published_code
  on practice_checklist(workspace_id, lower(code)) where status = 'published';

create index if not exists idx_practice_checklist_library
  on practice_checklist(workspace_id, status, checklist_type);
create index if not exists idx_practice_checklist_review_due
  on practice_checklist(workspace_id, review_on) where status = 'published';
create index if not exists idx_practice_checklist_supersedes
  on practice_checklist(supersedes_id) where supersedes_id is not null;

-- ---- 2. The items -----------------------------------------------------------------------------
--
-- The shape of checklist_items (migrations 007 and 020), which already solved sections, criticality
-- and required items -- rebuilt for the practice tenancy because that table is keyed on
-- competency_skills and has no workspace_id.

create table if not exists practice_checklist_item (
  id uuid primary key default gen_random_uuid(),

  -- WARNING: DENORMALISED FROM THE PARENT ON PURPOSE, and this is not laziness. It lets every write scope
  -- itself IN THE UPDATE STATEMENT rather than after a prior read -- a bulk write verified by an
  -- earlier read is one that writes whatever it was passed if the read and the write disagree.
  -- Written from the parent on insert and never afterwards. Nothing updates it.
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  checklist_id uuid not null references practice_checklist(id) on delete cascade,

  -- WARNING: THE STABLE NAME A CONDITION CAN POINT AT, and the reason an item needs one at all. A condition
  -- says {"when": "known_allergy", "equals": "done"}, so the thing it names has to survive an item
  -- being renamed or moved. Same pattern as practice_registration_field.field_key, same regex, so
  -- one authoring habit covers both.
  item_key text not null check (item_key ~ '^[a-z][a-z0-9_]{1,40}$'),

  -- checklist_items.section (migration 020). NULL means the item is not under a heading -- and the
  -- btrim guard is there because a section of spaces renders as a heading with no name.
  section text check (section is null or (btrim(section) <> '' and char_length(section) <= 120)),

  position integer not null check (position >= 1),
  label text not null check (btrim(label) <> '' and char_length(label) <= 240),
  detail text check (detail is null or char_length(detail) <= 2000),

  -- REQUIRED means a completion record cannot be closed without an answer to it.
  -- CRITICAL is checklist_items.is_critical -- "must pass" there, and here it means the answer is
  -- carried onto the record and the printed page whatever it was. WARNING: IT DOES NOT BLOCK COMPLETION.
  -- A checklist that refuses to close because a step was not done is a checklist people close by
  -- ticking the box. The engine records it instead, prominently, and never hides it.
  required boolean not null default true,
  is_critical boolean not null default false,

  -- WARNING: CPR-KS-001 ENGINE 5's "conditional items", AND IT IS practice_registration_field.condition's
  -- COLUMN, SHAPE FOR SHAPE. Three forms and no fourth --
  --   {"when": "known_allergy", "equals": "done"}
  --   {"when": "referral_source", "in": ["done", "not_applicable"]}
  --   {"when": "known_allergy", "isPresent": true}
  -- `when` is another item's item_key ON THIS CHECKLIST and the value compared against is that
  -- item's RESPONSE CODE. Evaluated by ONE function -- conditionMet in registration-condition.ts --
  -- which the server and the run screen both import. Two evaluators would disagree eventually, and
  -- the one that mattered would be the server's, silently, after somebody had ticked the whole list.
  -- WARNING: NOT A CHECK CONSTRAINT: whether a condition names an item that exists, and one that comes
  -- EARLIER, is a fact about sibling rows. CONDITIONS_RESOLVE in checklist-constants.ts is the
  -- engine's and is enforced at publish.
  condition jsonb,

  created_at timestamptz not null default now()
);

-- One item per key, and one item per slot. The second is not redundant: without it two items can
-- both claim position 3 and the order of a safety checklist becomes whatever the planner returns.
create unique index if not exists ux_practice_checklist_item_key
  on practice_checklist_item(checklist_id, item_key);
create unique index if not exists ux_practice_checklist_item_position
  on practice_checklist_item(checklist_id, position);
create index if not exists idx_practice_checklist_item_list
  on practice_checklist_item(checklist_id, position);

-- ---- 3. The completion record -----------------------------------------------------------------
--
-- One filling-in of one checklist. The analogue of `assessments`, which is what migration 009 used
-- to group checklist_responses, and it is unavoidable: without it a response has nothing to belong
-- to and the same item answered on two occasions collides.

create table if not exists practice_checklist_run (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- WARNING: NO `on delete` CLAUSE, DELIBERATELY. Deleting a checklist definition would take with it the
  -- record of what people ticked against it, which is the one thing nobody may lose. The default
  -- (`no action`) refuses the lone deletion and is checked at END OF STATEMENT, so the workspace
  -- cascade that removes both still succeeds. Withdrawing a checklist is `archived`, never a delete.
  checklist_id uuid not null references practice_checklist(id),

  -- WARNING: WHICH VERSION WAS ON THE SCREEN. Snapshotted rather than joined, because the definition can be
  -- revised and a reader of last year's record has to see which list was actually in front of the
  -- person ticking. It is a number, not a copy of the items -- the items themselves are immutable
  -- once published, since editing anything that is not a draft is refused.
  checklist_version integer not null check (checklist_version >= 1),

  -- WARNING: NO `on delete` CLAUSE HERE EITHER. A patient row is never deleted by this product -- a merge
  -- marks the loser `merged` with merged_into_patient_id -- so nothing legitimate is being blocked,
  -- and `on delete set null` would quietly strip the subject off a completion record.
  -- WARNING: THE KNOWN GAP: mergePatients() repoints a fixed list of child tables and this is not on it, so
  -- a merged patient's completion records stay attached to the row that was merged away. Declared in
  -- CHECKLIST_KNOWN_GAPS and shown on screen, because a gap recorded only in a commit message is one
  -- the next person rediscovers as a bug.
  patient_id uuid references practice_patient(id),

  -- Which theatre, which round, which machine. Free text, because the alternative is a location
  -- vocabulary this phase has no business inventing.
  context_note text check (context_note is null or char_length(context_note) <= 200),

  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),

  started_at timestamptz not null default now(),
  started_by uuid,
  completed_at timestamptz,
  completed_by uuid,
  abandoned_reason text,

  -- A record marked completed with no time on it cannot be read as a record of anything.
  constraint practice_checklist_run_completed
    check (status <> 'completed' or completed_at is not null),

  -- Started and left, with no word about why, tells the next person nothing. Same rule as a
  -- withdrawn checklist, and written with btrim for migration 257's reason.
  constraint practice_checklist_run_abandoned_reason
    check (status <> 'abandoned'
           or (abandoned_reason is not null and btrim(abandoned_reason) <> ''))
);

create index if not exists idx_practice_checklist_run_list
  on practice_checklist_run(workspace_id, checklist_id, started_at desc);
create index if not exists idx_practice_checklist_run_open
  on practice_checklist_run(workspace_id, status) where status = 'in_progress';
create index if not exists idx_practice_checklist_run_patient
  on practice_checklist_run(workspace_id, patient_id) where patient_id is not null;

-- ---- 4. The answers ---------------------------------------------------------------------------

create table if not exists practice_checklist_response (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  run_id uuid not null references practice_checklist_run(id) on delete cascade,

  -- WARNING: NO `on delete` CLAUSE. Deleting an item that somebody has already answered would erase the
  -- answer and leave the record shorter than it was, with nothing saying so. Through the engine it
  -- cannot happen -- only a draft is editable and a run may only be started against a published
  -- checklist -- but a direct write must be refused rather than allowed to cascade quietly.
  item_id uuid not null references practice_checklist_item(id),

  -- THREE ANSWERS AND NO FOURTH, from checklist_responses' yes/no/na (migration 009), renamed to
  -- what a checklist means. WARNING: THERE IS NO 'not_answered' VALUE: an item nobody answered has NO ROW,
  -- so "unanswered" and "answered not done" can never be confused for one another.
  response text not null check (response in ('done', 'not_done', 'not_applicable')),
  note text check (note is null or char_length(note) <= 1000),

  responded_at timestamptz not null default now(),
  responded_by uuid,

  -- WARNING: "NOT APPLICABLE" WITH NO WORDS IS THE ENTRY THAT HIDES A SKIPPED STEP. The database refuses it.
  -- Not done is deliberately NOT covered: an optional item that simply was not done is an honest
  -- answer, and demanding a sentence for it is how people learn to type a full stop. The engine
  -- requires words for a CRITICAL item marked not done, which is a fact about a sibling row and
  -- therefore cannot be a CHECK.
  constraint practice_checklist_response_na_reason
    check (response <> 'not_applicable' or (note is not null and btrim(note) <> ''))
);

-- One answer per item per run. checklist_responses' unique(assessment_id, checklist_item_id).
create unique index if not exists ux_practice_checklist_response_once
  on practice_checklist_response(run_id, item_id);
create index if not exists idx_practice_checklist_response_run
  on practice_checklist_response(run_id);

-- ---- Capabilities ------------------------------------------------------------------------------
--
-- NONE MINTED. Reading takes document.view, authoring takes template.manage, and FILLING ONE IN
-- takes task.manage -- probed live, 50 codes seeded, no checklist.* among them. task.manage is an
-- approximation and is declared as one in checklist-constants.ts: it is the closest seeded code for
-- "recording that practice work was done" and it is held by practitioner, practice_assistant and
-- practice_owner, which is the right audience. The honest consequence is that anybody who can close
-- a task can complete a checklist. Six invented capability codes have shipped in this product -- an
-- invented code compiles, 403s for everybody including the practice owner, and errors nowhere.

-- ---- RLS: deny-by-default ----------------------------------------------------------------------
alter table practice_checklist enable row level security;
alter table practice_checklist_item enable row level security;
alter table practice_checklist_run enable row level security;
alter table practice_checklist_response enable row level security;

notify pgrst, 'reload schema';
