import { audit } from "@/lib/practice/audit";
import { requestApproval } from "@/lib/practice/delegation";
import type { EngineResult } from "@/lib/practice/encounters";
import {
  CHECKLIST_KIND_CODES, CHECKLIST_STATE_CODES, CHECKLIST_STATES_EDITABLE, CHECKLIST_STATES_USABLE,
  CHECKLIST_SUBJECT_CODES, CHECKLIST_RESPONSE_CODES, CHECKLIST_RESPONSES_NEEDING_NOTE,
  CHECKLIST_CHECKS, CHECKLIST_CONSTRAINTS, CHECKLIST_FACETS, CHECKLIST_NOT_VERIFIED,
  CHECKLIST_MODULE_NAME, CHECKLIST_ROUTE, checklistCanMove, checklistMovesFrom, checklistState,
  checklistKindLabel, checklistRunState, applicableItems,
} from "@/lib/practice/checklist-constants";
import { workspaceClock } from "@/lib/practice/practice-time";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-KS-001 PHASE 2 -- PRACTICE CHECKLISTS. The engine.
//
// Definition, item and response: a checklist written once, approved by a colleague, put into use with a
// date on it, and filled in as many times as it is needed. CPR-KS-001's Engine 5, plus enough of its
// section 8 Asset Library to find what was written.
//
// The user-facing name is PRACTICE CHECKLISTS and a filled-in one is a COMPLETION RECORD -- never a
// verification, an assurance, a sign-off or a compliance record. See checklist-constants.ts for why the
// name is a safety decision and not a style one.
//
// ⚠ NOTHING HERE CHECKS THAT AN ITEM WAS DONE. Not one line of this file observes a clinical step,
// compares a tick against another record, or raises anything when an item is left undone. Nothing
// chases a checklist that was never started. CHECKLIST_NOT_VERIFIED is on the library, on every
// definition, on the run screen, on the completion record and on the printed page.
//
// ⚠ AND THE CONDITION EVALUATOR IS IMPORTED, NOT WRITTEN AGAIN. `applicableItems` in
// checklist-constants.ts hands `resolveApplicable` from registration-condition.ts the same items in the
// shape it already takes. There is ONE `conditionMet` in this product and both the registration form and
// this engine run that one. The harness proves it by identity, not by grep.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE STORE THIS NEEDS, AND WHY NOTHING EXISTING CARRIES IT
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// Seven existing tables were examined before proposing one, each probed live on 2026-08-08 rather than
// remembered. "We checked" is not a finding, so each refusal is written out.
//
//   practice_guidance_document (+ _section, migrations 256/257) -- THE SIBLING, AND THE WRONG SHAPE.
//     Its lifecycle is exactly right and is copied. Its CONTENT model is not, three ways:
//       (a) `section_key` is a CHECK over EIGHT NAMED KEYS -- purpose, scope, definitions and so on. A
//           checklist has N items in an order somebody chose, not eight named slots, and
//           ux_practice_guidance_section_key allows one row per key. Twenty ward-round items cannot be
//           expressed at all.
//       (b) `doc_type` is a CHECK over eight values and none of them is a checklist. So a migration to
//           that constraint is required ANYWAY -- there is no version of this that reuses the table
//           unchanged.
//       (c) ⚠ AND THE ONE THAT SETTLES IT: THERE IS NOWHERE FOR AN ANSWER. A guidance document is READ.
//           A checklist is FILLED IN, repeatedly, and each filling is a record with a start, a finish, a
//           person and one row per item. Nothing in 256 or 257 can hold a tick. This is the same
//           distinction migration 009 drew when it put checklist_responses in a table of its own rather
//           than on the checklist.
//
//   practice_registration_template (+ practice_registration_field, migration 223) -- THE RIGHT SHAPE,
//     THE WRONG OBJECT, and this one is worth being precise about because the `condition` column is
//     literally what Engine 5's conditional items need.
//       (a) IT IS THE PATIENT REGISTRATION FORM. ux_practice_reg_template_default is a partial unique
//           index allowing ONE default published template per workspace -- a practice has one
//           registration form. It would then have one checklist. resolveRegistrationForm() picks that
//           row for every registration, so a WHO checklist stored here would be offered to the desk as
//           the form for admitting a patient.
//       (b) THERE IS NO RESPONSE STORE, AND WHAT PASSES FOR ONE IS PATIENT-SHAPED. A custom answer goes
//           to practice_patient.custom_fields, one jsonb map per PERSON. A checklist is completed many
//           times about the same patient, or about no patient at all, and a single map keyed by
//           field_key would overwrite Tuesday's ward round with Wednesday's.
//       (c) A registration field carries `is_core`, which means "this maps to a column on
//           practice_patient". No checklist item maps to a column on anything.
//     THE CONDITION MODEL IS REUSED WITHOUT THE TABLE: the same three shapes, the same jsonb, and the
//     same evaluator function object. That is the reuse that mattered.
//
//   practice_approval_request (migration 208) -- FITS, AND IS USED UNCHANGED. `subject_kind` already
//     admits 'other', so THE APPROVAL SIDE OF THIS PHASE NEEDS NO MIGRATION AT ALL. It holds the
//     requester, the assignee, the decision, the decider, the timestamp and the note, and delegation.ts
//     already refuses anybody approving their own work. Probed live: the column's CHECK is
//     ('document','patient','appointment','task','incoming_document','other').
//
//   practice_task_template (+ _item, migration 211) -- THE NEAREST PRACTICE-TIER ANALOGUE, AND 211 SAYS
//     WHY NOT ITSELF. Its own header frames "a checklist collapsed into a word" as the thing it was
//     avoiding, and what it built instead is a template that MAKES SEVERAL TASKS. A ward-round checklist
//     is not twelve tasks on the practice's task board, each with an assignee and a due date. Its item
//     rows carry `offset_days`, which is meaningless for a list done in one sitting, and closing a task
//     records neither Not applicable, nor a reason, nor which sitting it belonged to. There is no run.
//
//   skill_checklists + checklist_items + checklist_responses (migrations 007/009/020) -- THE MODEL THIS
//     COPIES, AND IT IS UNREACHABLE. It is the most complete define-then-capture loop in the codebase:
//     sections, critical items, required items, a scoring method and a real response table with
//     unique(assessment_id, checklist_item_id). ⚠ IT IS KEYED ON competency_skills(id), and a response
//     is keyed on assessments(id) -- the whole competency estate is hospital_id / framework_id scoped and
//     practice_workspace shares no table with it. There is no workspace_id anywhere in the three. Reuse
//     means re-tenanting the competency estate, which is a large migration with real RLS risk across
//     tables this phase does not touch. THE SHAPE IS COPIED KNOWINGLY -- sections, criticality,
//     required, one response row per item, unique per run -- and the decision is Phase 1's decision
//     about `policies` and `knowledge_objects`, taken again for the same reason.
//
//   practice_note_template (+ _section, migrations 195/204) -- `kind` is a seven-value CHECK and a
//     template is APPLIED TO A PATIENT: every row appears in the pick-list inside a consultation. The
//     theatre equipment checklist appearing beside "Referral letter" mid-consultation is a defect.
//
//   practice_library_document (migration 210) -- IT IS A FILE. `storage_path`, `file_name`, `mime_type`
//     and `byte_size integer not null check (byte_size > 0)` are all NOT NULL, and an authored checklist
//     has no uploaded bytes. It remains exactly right for a checklist somebody made in Word and scanned.
//
// ---- THE DDL --------------------------------------------------------------------------------------
//
// FOUR TABLES, and the fourth is not padding. Definition and item are the authoring half. RUN and
// RESPONSE are the capture half, and the RUN is unavoidable: without it a response has nothing to belong
// to, "this checklist was completed on Tuesday by Dr Okello" has no row, and the same item answered on
// two occasions collides. It is the analogue of `assessments`, which is exactly what migration 009 used
// to group checklist_responses.
//
// Plain idempotent statements, ASCII only, no do-blocks and no plpgsql, because the migration runner
// splits on semicolons. ⚠ NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT, INCLUDING INSIDE A COMMENT --
// that silently shredded two sections of migration 238 while reporting success.
//
// ⚠ REQUIRED TEXT IS `btrim(x) <> ''` AND NEVER `x is not null`. Migration 256 shipped that mistake on
// practice_guidance_archived_reason and migration 257 was the correction: a blank string is not null, so
// `is not null` refuses a MISSING reason and accepts a reason of spaces. Every required-text constraint
// below is written the corrected way the first time.
//
// ⚠ NEVER .upsert() ONTO practice_checklist. It carries a PARTIAL unique index, and an upsert whose
// conflict target does not match a real TOTAL unique index fails silently rather than loudly -- the trap
// that has already produced two silent write failures in this product. Every write below is an explicit
// insert or update and no error from one is discarded.
//
//   -- ============================================================
//   -- MIGRATION 262: PRACTICE CHECKLISTS (CPR-KS-001 Engine 5, Phase 2)
//   --
//   -- Definition, item, run and response, for a practice_workspace. Engine 5's nine kinds and its six
//   -- capabilities -- tick boxes, conditional items, mandatory items, electronic completion, printing,
//   -- mobile mode.
//   --
//   -- NOT a guidance document (that is prose with eight named sections and nowhere to record a tick),
//   -- NOT a registration template (that is THE patient registration form, one per practice), NOT a task
//   -- template (migration 211 explicitly avoided being a checklist), and NOT skill_checklists (that is
//   -- the competency estate, keyed on competency_skills with no workspace_id anywhere).
//   --
//   -- Approval routes through the existing practice_approval_request with subject_kind 'other', so
//   -- there is no approval migration.
//   --
//   -- WARNING: NOTHING IN THIS SCHEMA CHECKS THAT AN ITEM WAS DONE. A response row records what a named person
//   -- said at a recorded time. There is no corroboration, no observation and no enforcement anywhere in
//   -- this product, and the asset says so on screen and on paper.
//   --
//   -- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql, and no semicolon anywhere
//   -- except ending a statement.
//   -- ============================================================
//
//   -- ---- 1. The definition ----------------------------------------------------------------------
//
//   create table if not exists practice_checklist (
//     id uuid primary key default gen_random_uuid(),
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//
//     -- The practice's own reference, e.g. WHO-01. Not a uuid: it is what people say out loud and write
//     -- on a theatre wall, and the partial unique index below is about this and not about the id.
//     code text not null check (btrim(code) <> '' and char_length(code) <= 40),
//     title text not null check (btrim(title) <> '' and char_length(title) <= 200),
//     purpose text check (purpose is null or char_length(purpose) <= 600),
//
//     -- WARNING: THE NINE KINDS OF CPR-KS-001 ENGINE 5, AS A CHECK. The line the survey drew at its section 8
//     -- and Phase 1 drew again: a studio offering a tenth kind produces rows the DATABASE rejects, and
//     -- no front-end work fixes it. A tenth kind is a migration BEFORE the UI offers it, never after.
//     checklist_type text not null check (checklist_type in (
//       'who', 'ward_round', 'discharge', 'procedure', 'audit',
//       'clinic', 'inspection', 'equipment', 'cpd')),
//
//     -- WARNING: WHAT ONE COMPLETION IS ABOUT, DECLARED ON THE DEFINITION. A discharge checklist with no
//     -- patient on it is a record nobody can use. An equipment checklist WITH a patient on it has put a
//     -- machine in somebody's file. TWO VALUES AND NOT THREE: an optional-patient kind was drafted and
//     -- cut, because "you may name a patient" means half a practice's discharge records have one and
//     -- nothing can then tell a deliberate omission from a forgotten one.
//     -- WARNING: THE MATCH IS THE ENGINE'S RULE, NOT A CONSTRAINT. This column is on the definition and the
//     -- patient is on the run, and a CHECK cannot see a sibling table.
//     run_subject text not null default 'none' check (run_subject in ('patient', 'none')),
//
//     specialty text,
//     -- Section 8 wants search by tag. Capped, because a hundred tags is a checklist nobody filed.
//     tags text[] not null default '{}'
//       check (array_length(tags, 1) is null or array_length(tags, 1) <= 12),
//
//     -- ACCOUNTABILITY, NOT PERMISSION. Naming an owner does not restrict who may edit, and the screen
//     -- says so -- an owner column that looked like an access rule and was not would be worse than none.
//     owner_id uuid,
//
//     -- CPR-KS-001 section 3's five, the same ladder Phase 1 built. `in_review` and not `review`,
//     -- because `review_on` on this same row means something entirely different.
//     status text not null default 'draft'
//       check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
//     version integer not null default 1 check (version >= 1),
//
//     -- EVERY VERSION IS A ROW, linked backwards, so an earlier version is a checklist you can OPEN.
//     -- That matters more here than for guidance: a completion record names the version it answered,
//     -- and a reader has to be able to see the list that was actually in front of the person ticking.
//     supersedes_id uuid references practice_checklist(id) on delete set null,
//
//     -- THE APPROVAL, IN THE EXISTING GENERIC ENGINE. subject_kind 'other' already exists, so this
//     -- reference is the whole of the approval integration.
//     --
//     -- WARNING: NO `on delete` CLAUSE, AND IT IS THE CONSIDERED CHOICE OF THREE, exactly as migration 256
//     -- reasoned. Deleting the approval out from under a checklist in use would leave it in use with
//     -- nothing behind it, so a lone deletion must be refused -- but `on delete restrict` checks
//     -- IMMEDIATELY and both tables cascade from practice_workspace, so dropping a workspace could abort
//     -- depending on which cascade Postgres ran first. `on delete set null` is worse: it is an UPDATE,
//     -- so it would trip practice_checklist_in_force on any published row. The DEFAULT (`no action`) is
//     -- checked at END OF STATEMENT, which refuses the lone deletion and lets the workspace cascade run.
//     approval_request_id uuid references practice_approval_request(id),
//
//     -- A DATE, NOT A TIMESTAMP. "In use from 1 January" is a day, and rendering a timezone-shifted
//     -- instant for it is how a checklist appears to start the evening before.
//     effective_from date,
//     review_on date,
//
//     published_at timestamptz,
//     published_by uuid,
//     archived_at timestamptz,
//     archived_reason text,
//
//     created_at timestamptz not null default now(),
//     created_by uuid,
//     updated_at timestamptz not null default now(),
//     updated_by uuid,
//
//     -- WARNING: IN USE MEANS IN USE, AND IT NEEDS BOTH FACTS. A checklist nobody approved, or one with no date
//     -- it starts, is not something a theatre should be ticking. THE ENGINE DOES NOT REPEAT THIS -- it
//     -- reports the gap so somebody sees it before trying, and when they try anyway the database refuses
//     -- and the constraint is named in the refusal.
//     -- WARNING: WHAT IT CANNOT SEE: whether that approval was actually DECIDED. A PENDING request satisfies
//     -- this constraint. APPROVAL_DECIDED in checklist-constants.ts is the engine's, and the split of
//     -- authority is written down so nobody later assumes the database covered both.
//     constraint practice_checklist_in_force
//       check (status <> 'published'
//              or (effective_from is not null and approval_request_id is not null)),
//
//     -- A review date on or before the day it starts is a checklist born overdue.
//     constraint practice_checklist_review_after_effect
//       check (review_on is null or effective_from is null or review_on > effective_from),
//
//     -- WITHDRAWING A CHECKLIST WITHOUT SAYING WHY leaves the next person unable to tell "superseded"
//     -- from "found to be wrong", which is the only thing they need to know.
//     -- WARNING: `btrim(...) <> ''` AND NOT `is not null`. This is migration 257's correction, applied the
//     -- first time rather than a year later: a blank string is not null, so `is not null` alone lets
//     -- somebody withdraw a safety checklist by pressing the space bar.
//     constraint practice_checklist_archived_reason
//       check (status <> 'archived'
//              or (archived_reason is not null and btrim(archived_reason) <> '')),
//
//     constraint practice_checklist_not_self_superseding
//       check (supersedes_id is null or supersedes_id <> id)
//   );
//
//   -- WARNING: THE RULE THAT DOES THE MOST WORK, AND IT IS PARTIAL ON PURPOSE. A practice may hold ten drafts
//   -- of WHO-01 and exactly ONE in use. Two checklists in use under one reference is how half a theatre
//   -- ticks a different list, and no amount of engine care prevents it if the database allows it.
//   -- Publishing a new version therefore requires withdrawing the old one, in that order.
//   create unique index if not exists ux_practice_checklist_published_code
//     on practice_checklist(workspace_id, lower(code)) where status = 'published';
//
//   create index if not exists idx_practice_checklist_library
//     on practice_checklist(workspace_id, status, checklist_type);
//   create index if not exists idx_practice_checklist_review_due
//     on practice_checklist(workspace_id, review_on) where status = 'published';
//   create index if not exists idx_practice_checklist_supersedes
//     on practice_checklist(supersedes_id) where supersedes_id is not null;
//
//   -- ---- 2. The items -----------------------------------------------------------------------------
//   --
//   -- The shape of checklist_items (migrations 007 and 020), which already solved sections, criticality
//   -- and required items -- rebuilt for the practice tenancy because that table is keyed on
//   -- competency_skills and has no workspace_id.
//
//   create table if not exists practice_checklist_item (
//     id uuid primary key default gen_random_uuid(),
//
//     -- WARNING: DENORMALISED FROM THE PARENT ON PURPOSE, and this is not laziness. It lets every write scope
//     -- itself IN THE UPDATE STATEMENT rather than after a prior read -- a bulk write verified by an
//     -- earlier read is one that writes whatever it was passed if the read and the write disagree.
//     -- Written from the parent on insert and never afterwards. Nothing updates it.
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//     checklist_id uuid not null references practice_checklist(id) on delete cascade,
//
//     -- WARNING: THE STABLE NAME A CONDITION CAN POINT AT, and the reason an item needs one at all. A condition
//     -- says {"when": "known_allergy", "equals": "done"}, so the thing it names has to survive an item
//     -- being renamed or moved. Same pattern as practice_registration_field.field_key, same regex, so
//     -- one authoring habit covers both.
//     item_key text not null check (item_key ~ '^[a-z][a-z0-9_]{1,40}$'),
//
//     -- checklist_items.section (migration 020). NULL means the item is not under a heading -- and the
//     -- btrim guard is there because a section of spaces renders as a heading with no name.
//     section text check (section is null or (btrim(section) <> '' and char_length(section) <= 120)),
//
//     position integer not null check (position >= 1),
//     label text not null check (btrim(label) <> '' and char_length(label) <= 240),
//     detail text check (detail is null or char_length(detail) <= 2000),
//
//     -- REQUIRED means a completion record cannot be closed without an answer to it.
//     -- CRITICAL is checklist_items.is_critical -- "must pass" there, and here it means the answer is
//     -- carried onto the record and the printed page whatever it was. WARNING: IT DOES NOT BLOCK COMPLETION.
//     -- A checklist that refuses to close because a step was not done is a checklist people close by
//     -- ticking the box. The engine records it instead, prominently, and never hides it.
//     required boolean not null default true,
//     is_critical boolean not null default false,
//
//     -- WARNING: CPR-KS-001 ENGINE 5's "conditional items", AND IT IS practice_registration_field.condition's
//     -- COLUMN, SHAPE FOR SHAPE. Three forms and no fourth --
//     --   {"when": "known_allergy", "equals": "done"}
//     --   {"when": "referral_source", "in": ["done", "not_applicable"]}
//     --   {"when": "known_allergy", "isPresent": true}
//     -- `when` is another item's item_key ON THIS CHECKLIST and the value compared against is that
//     -- item's RESPONSE CODE. Evaluated by ONE function -- conditionMet in registration-condition.ts --
//     -- which the server and the run screen both import. Two evaluators would disagree eventually, and
//     -- the one that mattered would be the server's, silently, after somebody had ticked the whole list.
//     -- WARNING: NOT A CHECK CONSTRAINT: whether a condition names an item that exists, and one that comes
//     -- EARLIER, is a fact about sibling rows. CONDITIONS_RESOLVE in checklist-constants.ts is the
//     -- engine's and is enforced at publish.
//     condition jsonb,
//
//     created_at timestamptz not null default now()
//   );
//
//   -- One item per key, and one item per slot. The second is not redundant: without it two items can
//   -- both claim position 3 and the order of a safety checklist becomes whatever the planner returns.
//   create unique index if not exists ux_practice_checklist_item_key
//     on practice_checklist_item(checklist_id, item_key);
//   create unique index if not exists ux_practice_checklist_item_position
//     on practice_checklist_item(checklist_id, position);
//   create index if not exists idx_practice_checklist_item_list
//     on practice_checklist_item(checklist_id, position);
//
//   -- ---- 3. The completion record -----------------------------------------------------------------
//   --
//   -- One filling-in of one checklist. The analogue of `assessments`, which is what migration 009 used
//   -- to group checklist_responses, and it is unavoidable: without it a response has nothing to belong
//   -- to and the same item answered on two occasions collides.
//
//   create table if not exists practice_checklist_run (
//     id uuid primary key default gen_random_uuid(),
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//
//     -- WARNING: NO `on delete` CLAUSE, DELIBERATELY. Deleting a checklist definition would take with it the
//     -- record of what people ticked against it, which is the one thing nobody may lose. The default
//     -- (`no action`) refuses the lone deletion and is checked at END OF STATEMENT, so the workspace
//     -- cascade that removes both still succeeds. Withdrawing a checklist is `archived`, never a delete.
//     checklist_id uuid not null references practice_checklist(id),
//
//     -- WARNING: WHICH VERSION WAS ON THE SCREEN. Snapshotted rather than joined, because the definition can be
//     -- revised and a reader of last year's record has to see which list was actually in front of the
//     -- person ticking. It is a number, not a copy of the items -- the items themselves are immutable
//     -- once published, since editing anything that is not a draft is refused.
//     checklist_version integer not null check (checklist_version >= 1),
//
//     -- WARNING: NO `on delete` CLAUSE HERE EITHER. A patient row is never deleted by this product -- a merge
//     -- marks the loser `merged` with merged_into_patient_id -- so nothing legitimate is being blocked,
//     -- and `on delete set null` would quietly strip the subject off a completion record.
//     -- WARNING: THE KNOWN GAP: mergePatients() repoints a fixed list of child tables and this is not on it, so
//     -- a merged patient's completion records stay attached to the row that was merged away. Declared in
//     -- CHECKLIST_KNOWN_GAPS and shown on screen, because a gap recorded only in a commit message is one
//     -- the next person rediscovers as a bug.
//     patient_id uuid references practice_patient(id),
//
//     -- Which theatre, which round, which machine. Free text, because the alternative is a location
//     -- vocabulary this phase has no business inventing.
//     context_note text check (context_note is null or char_length(context_note) <= 200),
//
//     status text not null default 'in_progress'
//       check (status in ('in_progress', 'completed', 'abandoned')),
//
//     started_at timestamptz not null default now(),
//     started_by uuid,
//     completed_at timestamptz,
//     completed_by uuid,
//     abandoned_reason text,
//
//     -- A record marked completed with no time on it cannot be read as a record of anything.
//     constraint practice_checklist_run_completed
//       check (status <> 'completed' or completed_at is not null),
//
//     -- Started and left, with no word about why, tells the next person nothing. Same rule as a
//     -- withdrawn checklist, and written with btrim for migration 257's reason.
//     constraint practice_checklist_run_abandoned_reason
//       check (status <> 'abandoned'
//              or (abandoned_reason is not null and btrim(abandoned_reason) <> ''))
//   );
//
//   create index if not exists idx_practice_checklist_run_list
//     on practice_checklist_run(workspace_id, checklist_id, started_at desc);
//   create index if not exists idx_practice_checklist_run_open
//     on practice_checklist_run(workspace_id, status) where status = 'in_progress';
//   create index if not exists idx_practice_checklist_run_patient
//     on practice_checklist_run(workspace_id, patient_id) where patient_id is not null;
//
//   -- ---- 4. The answers ---------------------------------------------------------------------------
//
//   create table if not exists practice_checklist_response (
//     id uuid primary key default gen_random_uuid(),
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//     run_id uuid not null references practice_checklist_run(id) on delete cascade,
//
//     -- WARNING: NO `on delete` CLAUSE. Deleting an item that somebody has already answered would erase the
//     -- answer and leave the record shorter than it was, with nothing saying so. Through the engine it
//     -- cannot happen -- only a draft is editable and a run may only be started against a published
//     -- checklist -- but a direct write must be refused rather than allowed to cascade quietly.
//     item_id uuid not null references practice_checklist_item(id),
//
//     -- THREE ANSWERS AND NO FOURTH, from checklist_responses' yes/no/na (migration 009), renamed to
//     -- what a checklist means. WARNING: THERE IS NO 'not_answered' VALUE: an item nobody answered has NO ROW,
//     -- so "unanswered" and "answered not done" can never be confused for one another.
//     response text not null check (response in ('done', 'not_done', 'not_applicable')),
//     note text check (note is null or char_length(note) <= 1000),
//
//     responded_at timestamptz not null default now(),
//     responded_by uuid,
//
//     -- WARNING: "NOT APPLICABLE" WITH NO WORDS IS THE ENTRY THAT HIDES A SKIPPED STEP. The database refuses it.
//     -- Not done is deliberately NOT covered: an optional item that simply was not done is an honest
//     -- answer, and demanding a sentence for it is how people learn to type a full stop. The engine
//     -- requires words for a CRITICAL item marked not done, which is a fact about a sibling row and
//     -- therefore cannot be a CHECK.
//     constraint practice_checklist_response_na_reason
//       check (response <> 'not_applicable' or (note is not null and btrim(note) <> ''))
//   );
//
//   -- One answer per item per run. checklist_responses' unique(assessment_id, checklist_item_id).
//   create unique index if not exists ux_practice_checklist_response_once
//     on practice_checklist_response(run_id, item_id);
//   create index if not exists idx_practice_checklist_response_run
//     on practice_checklist_response(run_id);
//
//   -- ---- Capabilities ------------------------------------------------------------------------------
//   --
//   -- NONE MINTED. Reading takes document.view, authoring takes template.manage, and FILLING ONE IN
//   -- takes task.manage -- probed live, 50 codes seeded, no checklist.* among them. task.manage is an
//   -- approximation and is declared as one in checklist-constants.ts: it is the closest seeded code for
//   -- "recording that practice work was done" and it is held by practitioner, practice_assistant and
//   -- practice_owner, which is the right audience. The honest consequence is that anybody who can close
//   -- a task can complete a checklist. Six invented capability codes have shipped in this product -- an
//   -- invented code compiles, 403s for everybody including the practice owner, and errors nowhere.
//
//   -- ---- RLS: deny-by-default ----------------------------------------------------------------------
//   alter table practice_checklist enable row level security;
//   alter table practice_checklist_item enable row level security;
//   alter table practice_checklist_run enable row level security;
//   alter table practice_checklist_response enable row level security;
//
//   notify pgrst, 'reload schema';
//
// ---- ⚠ UNTIL THAT MIGRATION IS APPLIED ------------------------------------------------------------
//
// Everything below is written against those tables and stops at the door rather than pretending.
// checklistStorePresence() ASKS THE DATABASE -- it does not assume, and it does not use head+count,
// because a missing table and an empty table both return count === null and four "missing" results in
// the survey were exactly that trap. The library reports `state: "absent"` with the migration named, and
// every write returns STORE_ABSENT rather than a stack trace. The moment the migration lands, all of it
// works with no code change. This is Phase 1's pattern, which is patient-access.ts's
// ACCESS_PROFILE_STORE_ABSENT pattern, and it carried an unbuilt intake for exactly as long as that was
// true.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const CHECKLIST_TABLE = "practice_checklist";
export const CHECKLIST_ITEM_TABLE = "practice_checklist_item";
export const CHECKLIST_RUN_TABLE = "practice_checklist_run";
export const CHECKLIST_RESPONSE_TABLE = "practice_checklist_response";
export const CHECKLIST_TABLES = [
  CHECKLIST_TABLE, CHECKLIST_ITEM_TABLE, CHECKLIST_RUN_TABLE, CHECKLIST_RESPONSE_TABLE,
];
/** Named in the absent-store message so nobody has to guess which migration is missing. */
export const CHECKLIST_MIGRATION =
  "practice-checklists (practice_checklist + practice_checklist_item + practice_checklist_run + practice_checklist_response)";

/** PostgREST's schema-cache miss and Postgres's undefined-table, which mean the same thing here. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "PGRST202", "42P01"]);
const isMissingTable = (error: any) =>
  !!error && (MISSING_TABLE_CODES.has(String(error.code)) || /could not find the table/i.test(String(error.message ?? "")));
const isUniqueViolation = (error: any) =>
  !!error && (String(error.code) === "23505" || /duplicate key|unique constraint/i.test(String(error.message ?? "")));
const isCheckViolation = (error: any) =>
  !!error && (String(error.code) === "23514" || /violates check constraint/i.test(String(error.message ?? "")));

const storeAbsent = <T>(): EngineResult<T> => ({
  ok: false, status: 503, code: "STORE_ABSENT",
  message: `${CHECKLIST_MODULE_NAME} has no store in this deployment yet. Migration "${CHECKLIST_MIGRATION}" has not been applied, so there is nowhere for a checklist or a completion record to go.`,
});

// ── IS THE STORE THERE? ─────────────────────────────────────────────────────────────────────────────

export type ChecklistStorePresence = {
  present: boolean;
  /** ⚠ Three outcomes, not two. A read that FAILED is not a table that is missing. */
  state: "present" | "absent" | "failed";
  tables: { table: string; present: boolean }[];
  detail: string | null;
};

/**
 * Ask the database, one `select ... limit 1` per table.
 *
 * ⚠ NOT head+count. A missing table and an empty table BOTH return `count === null`, and reading that as
 * "missing" is the trap that produced four wrong answers in the survey this build follows. The error
 * CODE is the only thing that distinguishes them.
 */
export async function checklistStorePresence(admin: any): Promise<ChecklistStorePresence> {
  const results: { table: string; present: boolean }[] = [];
  let failure: string | null = null;

  for (const table of CHECKLIST_TABLES) {
    const { error } = await admin.from(table).select("id").limit(1);
    if (!error) { results.push({ table, present: true }); continue; }
    if (isMissingTable(error)) { results.push({ table, present: false }); continue; }
    // Something else went wrong. That is not "absent" and it must not be reported as one.
    results.push({ table, present: false });
    failure = failure ?? `${table}: ${error.message}`;
  }

  if (failure) return { present: false, state: "failed", tables: results, detail: failure };
  const present = results.every(r => r.present);
  return {
    present, state: present ? "present" : "absent", tables: results,
    detail: present ? null
      : `Migration "${CHECKLIST_MIGRATION}" has not been applied. ${results.filter(r => !r.present).map(r => r.table).join(", ")} do not exist.`,
  };
}

// ── PURE: WHICH ITEMS APPLY, AND WHAT A RUN STILL NEEDS ─────────────────────────────────────────────

export type ChecklistItemRow = {
  id: string; item_key: string; section: string | null; position: number;
  label: string; detail: string | null; required: boolean; is_critical: boolean;
  condition?: unknown;
};

export type ChecklistResponseRow = {
  item_id: string; response: string; note: string | null;
  responded_at?: string | null; responded_by?: string | null;
};

export type RenderedChecklistItem = ChecklistItemRow & {
  /** ⚠ FOUR OUTCOMES AND NOT TWO. `did_not_apply` and `not_answered` mean opposite things. */
  state: "done" | "not_done" | "not_applicable" | "not_answered" | "did_not_apply";
  response: string | null;
  note: string | null;
  respondedAt: string | null;
  /** Only for did_not_apply: the item whose answer withdrew this one, so the reason is readable. */
  withheldBy: string | null;
};

/** The answers as the shared resolver wants them: keyed by item_key, valued by response code. */
export function answerMap(items: ChecklistItemRow[], responses: ChecklistResponseRow[]): Record<string, unknown> {
  const byId = new Map(items.map(i => [i.id, i.item_key]));
  const out: Record<string, unknown> = {};
  for (const r of responses ?? []) {
    const key = byId.get(r.item_id);
    if (key) out[key] = r.response;
  }
  return out;
}

/**
 * The checklist as the person filling it in sees it, and as a reader of the finished record sees it.
 *
 * ⚠ AN ITEM THAT DID NOT APPLY IS NOT AN ITEM THAT WAS MISSED, and rendering both as an empty box is how
 * a printed record loses the difference. Four states, each with its own mark, none of them blank.
 *
 * ⚠ THE APPLICABILITY DECISION IS `applicableItems`, WHICH IS `resolveApplicable`, WHICH IS THE
 * REGISTRATION FORM'S. Nothing here re-decides it.
 */
export function renderChecklist(
  items: ChecklistItemRow[],
  responses: ChecklistResponseRow[],
): { rendered: RenderedChecklistItem[]; applicable: ChecklistItemRow[]; withdrawn: ChecklistItemRow[] } {
  const ordered = [...(items ?? [])].sort((a, b) => a.position - b.position);
  const answers = answerMap(ordered, responses ?? []);
  const { applicable } = applicableItems(ordered, answers);
  const applicableIds = new Set(applicable.map(i => i.id));
  const byItem = new Map((responses ?? []).map(r => [r.item_id, r]));

  const rendered: RenderedChecklistItem[] = ordered.map(item => {
    const answer = byItem.get(item.id) ?? null;
    if (!applicableIds.has(item.id)) {
      // Which earlier item's answer withdrew this one. Read off the condition rather than guessed.
      const c = item.condition && typeof item.condition === "object"
        ? (item.condition as Record<string, unknown>) : null;
      const when = c && typeof c.when === "string" ? c.when : null;
      const source = when ? ordered.find(i => i.item_key === when) ?? null : null;
      return {
        ...item, state: "did_not_apply", response: null, note: null, respondedAt: null,
        withheldBy: source ? source.label : when,
      };
    }
    if (!answer)
      return { ...item, state: "not_answered", response: null, note: null, respondedAt: null, withheldBy: null };
    return {
      ...item,
      state: (answer.response as RenderedChecklistItem["state"]),
      response: answer.response, note: answer.note ?? null,
      respondedAt: answer.responded_at ?? null, withheldBy: null,
    };
  });

  return {
    rendered, applicable,
    withdrawn: ordered.filter(i => !applicableIds.has(i.id)),
  };
}

export type RunCompleteness = {
  /** Required, applicable and unanswered. A LIST, never a bare number. */
  outstanding: RenderedChecklistItem[];
  /** ⚠ Critical items answered `not_done`. Never hidden and never merely counted. */
  criticalNotDone: RenderedChecklistItem[];
  /** Items whose conditions withdrew them. Also a list -- "eleven of twelve" needs the twelfth named. */
  didNotApply: RenderedChecklistItem[];
  answered: number;
  applicable: number;
  /** ⚠ CLOSEABLE, not "passed". A run with a critical item not done is closeable and says so loudly. */
  closeable: boolean;
};

/**
 * What a completion record still needs before it can be closed.
 *
 * ⚠ A CRITICAL ITEM MARKED NOT DONE DOES NOT BLOCK CLOSURE, AND THAT IS THE MOST CONSEQUENTIAL LINE IN
 * THIS FILE. A checklist that cannot be closed with a step undone is a checklist people close by ticking
 * the box -- the failure mode every paper safety checklist already has, imported into software. So the
 * engine RECORDS it: it comes back as a named list, it is on the record, it is on the printed page, and
 * it is never collapsed into a number.
 */
export function runCompleteness(
  items: ChecklistItemRow[],
  responses: ChecklistResponseRow[],
): RunCompleteness {
  const { rendered } = renderChecklist(items, responses);
  const live = rendered.filter(r => r.state !== "did_not_apply");
  return {
    outstanding: live.filter(r => r.required && r.state === "not_answered"),
    criticalNotDone: live.filter(r => r.is_critical && r.state === "not_done"),
    didNotApply: rendered.filter(r => r.state === "did_not_apply"),
    answered: live.filter(r => r.state !== "not_answered").length,
    applicable: live.length,
    closeable: live.filter(r => r.required && r.state === "not_answered").length === 0,
  };
}

// ── PURE: PUBLICATION READINESS ─────────────────────────────────────────────────────────────────────

export type ChecklistCheckResult = {
  code: string; requirement: string; severity: string; authority: string;
  state: "pass" | "fail" | "not_checked";
  detail: string; wouldNeed: string | null;
};

/**
 * ⚠ THREE STATES, and `not_checked` is the honest answer for the two rows whose facts have no store to
 * live in. Never a green tick and never silence.
 *
 * The `database` rows are REPORTED, NOT RE-IMPLEMENTED. They restate what the constraint will do, so
 * somebody can see the gap before they try. A rule written twice is a rule that will one day be written
 * differently in the two places, and the copy that matters is the one nobody can bypass.
 */
export function checklistReadiness(
  doc: { effective_from: string | null; review_on: string | null; approval_request_id: string | null; status: string },
  items: ChecklistItemRow[],
  approval: { status: string } | null,
): { checks: ChecklistCheckResult[]; blockers: number; warnings: number; publishable: boolean } {
  const ordered = [...(items ?? [])].sort((a, b) => a.position - b.position);
  const keyPosition = new Map(ordered.map(i => [i.item_key, i.position]));

  // ⚠ EVERY CONDITION HAS TO NAME AN EARLIER ITEM ON THIS CHECKLIST. An unknown key hides its item
  // forever. A LATER key can never be true when its own item is reached, which is the same outcome by a
  // slower route -- and forbidding backwards references is also what makes a cycle impossible to author.
  const badConditions = ordered.filter(i => {
    if (!i.condition || typeof i.condition !== "object") return false;
    const when = (i.condition as Record<string, unknown>).when;
    if (typeof when !== "string") return true;
    const at = keyPosition.get(when);
    return at === undefined || at >= i.position;
  });
  const conditionalCritical = ordered.filter(i => i.is_critical && !!i.condition);

  const checks: ChecklistCheckResult[] = CHECKLIST_CHECKS.map(def => {
    const base = {
      code: def.code, requirement: def.requirement, severity: def.severity,
      authority: def.authority, detail: def.detail, wouldNeed: def.wouldNeed,
    };
    if (def.authority === "absent") return { ...base, state: "not_checked" as const };
    if (def.authority === "build") return { ...base, state: "pass" as const };

    switch (def.code) {
      case "HAS_ITEMS":
        return { ...base, state: ordered.length > 0 ? ("pass" as const) : ("fail" as const) };
      case "CONDITIONS_RESOLVE":
        return {
          ...base, state: badConditions.length === 0 ? ("pass" as const) : ("fail" as const),
          detail: badConditions.length
            ? `${def.detail} Broken on: ${badConditions.map(i => i.item_key).join(", ")}.`
            : def.detail,
        };
      case "CRITICAL_ITEMS_UNCONDITIONAL":
        return {
          ...base, state: conditionalCritical.length === 0 ? ("pass" as const) : ("fail" as const),
          detail: conditionalCritical.length
            ? `${def.detail} Critical and conditional: ${conditionalCritical.map(i => i.item_key).join(", ")}.`
            : def.detail,
        };
      case "APPROVAL_DECIDED":
        return { ...base, state: approval?.status === "APPROVED" ? ("pass" as const) : ("fail" as const) };
      case "REVIEW_DATE_SET":
        return { ...base, state: doc.review_on ? ("pass" as const) : ("fail" as const) };
      case "APPROVAL_LINKED":
        return { ...base, state: doc.approval_request_id ? ("pass" as const) : ("fail" as const) };
      case "EFFECTIVE_FROM_SET":
        return { ...base, state: doc.effective_from ? ("pass" as const) : ("fail" as const) };
      case "CODE_NOT_IN_USE":
        // ⚠ DELIBERATELY NOT PRE-CHECKED AGAINST THE TABLE. The index is the rule. Reporting it as a
        // pass here would be a second implementation of it, and the two would eventually disagree.
        return {
          ...base, state: "pass" as const,
          detail: `${def.detail} This is not pre-checked here: the index is the rule, and publishing is what tests it.`,
        };
      default:
        return { ...base, state: "not_checked" as const };
    }
  });

  const failing = checks.filter(c => c.state === "fail");
  return {
    checks,
    blockers: failing.filter(c => c.severity === "blocker").length,
    warnings: failing.filter(c => c.severity === "warning").length
      + checks.filter(c => c.state === "not_checked" && c.severity === "warning").length,
    publishable: failing.filter(c => c.severity === "blocker").length === 0,
  };
}

// ── READS ───────────────────────────────────────────────────────────────────────────────────────────

export type ChecklistLibrary = {
  /** ⚠ Three states. `failed` is not `absent` and neither is an empty library. */
  state: "ok" | "absent" | "failed";
  detail: string | null;
  items: any[];
  /** Every figure below is the length of a list, and each carries the filter that opens it. */
  counts: { key: string; label: string; total: number; href: string }[];
  reviewOverdue: any[];
  facets: typeof CHECKLIST_FACETS;
  notVerified: typeof CHECKLIST_NOT_VERIFIED;
};

const LIBRARY_COLUMNS =
  "id, code, title, purpose, checklist_type, run_subject, specialty, tags, owner_id, status, version, " +
  "supersedes_id, approval_request_id, effective_from, review_on, published_at, archived_at, " +
  "archived_reason, created_at, created_by, updated_at";

export async function checklistLibrary(admin: any, workspaceId: string, opts: {
  q?: string | null; kind?: string | null; status?: string | null;
  specialty?: string | null; tag?: string | null; author?: string | null;
} = {}): Promise<ChecklistLibrary> {
  const shell = {
    items: [] as any[],
    counts: [] as { key: string; label: string; total: number; href: string }[],
    reviewOverdue: [] as any[],
    facets: CHECKLIST_FACETS,
    notVerified: CHECKLIST_NOT_VERIFIED,
  };

  // ⚠ NO SEPARATE PRESENCE PROBE ON THE PAGE PATH. The real query's own error CODE distinguishes a
  // missing table from a failed read, so the answer costs nothing extra once the store exists. What is
  // NOT done either way is head+count: a missing table and an empty table both return count === null.
  let query = admin.from(CHECKLIST_TABLE).select(LIBRARY_COLUMNS).eq("workspace_id", workspaceId);
  if (opts.kind && CHECKLIST_KIND_CODES.includes(opts.kind)) query = query.eq("checklist_type", opts.kind);
  if (opts.status && CHECKLIST_STATE_CODES.includes(opts.status)) query = query.eq("status", opts.status);
  if (opts.specialty?.trim()) query = query.ilike("specialty", `%${opts.specialty.trim()}%`);
  if (opts.author) query = query.eq("created_by", opts.author);
  if (opts.tag?.trim()) query = query.contains("tags", [opts.tag.trim()]);
  if (opts.q?.trim()) {
    const term = opts.q.trim().replace(/[%,()]/g, " ");
    query = query.or(`title.ilike.%${term}%,code.ilike.%${term}%,purpose.ilike.%${term}%`);
  }

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(400);
  if (isMissingTable(error))
    return {
      ...shell, state: "absent",
      detail: `Migration "${CHECKLIST_MIGRATION}" has not been applied. ${CHECKLIST_TABLES.join(", ")} do not exist.`,
    };
  // ⚠ A FAILED READ IS NEVER A ZERO. `data == null` with no error is also a failure, not an empty shelf.
  if (error || data == null)
    return { ...shell, state: "failed", detail: error?.message ?? "the checklist library came back as neither rows nor an error" };

  const rows = data as any[];

  const people = [...new Set(rows.flatMap(r => [r.created_by, r.owner_id]).filter(Boolean))];
  const { data: profiles } = people.length
    ? await admin.from("profiles").select("id, full_name").in("id", people)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  // ⚠ ONE COUNT QUERY FOR THE ITEMS, NOT ONE PER CHECKLIST. An item count on the library is a figure and
  // it has to be the length of the list its row opens -- so it is read, not estimated.
  const ids = rows.map(r => r.id);
  const { data: itemRows, error: itemErr } = ids.length
    ? await admin.from(CHECKLIST_ITEM_TABLE).select("id, checklist_id").in("checklist_id", ids).limit(5000)
    : { data: [], error: null };
  // ⚠ A FAILED ITEM READ IS NOT ZERO ITEMS. It is `null`, and the screen says "not counted" rather than
  // printing a nought against a checklist that may well have twenty items on it.
  const itemsBy = new Map<string, number>();
  if (!itemErr && itemRows != null)
    for (const r of itemRows as any[]) itemsBy.set(r.checklist_id, (itemsBy.get(r.checklist_id) ?? 0) + 1);
  const itemCountsKnown = !itemErr && itemRows != null;

  const items = rows.map(r => ({
    ...r,
    kindLabel: checklistKindLabel(r.checklist_type),
    stateLabel: checklistState(r.status)?.label ?? r.status,
    usable: CHECKLIST_STATES_USABLE.includes(r.status),
    itemCount: itemCountsKnown ? (itemsBy.get(r.id) ?? 0) : null,
    authorName: r.created_by ? nameOf.get(r.created_by) ?? null : null,
    ownerName: r.owner_id ? nameOf.get(r.owner_id) ?? null : null,
    href: `${CHECKLIST_ROUTE}/${r.id}`,
  }));

  // ⚠ COUNTED OFF THE ROWS ALREADY READ, not by a second query with a different filter. Two reads is how
  // a figure and the list it claims to describe come to disagree.
      // ⚠ THE PRACTICE'S DAY, NOT THE SERVER'S. This decides whether a published checklist is shown as
      // overdue for review. On the server's day the flag turned over three hours early or late, so an item
      // due today read as overdue -- and the count above the list disagreed with the list for that window.
      const { today } = await workspaceClock(admin, workspaceId);
  const reviewOverdue = items.filter(i => i.status === "published" && i.review_on && i.review_on < today);

  const counts = [
    { key: "published", label: "In use", total: items.filter(i => i.status === "published").length,
      href: `${CHECKLIST_ROUTE}?status=published` },
    { key: "in_review", label: "Waiting for approval", total: items.filter(i => i.status === "in_review").length,
      href: `${CHECKLIST_ROUTE}?status=in_review` },
    { key: "approved", label: "Approved, not yet in use", total: items.filter(i => i.status === "approved").length,
      href: `${CHECKLIST_ROUTE}?status=approved` },
    { key: "draft", label: "Drafts", total: items.filter(i => i.status === "draft").length,
      href: `${CHECKLIST_ROUTE}?status=draft` },
    { key: "review_overdue", label: "Past their review date", total: reviewOverdue.length,
      href: `${CHECKLIST_ROUTE}?status=published&overdue=1` },
  ];

  return { state: "ok", detail: null, items, counts, reviewOverdue, facets: CHECKLIST_FACETS, notVerified: CHECKLIST_NOT_VERIFIED };
}

export type ChecklistDetail = {
  state: "ok" | "absent" | "failed" | "not_found";
  detail: string | null;
  checklist: any | null;
  items: ChecklistItemRow[];
  approval: any | null;
  readiness: ReturnType<typeof checklistReadiness> | null;
  /** Completion records made against it. A list you can open, never a bare count. */
  runs: any[];
  /** ⚠ null when the run list could not be read. NOT an empty array -- that would read as "never used". */
  runsState: "ok" | "failed";
  history: any[];
  moves: { from: string; to: string; label: string; why: string }[];
  notVerified: typeof CHECKLIST_NOT_VERIFIED;
};

export async function getChecklist(admin: any, workspaceId: string, checklistId: string): Promise<ChecklistDetail> {
  const empty: ChecklistDetail = {
    state: "absent", detail: null, checklist: null, items: [], approval: null, readiness: null,
    runs: [], runsState: "ok", history: [], moves: [], notVerified: CHECKLIST_NOT_VERIFIED,
  };

  const { data: doc, error } = await admin.from(CHECKLIST_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", checklistId).eq("workspace_id", workspaceId).maybeSingle();
  if (isMissingTable(error))
    return {
      ...empty, state: "absent",
      detail: `Migration "${CHECKLIST_MIGRATION}" has not been applied. ${CHECKLIST_TABLES.join(", ")} do not exist.`,
    };
  if (error) return { ...empty, state: "failed", detail: error.message };
  if (!doc) return { ...empty, state: "not_found", detail: null };

  const { data: items, error: iErr } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("id, item_key, section, position, label, detail, required, is_critical, condition")
    .eq("checklist_id", checklistId).eq("workspace_id", workspaceId).order("position");
  if (iErr || items == null)
    return { ...empty, state: "failed", detail: iErr?.message ?? "the checklist's items came back as neither rows nor an error" };

  let approval: any = null;
  if (doc.approval_request_id) {
    const { data: a } = await admin.from("practice_approval_request")
      .select("id, status, assigned_to, requested_by, decided_by, decided_at, decision_note")
      .eq("id", doc.approval_request_id).eq("workspace_id", workspaceId).maybeSingle();
    if (a) {
      const ids = [a.assigned_to, a.decided_by, a.requested_by].filter(Boolean);
      const { data: profiles } = ids.length
        ? await admin.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
      const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));
      approval = {
        ...a,
        assignedToName: a.assigned_to ? nameOf.get(a.assigned_to) ?? null : null,
        decidedByName: a.decided_by ? nameOf.get(a.decided_by) ?? null : null,
      };
    }
  }

  const { data: runs, error: rErr } = await admin.from(CHECKLIST_RUN_TABLE)
    .select("id, checklist_version, patient_id, context_note, status, started_at, started_by, completed_at, completed_by, abandoned_reason")
    .eq("checklist_id", checklistId).eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false }).limit(200);

  const { data: history } = await admin.from(CHECKLIST_TABLE)
    .select("id, code, title, status, version, published_at, archived_at, archived_reason")
    .eq("workspace_id", workspaceId).eq("supersedes_id", checklistId);
  const { data: replaced } = doc.supersedes_id
    ? await admin.from(CHECKLIST_TABLE)
      .select("id, code, title, status, version, published_at, archived_at, archived_reason")
      .eq("workspace_id", workspaceId).eq("id", doc.supersedes_id).maybeSingle()
    : { data: null };

  return {
    state: "ok", detail: null,
    checklist: {
      ...doc,
      kindLabel: checklistKindLabel(doc.checklist_type),
      stateLabel: checklistState(doc.status)?.label ?? doc.status,
      stateMeaning: checklistState(doc.status)?.meaning ?? null,
      editable: CHECKLIST_STATES_EDITABLE.includes(doc.status),
      usable: CHECKLIST_STATES_USABLE.includes(doc.status),
    },
    items: items as ChecklistItemRow[],
    approval,
    readiness: checklistReadiness(doc, items as ChecklistItemRow[], approval),
    // ⚠ A FAILED RUN READ IS NOT "NEVER USED". Reported, so the screen can say so.
    runs: rErr || runs == null ? [] : (runs as any[]).map(r => ({
      ...r,
      stateLabel: checklistRunState(r.status)?.label ?? r.status,
      href: `${CHECKLIST_ROUTE}/${checklistId}/runs/${r.id}`,
    })),
    runsState: rErr || runs == null ? "failed" : "ok",
    history: [
      ...(replaced ? [{ ...replaced, relation: "replaced by this" }] : []),
      ...(((history ?? []) as any[]).map(h => ({ ...h, relation: "replaces this" }))),
    ],
    moves: checklistMovesFrom(doc.status),
    notVerified: CHECKLIST_NOT_VERIFIED,
  };
}

export type ChecklistRunDetail = {
  state: "ok" | "absent" | "failed" | "not_found";
  detail: string | null;
  run: any | null;
  checklist: any | null;
  items: ChecklistItemRow[];
  responses: ChecklistResponseRow[];
  rendered: RenderedChecklistItem[];
  completeness: RunCompleteness | null;
  notVerified: typeof CHECKLIST_NOT_VERIFIED;
};

export async function getChecklistRun(admin: any, workspaceId: string, runId: string): Promise<ChecklistRunDetail> {
  const empty: ChecklistRunDetail = {
    state: "absent", detail: null, run: null, checklist: null, items: [], responses: [],
    rendered: [], completeness: null, notVerified: CHECKLIST_NOT_VERIFIED,
  };

  const { data: run, error } = await admin.from(CHECKLIST_RUN_TABLE)
    .select("id, checklist_id, checklist_version, patient_id, context_note, status, started_at, started_by, completed_at, completed_by, abandoned_reason")
    .eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
  if (isMissingTable(error))
    return { ...empty, state: "absent", detail: `Migration "${CHECKLIST_MIGRATION}" has not been applied.` };
  if (error) return { ...empty, state: "failed", detail: error.message };
  if (!run) return { ...empty, state: "not_found", detail: null };

  const { data: doc } = await admin.from(CHECKLIST_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", run.checklist_id).eq("workspace_id", workspaceId).maybeSingle();

  const { data: items, error: iErr } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("id, item_key, section, position, label, detail, required, is_critical, condition")
    .eq("checklist_id", run.checklist_id).eq("workspace_id", workspaceId).order("position");
  if (iErr || items == null)
    return { ...empty, state: "failed", detail: iErr?.message ?? "the checklist's items came back as neither rows nor an error" };

  const { data: responses, error: resErr } = await admin.from(CHECKLIST_RESPONSE_TABLE)
    .select("item_id, response, note, responded_at, responded_by")
    .eq("run_id", runId).eq("workspace_id", workspaceId);
  if (resErr || responses == null)
    return { ...empty, state: "failed", detail: resErr?.message ?? "the answers came back as neither rows nor an error" };

  const rows = items as ChecklistItemRow[];
  const answers = responses as ChecklistResponseRow[];
  const { rendered } = renderChecklist(rows, answers);

  const people = [...new Set([run.started_by, run.completed_by].filter(Boolean))];
  const { data: profiles } = people.length
    ? await admin.from("profiles").select("id, full_name").in("id", people) : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  return {
    state: "ok", detail: null,
    run: {
      ...run,
      stateLabel: checklistRunState(run.status)?.label ?? run.status,
      startedByName: run.started_by ? nameOf.get(run.started_by) ?? null : null,
      completedByName: run.completed_by ? nameOf.get(run.completed_by) ?? null : null,
      open: run.status === "in_progress",
    },
    checklist: doc ? { ...doc, kindLabel: checklistKindLabel(doc.checklist_type) } : null,
    items: rows, responses: answers, rendered,
    completeness: runCompleteness(rows, answers),
    notVerified: CHECKLIST_NOT_VERIFIED,
  };
}

// ── WRITES: THE DEFINITION ──────────────────────────────────────────────────────────────────────────

const cleanTags = (tags: unknown): string[] => {
  const list = Array.isArray(tags) ? tags : [];
  return [...new Set(list.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
};

export async function createChecklist(admin: any, args: {
  workspaceId: string; code: string; title: string; kind: string; runSubject?: string;
  purpose?: string | null; specialty?: string | null; tags?: unknown; ownerId?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim();
  const title = args.title.trim();
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "give it a reference somebody can quote, like WHO-01" };
  if (!title) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the checklist needs a title" };
  // ⚠ CHECKED HERE TOO, because the CHECK constraint's refusal names a column and this names the nine.
  // The constraint is still the rule -- this is a better sentence in front of the same wall.
  if (!CHECKLIST_KIND_CODES.includes(args.kind))
    return { ok: false, status: 400, code: "UNKNOWN_KIND", message: `a checklist is one of: ${CHECKLIST_KIND_CODES.join(", ")}` };
  const runSubject = args.runSubject ?? "none";
  if (!CHECKLIST_SUBJECT_CODES.includes(runSubject))
    return { ok: false, status: 400, code: "UNKNOWN_SUBJECT", message: `a checklist is about one of: ${CHECKLIST_SUBJECT_CODES.join(", ")}` };

  const { data, error } = await admin.from(CHECKLIST_TABLE).insert({
    workspace_id: args.workspaceId, code, title, checklist_type: args.kind, run_subject: runSubject,
    purpose: args.purpose?.trim() || null, specialty: args.specialty?.trim() || null,
    tags: cleanTags(args.tags), owner_id: args.ownerId ?? args.actorId,
    status: "draft", version: 1, created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (isMissingTable(error)) return storeAbsent();
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  // ⚠ NO ITEMS ARE SEEDED, AND THAT IS THE DIFFERENCE FROM PHASE 1. A guidance document has eight fixed
  // sections and creating them with it is what makes its structure independent of memory. A checklist's
  // items ARE the content -- there is no correct starter list for a ward round, and inventing one would
  // be this product suggesting clinical steps. HAS_ITEMS refuses publication of an empty one instead.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_created",
    payload: { checklistId: data.id, code, kind: args.kind }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Edit a draft, including its whole item list.
 *
 * ⚠ ONLY A DRAFT. Phase 1's rule, and it binds harder here: a published checklist has COMPLETION RECORDS
 * against it, and changing an item would retrospectively change what somebody ticked. The forward path
 * from anything that is not a draft is re-open (approved) or a new version (published).
 *
 * ⚠ THE ITEM LIST IS REPLACED WHOLE, and it is done as delete-then-insert INSIDE the checklist rather
 * than row by row. Two positions cannot be swapped incrementally without transiently colliding on
 * ux_practice_checklist_item_position, and a partial reorder that half-failed would leave the list in an
 * order nobody chose. The delete's error is NOT discarded -- if it fails nothing is inserted and the old
 * list stands, which is recoverable.
 */
export async function updateChecklist(admin: any, args: {
  workspaceId: string; checklistId: string;
  title?: string; purpose?: string | null; specialty?: string | null; tags?: unknown;
  ownerId?: string | null; runSubject?: string; effectiveFrom?: string | null; reviewOn?: string | null;
  items?: { itemKey: string; label: string; section?: string | null; detail?: string | null;
            required?: boolean; isCritical?: boolean; condition?: unknown }[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ updated: true; itemsWritten: number | null }>> {
  const { data: doc, error: rErr } = await admin.from(CHECKLIST_TABLE)
    .select("id, status, code").eq("id", args.checklistId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!CHECKLIST_STATES_EDITABLE.includes(doc.status))
    return {
      ok: false, status: 422, code: "NOT_EDITABLE",
      message: `this checklist is ${checklistState(doc.status)?.label.toLowerCase() ?? doc.status} and cannot be edited. ${doc.status === "published" ? "Start a new version instead -- the one in use stays exactly as it was approved, and so does every completion record made against it." : doc.status === "archived" ? "An archived checklist is a record of what the practice used to check." : "Withdraw it from review first, or re-open it if it has been approved."}`,
    };

  const patch: Record<string, unknown> = { updated_at: nowIso(), updated_by: args.actorId };
  if (args.title !== undefined) {
    if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the checklist needs a title" };
    patch.title = args.title.trim();
  }
  if (args.purpose !== undefined) patch.purpose = args.purpose?.trim() || null;
  if (args.specialty !== undefined) patch.specialty = args.specialty?.trim() || null;
  if (args.tags !== undefined) patch.tags = cleanTags(args.tags);
  if (args.ownerId !== undefined) patch.owner_id = args.ownerId || null;
  if (args.effectiveFrom !== undefined) patch.effective_from = args.effectiveFrom || null;
  if (args.reviewOn !== undefined) patch.review_on = args.reviewOn || null;
  if (args.runSubject !== undefined) {
    if (!CHECKLIST_SUBJECT_CODES.includes(args.runSubject))
      return { ok: false, status: 400, code: "UNKNOWN_SUBJECT", message: `a checklist is about one of: ${CHECKLIST_SUBJECT_CODES.join(", ")}` };
    patch.run_subject = args.runSubject;
  }

  const { error } = await admin.from(CHECKLIST_TABLE).update(patch)
    .eq("id", doc.id).eq("workspace_id", args.workspaceId);
  if (error) {
    if (isCheckViolation(error) && /review_after_effect/.test(String(error.message)))
      return { ok: false, status: 422, code: "REVIEW_BEFORE_EFFECT", message: `the review date has to be after the effective date -- the database refuses it (${CHECKLIST_CONSTRAINTS.reviewAfterEffect}), because a checklist whose review has already passed on the day it starts is born overdue` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  if (args.items === undefined)
    return { ok: true, data: { updated: true, itemsWritten: null } };

  const seen = new Set<string>();
  const rows = args.items.map((it, i) => {
    const key = String(it.itemKey ?? "").trim();
    return {
      workspace_id: args.workspaceId, checklist_id: doc.id,
      item_key: key, position: i + 1,
      label: String(it.label ?? "").trim(),
      section: it.section?.trim() || null,
      detail: it.detail?.trim() || null,
      required: it.required !== false,
      is_critical: it.isCritical === true,
      condition: it.condition ?? null,
    };
  });
  for (const r of rows) {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(r.item_key))
      return { ok: false, status: 400, code: "BAD_ITEM_KEY", message: `"${r.item_key}" is not a usable item name. It has to start with a letter and hold only lower-case letters, digits and underscores -- because a condition points at it by this name.` };
    if (seen.has(r.item_key))
      return { ok: false, status: 400, code: "DUPLICATE_ITEM_KEY", message: `two items are both called "${r.item_key}". A condition naming it could not say which one it meant.` };
    seen.add(r.item_key);
    if (!r.label) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `the item "${r.item_key}" has no words on it` };
  }

  // ⚠ SCOPED IN THE STATEMENT ITSELF -- workspace AND parent -- rather than trusted from the prior read,
  // and the error is NOT discarded. A delete that quietly failed followed by an insert would collide on
  // ux_practice_checklist_item_key and leave half a list.
  const { error: dErr } = await admin.from(CHECKLIST_ITEM_TABLE).delete()
    .eq("checklist_id", doc.id).eq("workspace_id", args.workspaceId);
  if (dErr) return { ok: false, status: 400, code: "ITEMS_NOT_REPLACED", message: `the existing items could not be cleared, so nothing was changed about the list: ${dErr.message}` };

  if (rows.length) {
    const { error: iErr } = await admin.from(CHECKLIST_ITEM_TABLE).insert(rows);
    if (iErr) {
      if (isUniqueViolation(iErr))
        return { ok: false, status: 409, code: "ITEM_COLLISION", message: `two items claim the same name or the same place in the list -- the database refuses it (${CHECKLIST_CONSTRAINTS.itemKey} / ${CHECKLIST_CONSTRAINTS.itemPosition})` };
      return { ok: false, status: 400, code: "ITEMS_NOT_WRITTEN", message: `the items could not be written, and the list is now empty. Put them in again: ${iErr.message}` };
    }
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_updated",
    payload: { checklistId: doc.id, items: rows.length }, correlationId: args.correlationId,
  });
  return { ok: true, data: { updated: true, itemsWritten: rows.length } };
}

/** draft -> in_review, creating the approval request. */
export async function submitChecklistForApproval(admin: any, args: {
  workspaceId: string; checklistId: string; assignedTo?: string | null; urgency?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ approvalId: string }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.checklistId, "in_review");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  const { data: items } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("id, item_key, section, position, label, detail, required, is_critical, condition")
    .eq("checklist_id", doc.id).eq("workspace_id", args.workspaceId).order("position");
  const list = (items ?? []) as ChecklistItemRow[];
  if (list.length === 0)
    return { ok: false, status: 422, code: "NO_ITEMS", message: "there is nothing to tick on this checklist yet. A checklist with no items is a title, and sending one for approval spends the one scarce thing in this loop, which is a colleague's attention." };

  // The blockers a colleague cannot be expected to catch by reading. A condition naming an item that is
  // not there hides its item silently, and no reviewer would ever see the question.
  const readiness = checklistReadiness(doc, list, null);
  const broken = readiness.checks.find(c => c.code === "CONDITIONS_RESOLVE");
  if (broken?.state === "fail")
    return { ok: false, status: 422, code: "CONDITIONS_BROKEN", message: broken.detail };

  const approval = await requestApproval(admin, {
    workspaceId: args.workspaceId,
    // ⚠ 'other' IS ALREADY IN MIGRATION 208's CHECK, which is why this phase needs no approval migration.
    subjectKind: "other", subjectId: doc.id, area: "checklist",
    summary: `${checklistKindLabel(doc.checklist_type)} ${doc.code}: ${doc.title}`.slice(0, 300),
    urgency: args.urgency === "urgent" ? "urgent" : "routine",
    assignedTo: args.assignedTo ?? null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!approval.ok) return approval;

  const { error } = await admin.from(CHECKLIST_TABLE)
    .update({ status: "in_review", approval_request_id: approval.data.id, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "draft");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_sent_for_approval",
    payload: { checklistId: doc.id, approvalId: approval.data.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { approvalId: approval.data.id } };
}

/**
 * Bring the checklist into line with the decision on its approval request.
 *
 * ⚠ THIS ENGINE DOES NOT DECIDE. delegation.ts's decideApproval() owns the decision, including its
 * refusal to let anybody approve their own work and its refusal of a rejection without words.
 */
export async function syncChecklistApproval(admin: any, args: {
  workspaceId: string; checklistId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; changed: boolean }>> {
  const { data: doc, error: rErr } = await admin.from(CHECKLIST_TABLE)
    .select("id, status, approval_request_id").eq("id", args.checklistId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (doc.status !== "in_review")
    return { ok: false, status: 422, code: "NOT_IN_REVIEW", message: `only a checklist in review follows its approval; this one is ${checklistState(doc.status)?.label.toLowerCase() ?? doc.status}` };
  if (!doc.approval_request_id)
    return { ok: false, status: 422, code: "NO_APPROVAL", message: "this checklist is in review with no approval request behind it" };

  const { data: a } = await admin.from("practice_approval_request")
    .select("id, status, decision_note").eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!a) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (a.status === "PENDING") return { ok: true, data: { status: "in_review", changed: false } };

  // APPROVED -> approved. REJECTED or WITHDRAWN -> back to draft, and the approval link goes with it: a
  // rejected request left attached would satisfy the published-row constraint on a later attempt.
  const next = a.status === "APPROVED" ? "approved" : "draft";
  const { error } = await admin.from(CHECKLIST_TABLE).update({
    status: next,
    approval_request_id: next === "approved" ? doc.approval_request_id : null,
    updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "in_review");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.checklist_${next}`,
    payload: { checklistId: doc.id, approvalStatus: a.status }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: next, changed: true } };
}

/** in_review -> draft, or approved -> draft. The pending request goes with it. */
export async function withdrawChecklistFromReview(admin: any, args: {
  workspaceId: string; checklistId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.checklistId, "draft");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  if (doc.approval_request_id)
    await admin.from("practice_approval_request")
      .update({ status: "WITHDRAWN", decided_at: nowIso(), decision_note: "the author took the checklist back for further work" })
      .eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).eq("status", "PENDING");

  const { error } = await admin.from(CHECKLIST_TABLE)
    .update({ status: "draft", approval_request_id: null, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", doc.status);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: doc.status === "approved" ? "practice.checklist_reopened" : "practice.checklist_withdrawn_from_review",
    payload: { checklistId: doc.id, from: doc.status }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "draft" } };
}

/**
 * approved -> published.
 *
 * ⚠ THE PREDECESSOR IS WITHDRAWN FIRST, AND THE ORDER IS THE WHOLE POINT.
 * `ux_practice_checklist_published_code` allows exactly one published row per reference, so publishing
 * before withdrawing is refused by the database. Nothing here pre-checks the code -- the index is the
 * rule, and a unique violation comes back as CODE_IN_USE with the index named.
 */
export async function publishChecklist(admin: any, args: {
  workspaceId: string; checklistId: string; effectiveFrom?: string | null; reviewOn?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; superseded: string | null }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.checklistId, "published");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  const effective = args.effectiveFrom ?? doc.effective_from ?? null;
  const review = args.reviewOn ?? doc.review_on ?? null;

  const { data: items } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("id, item_key, section, position, label, detail, required, is_critical, condition")
    .eq("checklist_id", doc.id).eq("workspace_id", args.workspaceId).order("position");
  const list = (items ?? []) as ChecklistItemRow[];

  const { data: approval } = doc.approval_request_id
    ? await admin.from("practice_approval_request").select("id, status")
      .eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).maybeSingle()
    : { data: null };

  // The engine-owned blockers, in front of the constraints rather than instead of them.
  const readiness = checklistReadiness(doc, list, approval ?? null);
  const blocking = readiness.checks.filter(c => c.state === "fail" && c.severity === "blocker" && c.authority === "engine");
  if (blocking.length)
    return {
      ok: false, status: 422, code: blocking[0].code,
      message: blocking.map(c => c.detail).join(" "),
    };

  // Withdraw the predecessor FIRST. If this fails, publishing is not attempted -- an unarchived
  // predecessor plus a failed publish leaves the practice exactly where it was, which is recoverable.
  let superseded: string | null = null;
  if (doc.supersedes_id) {
    const { data: prev } = await admin.from(CHECKLIST_TABLE)
      .select("id, status, version").eq("id", doc.supersedes_id).eq("workspace_id", args.workspaceId).maybeSingle();
    if (prev && prev.status === "published") {
      const { error: aErr } = await admin.from(CHECKLIST_TABLE).update({
        status: "archived", archived_at: nowIso(),
        archived_reason: `superseded by version ${doc.version}`,
        updated_at: nowIso(), updated_by: args.actorId,
      }).eq("id", prev.id).eq("workspace_id", args.workspaceId).eq("status", "published");
      if (aErr) return { ok: false, status: 400, code: "PREDECESSOR_NOT_WITHDRAWN", message: `the version this replaces could not be withdrawn, so nothing was published: ${aErr.message}` };
      superseded = prev.id;
    }
  }

  const { error } = await admin.from(CHECKLIST_TABLE).update({
    status: "published", effective_from: effective, review_on: review,
    published_at: nowIso(), published_by: args.actorId, updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "approved");

  if (error) {
    if (isUniqueViolation(error))
      return {
        ok: false, status: 409, code: "CODE_IN_USE",
        message: `another checklist is already in use under "${doc.code}". The database refuses it (${CHECKLIST_CONSTRAINTS.publishedCode}): one reference, one checklist in use. Withdraw the one in use first.`,
      };
    if (isCheckViolation(error) && /in_force/.test(String(error.message)))
      return {
        ok: false, status: 422, code: "NOT_IN_FORCE_READY",
        message: `a checklist in use needs an effective date and an approval on the record. The database refuses it (${CHECKLIST_CONSTRAINTS.inForce}).`,
      };
    if (isCheckViolation(error) && /review_after_effect/.test(String(error.message)))
      return { ok: false, status: 422, code: "REVIEW_BEFORE_EFFECT", message: `the review date has to be after the effective date (${CHECKLIST_CONSTRAINTS.reviewAfterEffect})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_published",
    payload: { checklistId: doc.id, code: doc.code, version: doc.version, superseded },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "published", superseded } };
}

export async function archiveChecklist(admin: any, args: {
  workspaceId: string; checklistId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; openRuns: number }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.checklistId, "archived");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  const reason = (args.reason ?? "").trim();
  // ⚠ THIS GUARD AND THE CONSTRAINT ARE THE SAME RULE HERE, and that is the difference from Phase 1.
  // Migration 256 wrote `archived_reason is not null`, which accepts a blank string, so the engine's
  // guard was the only thing standing between a space bar and the record. Migration 257 corrected it and
  // this DDL is written the corrected way the first time -- `btrim(archived_reason) <> ''` -- so this
  // guard is a BETTER SENTENCE in front of the same wall rather than the wall itself.
  // ⚠ AND THE TWO REFUSALS CARRY DIFFERENT CODES ANYWAY. REASON_REQUIRED is this one and
  // REASON_REQUIRED_BY_DATABASE names the constraint, so a harness can tell which layer refused. They
  // were the same code in Phase 1 until a run proved that could not distinguish them: deleting the guard
  // merely handed the same refusal, under the same name, to the layer below and the assertion stayed
  // green. That is the exact shape of the vacuous assertions this codebase keeps finding.
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this is being withdrawn. The next person needs to tell \"superseded\" from \"found to be wrong\"." };

  // ⚠ OPEN COMPLETION RECORDS ARE COUNTED AND REPORTED, NOT CLOSED. Somebody is part-way through a ward
  // round on the version being withdrawn. Closing their record for them would put a completion in the
  // register that nobody made, and refusing the withdrawal would leave a checklist in use that the
  // practice has decided is wrong. So the withdrawal proceeds and the number comes back, as a fact the
  // caller has to show.
  const { data: open } = await admin.from(CHECKLIST_RUN_TABLE)
    .select("id").eq("checklist_id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "in_progress");
  const openRuns = ((open ?? []) as any[]).length;

  const { error } = await admin.from(CHECKLIST_TABLE).update({
    status: "archived", archived_at: nowIso(), archived_reason: reason,
    updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", doc.status);
  if (error) {
    if (isCheckViolation(error) && /archived_reason/.test(String(error.message)))
      return { ok: false, status: 422, code: "REASON_REQUIRED_BY_DATABASE", message: `the database refuses an archived checklist with no reason (${CHECKLIST_CONSTRAINTS.archivedReason})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_archived",
    payload: { checklistId: doc.id, from: doc.status, reason, openRuns }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "archived", openRuns } };
}

/**
 * Start the next version of something that is in use.
 *
 * A NEW ROW, NOT AN EDIT. The version in use stays exactly as it was approved -- and so does every
 * completion record made against it, which is why this matters more here than for guidance.
 */
export async function reviseChecklist(admin: any, args: {
  workspaceId: string; checklistId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number }>> {
  const { data: doc, error: rErr } = await admin.from(CHECKLIST_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", args.checklistId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (doc.status !== "published")
    return { ok: false, status: 422, code: "NOT_PUBLISHED", message: `only a checklist in use has a next version; this one is ${checklistState(doc.status)?.label.toLowerCase() ?? doc.status}` };

  const { data: existing } = await admin.from(CHECKLIST_TABLE)
    .select("id, status, version").eq("workspace_id", args.workspaceId).eq("supersedes_id", doc.id)
    .neq("status", "archived").limit(1).maybeSingle();
  if (existing)
    return { ok: false, status: 409, code: "REVISION_OPEN", message: `version ${existing.version} of this checklist is already open (${checklistState(existing.status)?.label.toLowerCase() ?? existing.status}). Finish or abandon it first.` };

  const { data: created, error } = await admin.from(CHECKLIST_TABLE).insert({
    workspace_id: args.workspaceId, code: doc.code, title: doc.title, purpose: doc.purpose,
    checklist_type: doc.checklist_type, run_subject: doc.run_subject, specialty: doc.specialty,
    tags: doc.tags ?? [], owner_id: doc.owner_id,
    status: "draft", version: (doc.version ?? 1) + 1, supersedes_id: doc.id,
    // ⚠ THE APPROVAL IS NOT COPIED. A new version carries none of the old one's approval, because nobody
    // has read it. The dates are not copied either -- an effective date is about this version.
    approval_request_id: null, effective_from: null, review_on: null,
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id, version").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const { data: items } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("item_key, section, position, label, detail, required, is_critical, condition")
    .eq("checklist_id", doc.id).eq("workspace_id", args.workspaceId).order("position");
  const rows = ((items ?? []) as any[]).map(s => ({
    workspace_id: args.workspaceId, checklist_id: created.id, item_key: s.item_key,
    section: s.section, position: s.position, label: s.label, detail: s.detail,
    required: s.required, is_critical: s.is_critical, condition: s.condition,
  }));

  if (rows.length) {
    const { error: iErr } = await admin.from(CHECKLIST_ITEM_TABLE).insert(rows);
    if (iErr) {
      // ⚠ NOT DISCARDED. A new version with no items is worse than no new version -- somebody would open
      // it, see an empty list, and believe the practice had deleted its checklist.
      await admin.from(CHECKLIST_TABLE).delete().eq("id", created.id).eq("workspace_id", args.workspaceId);
      return { ok: false, status: 400, code: "ITEMS_NOT_COPIED", message: `the new version's items could not be created, so nothing was kept: ${iErr.message}` };
    }
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_revised",
    payload: { checklistId: created.id, supersedes: doc.id, version: created.version },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: created.id as string, version: created.version as number } };
}

// ── WRITES: THE COMPLETION RECORD ───────────────────────────────────────────────────────────────────

/**
 * Start filling one in.
 *
 * ⚠ ONLY AGAINST A CHECKLIST IN USE. A draft being filled in for real is the same class of error as a
 * ward following a draft protocol, and the completion record would name a version that changed the next
 * morning. This is the ENGINE's rule and it says so: `status` is on the checklist and the run is a
 * different row, and a CHECK constraint cannot see a sibling table.
 *
 * ⚠ AND THE SUBJECT HAS TO MATCH WHAT THE CHECKLIST DECLARED, in both directions. A patient-scoped
 * checklist run with nobody named is a record nobody can use. A room-scoped one with a patient named has
 * put a machine in somebody's file.
 */
export async function startChecklistRun(admin: any, args: {
  workspaceId: string; checklistId: string; patientId?: string | null; contextNote?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number }>> {
  const { data: doc, error } = await admin.from(CHECKLIST_TABLE)
    .select("id, status, version, run_subject, code, title").eq("id", args.checklistId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (!CHECKLIST_STATES_USABLE.includes(doc.status))
    return {
      ok: false, status: 422, code: "NOT_IN_USE",
      message: `this checklist is ${checklistState(doc.status)?.label.toLowerCase() ?? doc.status} and cannot be filled in. ${doc.status === "draft" ? "A draft can still change, so a record made against it would be a record of a list that no longer exists." : "Only the version in use can be completed."}`,
    };

  const patientId = args.patientId?.trim() || null;
  if (doc.run_subject === "patient" && !patientId)
    return { ok: false, status: 422, code: "PATIENT_REQUIRED", message: "this checklist is about one patient, so a completion record has to name them. A record of a discharge with nobody on it is one nobody can use." };
  if (doc.run_subject === "none" && patientId)
    return { ok: false, status: 422, code: "PATIENT_NOT_ALLOWED", message: "this checklist is not about a patient, so no patient may be recorded on it. Naming one would put a clinic or a machine in somebody's file." };

  const { data: items } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("id").eq("checklist_id", doc.id).eq("workspace_id", args.workspaceId).limit(1);
  if (((items ?? []) as any[]).length === 0)
    return { ok: false, status: 422, code: "NO_ITEMS", message: "this checklist has nothing on it to tick" };

  const { data: run, error: insErr } = await admin.from(CHECKLIST_RUN_TABLE).insert({
    workspace_id: args.workspaceId, checklist_id: doc.id, checklist_version: doc.version,
    patient_id: patientId, context_note: args.contextNote?.trim() || null,
    status: "in_progress", started_by: args.actorId,
  }).select("id, checklist_version").single();
  if (insErr) {
    if (isMissingTable(insErr)) return storeAbsent();
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: insErr.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_run_started",
    payload: { runId: run.id, checklistId: doc.id, version: doc.version, patientId },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: run.id as string, version: run.checklist_version as number } };
}

export type RecordedResponses = {
  written: number;
  /** ⚠ Answers deleted because their item no longer applies. A LIST of labels, said on screen. */
  cleared: string[];
  completeness: RunCompleteness;
};

/**
 * Record answers.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ THIS IS THE ONE WRITE PATH, AND IT IS WHERE A WITHDRAWN ITEM'S ANSWER IS THROWN AWAY.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The registration fix found the real hazard and it is identical here. A hidden item that KEEPS its
 * answer makes the screen and the server disagree, and then:
 *
 *   - the completion record holds an answer to a question the screen withdrew, and the printed copy
 *     shows a tick beside an item the person filling it in never saw;
 *   - and runCompleteness evaluates conditions against the answers it HAS. It would see the stale
 *     answer, decide the dependent item applies, find it unanswered, and refuse to close the record over
 *     an item that is not on the screen. That was the exact live defect on the registration form.
 *
 * So: the incoming answers are merged with the ones already stored, the WHOLE set is resolved once, and
 * every stored answer whose item no longer applies is DELETED. Resolved against what is in the database
 * rather than against what the client sent, because the client is a claim and the store is the record.
 *
 * ⚠ AND THE PAYLOAD IS A POSITIVE WHITELIST. An answer for an item that does not apply is not written at
 * all, rather than written and then cleaned up -- a write followed by a delete is a moment where the
 * record says something untrue, and it is the moment somebody's read lands in.
 */
export async function recordResponses(admin: any, args: {
  workspaceId: string; runId: string;
  answers: { itemKey: string; response: string; note?: string | null }[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<RecordedResponses>> {
  const loaded = await loadOpenRun(admin, args.workspaceId, args.runId);
  if (!loaded.ok) return loaded;
  const { run, items, existing } = loaded.data;

  const byKey = new Map(items.map(i => [i.item_key, i]));

  // 1. Validate every incoming answer before anything is written.
  const incoming: { item: ChecklistItemRow; response: string; note: string | null }[] = [];
  for (const a of args.answers ?? []) {
    const item = byKey.get(String(a.itemKey ?? ""));
    if (!item)
      return { ok: false, status: 400, code: "UNKNOWN_ITEM", message: `"${a.itemKey}" is not an item on this checklist` };
    if (!CHECKLIST_RESPONSE_CODES.includes(a.response))
      return { ok: false, status: 400, code: "UNKNOWN_RESPONSE", message: `an answer is one of: ${CHECKLIST_RESPONSE_CODES.join(", ")}` };
    const note = (a.note ?? "").trim() || null;
    if (CHECKLIST_RESPONSES_NEEDING_NOTE.includes(a.response) && !note)
      return { ok: false, status: 422, code: "REASON_REQUIRED", message: `"${item.label}" is marked not applicable. Say why -- "n/a" with no words is the entry that hides a skipped step, and the database refuses it too (${CHECKLIST_CONSTRAINTS.responseNaReason}).` };
    // ⚠ THE ENGINE'S RULE, AND IT IS NOT A COPY OF A CONSTRAINT. `is_critical` lives on the ITEM row and
    // the answer lives here, so a CHECK cannot see it. A critical step recorded as not done with no word
    // about why is the entry a reader most needs and least often gets.
    if (item.is_critical && a.response === "not_done" && !note)
      return { ok: false, status: 422, code: "CRITICAL_REASON_REQUIRED", message: `"${item.label}" is a critical item and it is being recorded as not done. Say what happened -- nothing in this product will ask again.` };
    incoming.push({ item, response: a.response, note });
  }

  // 2. Resolve the WHOLE picture -- stored plus incoming -- through the one shared evaluator.
  const merged = new Map(existing.map(r => [r.item_id, { item_id: r.item_id, response: r.response, note: r.note }]));
  for (const inc of incoming) merged.set(inc.item.id, { item_id: inc.item.id, response: inc.response, note: inc.note });
  const mergedRows = [...merged.values()];
  const { applicable } = applicableItems(items, answerMap(items, mergedRows));
  const applicableIds = new Set(applicable.map(i => i.id));

  // 3. Write only what applies. THE WHITELIST, and it is positive rather than a filter of exclusions.
  let written = 0;
  for (const inc of incoming) {
    if (!applicableIds.has(inc.item.id)) continue;
    const already = existing.find(r => r.item_id === inc.item.id);
    const row = {
      workspace_id: args.workspaceId, run_id: run.id, item_id: inc.item.id,
      response: inc.response, note: inc.note, responded_at: nowIso(), responded_by: args.actorId,
    };
    // ⚠ NOT .upsert(). An explicit update-or-insert, scoped in the statement, with the error kept.
    const { error } = already
      ? await admin.from(CHECKLIST_RESPONSE_TABLE)
        .update({ response: row.response, note: row.note, responded_at: row.responded_at, responded_by: row.responded_by })
        .eq("run_id", run.id).eq("item_id", inc.item.id).eq("workspace_id", args.workspaceId)
      : await admin.from(CHECKLIST_RESPONSE_TABLE).insert(row);
    if (error) {
      if (isCheckViolation(error) && /na_reason/.test(String(error.message)))
        return { ok: false, status: 422, code: "REASON_REQUIRED_BY_DATABASE", message: `the database refuses "not applicable" with no reason (${CHECKLIST_CONSTRAINTS.responseNaReason})` };
      return { ok: false, status: 400, code: "ANSWER_NOT_RECORDED", message: `"${inc.item.label}" could not be recorded, so do not assume it was: ${error.message}` };
    }
    written++;
  }

  // 4. Delete the answers whose items no longer apply. ⚠ AND THE DELETE'S ERROR IS NOT DISCARDED -- a
  // stale answer left behind is exactly the state that makes the screen and the server disagree.
  const cleared: string[] = [];
  for (const r of existing) {
    if (applicableIds.has(r.item_id)) continue;
    const { error } = await admin.from(CHECKLIST_RESPONSE_TABLE).delete()
      .eq("run_id", run.id).eq("item_id", r.item_id).eq("workspace_id", args.workspaceId);
    if (error)
      return { ok: false, status: 400, code: "STALE_ANSWER_NOT_CLEARED", message: `an answer that no longer applies could not be removed, and leaving it would make this record say something nobody was asked: ${error.message}` };
    cleared.push(items.find(i => i.id === r.item_id)?.label ?? r.item_id);
  }

  const { data: after } = await admin.from(CHECKLIST_RESPONSE_TABLE)
    .select("item_id, response, note, responded_at, responded_by")
    .eq("run_id", run.id).eq("workspace_id", args.workspaceId);
  const finalRows = ((after ?? []) as ChecklistResponseRow[]);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_answers_recorded",
    payload: { runId: run.id, written, cleared: cleared.length }, correlationId: args.correlationId,
  });
  return { ok: true, data: { written, cleared, completeness: runCompleteness(items, finalRows) } };
}

/**
 * Close it.
 *
 * ⚠ A CRITICAL ITEM RECORDED AS NOT DONE DOES NOT BLOCK THIS, and that is the most consequential
 * decision in the file. A checklist that cannot be closed with a step undone is a checklist people close
 * by ticking the box -- the failure mode every paper safety checklist already has, imported into
 * software at speed. What is refused is an UNANSWERED required item, which is a different thing: the
 * question was not reached at all.
 */
export async function completeChecklistRun(admin: any, args: {
  workspaceId: string; runId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; criticalNotDone: string[]; answered: number; applicable: number }>> {
  const loaded = await loadOpenRun(admin, args.workspaceId, args.runId);
  if (!loaded.ok) return loaded;
  const { run, items, existing } = loaded.data;

  const completeness = runCompleteness(items, existing);
  if (!completeness.closeable)
    return {
      ok: false, status: 422, code: "ITEMS_OUTSTANDING",
      message: `these items still need an answer before this can be closed: ${completeness.outstanding.map(i => i.label).join(", ")}. An item marked not done is an answer -- an item nobody reached is not.`,
    };

  const { error } = await admin.from(CHECKLIST_RUN_TABLE).update({
    status: "completed", completed_at: nowIso(), completed_by: args.actorId,
  }).eq("id", run.id).eq("workspace_id", args.workspaceId).eq("status", "in_progress");
  if (error) {
    if (isCheckViolation(error) && /run_completed/.test(String(error.message)))
      return { ok: false, status: 422, code: "COMPLETION_TIME_MISSING", message: `the database refuses a completed record with no time on it (${CHECKLIST_CONSTRAINTS.runCompleted})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_run_completed",
    payload: {
      runId: run.id, checklistId: run.checklist_id,
      answered: completeness.answered, applicable: completeness.applicable,
      // ⚠ ON THE AUDIT TRAIL BY NAME. A critical step recorded as not done is the single thing anybody
      // would ever come looking for, and a count would not tell them which one.
      criticalNotDone: completeness.criticalNotDone.map(i => i.item_key),
    },
    correlationId: args.correlationId,
  });
  return {
    ok: true,
    data: {
      status: "completed",
      criticalNotDone: completeness.criticalNotDone.map(i => i.label),
      answered: completeness.answered, applicable: completeness.applicable,
    },
  };
}

/** Started and left. Kept with a reason, never deleted -- a ward round begun and abandoned is a fact. */
export async function abandonChecklistRun(admin: any, args: {
  workspaceId: string; runId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const loaded = await loadOpenRun(admin, args.workspaceId, args.runId);
  if (!loaded.ok) return loaded;
  const { run } = loaded.data;

  const reason = (args.reason ?? "").trim();
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this was not finished. A record that stops half way with no word about why tells the next person nothing." };

  const { error } = await admin.from(CHECKLIST_RUN_TABLE).update({
    status: "abandoned", abandoned_reason: reason,
  }).eq("id", run.id).eq("workspace_id", args.workspaceId).eq("status", "in_progress");
  if (error) {
    if (isCheckViolation(error) && /abandoned_reason/.test(String(error.message)))
      return { ok: false, status: 422, code: "REASON_REQUIRED_BY_DATABASE", message: `the database refuses an abandoned record with no reason (${CHECKLIST_CONSTRAINTS.runAbandonedReason})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.checklist_run_abandoned",
    payload: { runId: run.id, reason }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "abandoned" } };
}

// ── SHARED ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Load a checklist and refuse the move by NAME if it is not one that exists.
 *
 * ⚠ REFUSED BY NAME, NOT BY FALLING THROUGH. A transition that quietly does nothing is how somebody
 * comes to believe a checklist is in use when it is not.
 */
async function loadForMove(admin: any, workspaceId: string, checklistId: string, to: string): Promise<
  { ok: true; data: any } | { ok: false; status: number; code: string; message: string }
> {
  const { data: doc, error } = await admin.from(CHECKLIST_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", checklistId).eq("workspace_id", workspaceId).maybeSingle();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (!checklistCanMove(doc.status, to)) {
    const from = checklistState(doc.status)?.label.toLowerCase() ?? doc.status;
    const target = checklistState(to)?.label.toLowerCase() ?? to;
    // ⚠ "a approved checklist" is what this said, and a refusal a practitioner reads has to be in English.
    // The article is chosen from the sound of the word rather than hardcoded, because the state labels are
    // data and the next one added may well begin with a vowel.
    const article = /^[aeiou]/i.test(from) ? "an" : "a";
    return {
      ok: false, status: 422, code: "MOVE_NOT_ALLOWED",
      message: `${article} ${from} checklist cannot become ${target}. From ${from}, the moves that exist are: ${
        checklistMovesFrom(doc.status).map(t => t.label).join(", ") || "none -- this is where a checklist's life ends"
      }.`,
    };
  }
  return { ok: true, data: doc };
}

/** A run that is still open, with its items and everything already answered. */
async function loadOpenRun(admin: any, workspaceId: string, runId: string): Promise<
  { ok: true; data: { run: any; items: ChecklistItemRow[]; existing: ChecklistResponseRow[] } }
  | { ok: false; status: number; code: string; message: string }
> {
  const { data: run, error } = await admin.from(CHECKLIST_RUN_TABLE)
    .select("id, checklist_id, checklist_version, status, patient_id")
    .eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!run) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (run.status !== "in_progress")
    return {
      ok: false, status: 422, code: "RUN_CLOSED",
      message: `this ${checklistRunState(run.status)?.label.toLowerCase() ?? run.status} record cannot be changed. What was recorded at the time is what it says, and altering it afterwards would make it a record of something else.`,
    };

  const { data: items, error: iErr } = await admin.from(CHECKLIST_ITEM_TABLE)
    .select("id, item_key, section, position, label, detail, required, is_critical, condition")
    .eq("checklist_id", run.checklist_id).eq("workspace_id", workspaceId).order("position");
  // ⚠ A FAILED ITEM READ IS NOT AN EMPTY CHECKLIST. Writing answers against a list that came back as
  // nothing would silently record against nothing at all.
  if (iErr || items == null)
    return { ok: false, status: 503, code: "ITEMS_UNREADABLE", message: `the checklist's items could not be read, so nothing was recorded: ${iErr?.message ?? "the items came back as neither rows nor an error"}` };

  const { data: existing, error: eErr } = await admin.from(CHECKLIST_RESPONSE_TABLE)
    .select("item_id, response, note, responded_at, responded_by")
    .eq("run_id", run.id).eq("workspace_id", workspaceId);
  if (eErr || existing == null)
    return { ok: false, status: 503, code: "ANSWERS_UNREADABLE", message: `what has already been answered could not be read, and recording over an unknown state is how an answer disappears: ${eErr?.message ?? "the answers came back as neither rows nor an error"}` };

  return {
    ok: true,
    data: { run, items: items as ChecklistItemRow[], existing: existing as ChecklistResponseRow[] },
  };
}
