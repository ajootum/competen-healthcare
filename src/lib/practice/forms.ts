import { audit } from "@/lib/practice/audit";
import { requestApproval } from "@/lib/practice/delegation";
import type { EngineResult } from "@/lib/practice/encounters";
import {
  FORM_TYPE_CODES, FORM_STATE_CODES, FORM_STATES_EDITABLE, FORM_STATES_USABLE,
  FORM_SUBJECT_CODES, FORM_CHECKS, FORM_CONSTRAINTS, FORM_FACETS, FORM_NOT_VERIFIED,
  FORM_MODULE_NAME, FORM_ROUTE, formCanMove, formMovesFrom, formState,
  formTypeLabel, formSubmissionState,
} from "@/lib/practice/form-constants";
import {
  applicableFields, calculatedValues, validateAnswer, isBlankAnswer, displayAnswer,
  fieldType, fieldOptions, fieldRules, PRACTICE_FIELD_TYPE_CODES, CALCULATION_CODES,
  type FormFieldLike, type CalculatedValue,
} from "@/lib/practice/form-field";
import { workspaceClock } from "@/lib/practice/practice-time";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-KS-001 PHASE 3 -- PRACTICE FORMS. The engine.
//
// Form, question, submission and answer: a form written once, approved by a colleague, put into use with
// a date on it, and filled in as many times as it is needed. CPR-KS-001's section 4 Intelligent Forms
// Engine, plus enough of its section 8 Asset Library to find what was written.
//
// The user-facing name is PRACTICE FORMS and a filled-in one is a COMPLETED FORM -- never a verification,
// an assurance, a sign-off, a consent or a witnessed record. See form-constants.ts for why the name is a
// safety decision and not a style one, and in particular for the consent form.
//
// ⚠ NOTHING HERE CHECKS THAT AN ANSWER IS TRUE, AND NOTHING ON A FORM IS A SIGNATURE. A range rule
// refuses a number outside the range it was given and says nothing about whether the number is right.
// FORM_NOT_VERIFIED is on the library, on every form, on the fill-in screen, on the completed form and on
// the printed page.
//
// ⚠ AND THE CONDITION EVALUATOR IS IMPORTED, NOT WRITTEN AGAIN. `resolveApplicable` comes from
// registration-condition.ts through form-field.ts, which re-exports rather than redefines. There is ONE
// `conditionMet` in this product and the registration form, the checklist run and this engine all run
// that one. The harness proves it by identity, not by grep.
//
// ⚠ THE EXTENDS-OR-SECOND-RUNTIME ANSWER IS IN form-field.ts's HEADER, in full. In one line: the
// evaluator, the field vocabulary, the validator and the renderer are EXTENDED and shared, and the STORE
// is new, because the existing one is the patient registration form -- one per practice, resolved
// automatically for every registration, with its answers written onto the patient row.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE STORE THIS NEEDS, AND WHY NOTHING EXISTING CARRIES IT
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// Six existing tables were examined before proposing one, each probed live on 2026-08-08 rather than
// remembered. "We checked" is not a finding, so each refusal is written out.
//
//   practice_registration_template (+ practice_registration_field, migration 223) -- THE SIBLING, AND THE
//     WHOLE POINT OF THE PHASE. Its condition model, its field-key regex, its option shape and its
//     draft/published/retired discipline are all copied or shared. Its TABLE is not, three ways, and any
//     one of the three would settle it on its own:
//       (a) IT IS THE PATIENT REGISTRATION FORM, SINGULAR. ux_practice_reg_template_default allows one
//           default published template per workspace, and resolveTemplate() returns a published row for
//           EVERY registration, ranked by how specifically it matches specialty, country and practice
//           type. An audit tool stored there is a row resolveTemplate can return -- which means a theatre
//           audit offered to the desk as the form for admitting a patient.
//       (b) ⚠ THERE IS NOWHERE FOR AN ANSWER, AND WHAT PASSES FOR ONE IS PATIENT-SHAPED. A custom answer
//           goes to practice_patient.custom_fields -- ONE jsonb map per PERSON, deliberately, per
//           migration 223's own comment. A form is filled in many times, about the same patient or about
//           no patient at all, and one map keyed by field_key would overwrite January's risk assessment
//           with February's. Same argument migration 009 settled for checklist_responses.
//       (c) is_core MEANS "THIS MAPS TO A COLUMN ON practice_patient", and PROTECTED_FIELDS is a floor
//           configuration may not lower. No question on a consent form maps to a column on anything.
//
//   practice_checklist (+ _item, _run, _response, migration 262) -- THE NEAREST NEIGHBOUR, BUILT LAST
//     WEEK, AND STILL THE WRONG SHAPE. Its lifecycle is right and is copied. Its ANSWER is not:
//     practice_checklist_response.response is a CHECK over exactly three values -- done, not_done,
//     not_applicable. Phase 2's own header says why it stopped there: "A checklist item that collects a
//     blood pressure or a free-text finding is a FORM, which is this programme's Phase 3." Widening that
//     column to hold text, numbers, dates and lists would turn every checklist into a form and take the
//     three-answer discipline -- and the "not applicable needs words" constraint -- with it.
//
//   practice_guidance_document (+ _section, migrations 256/257) -- PROSE WITH EIGHT NAMED SECTION KEYS
//     and nowhere to record an answer. A guidance document is READ.
//
//   practice_approval_request (migration 208) -- FITS, AND IS USED UNCHANGED. subject_kind already admits
//     'other', so THE APPROVAL SIDE OF THIS PHASE NEEDS NO MIGRATION AT ALL. Probed live: the CHECK is
//     ('document','patient','appointment','task','incoming_document','other').
//
//   practice_note_template (+ _section, migrations 195/204) -- `kind` is a seven-value CHECK and a
//     template is APPLIED TO A PATIENT: every row appears in the pick-list inside a consultation. An
//     incident report appearing beside "Referral letter" mid-consultation is a defect. It also has no
//     field rows -- a note template is a body of text with merge fields, not a set of questions.
//
//   configuration_registry_objects (the platform FormDesigner's store) -- ⚠ IT HAS NO workspace_id
//     COLUMN AT ALL. It is platform-tier by construction, so it cannot hold one practice's consent form
//     without a tenancy migration across the whole registry. Its 19-type field vocabulary is the target
//     this phase aims at and four of its types are still absent here, declared in FORM_COMPONENTS.
//
// ---- THE DDL --------------------------------------------------------------------------------------
//
// FOUR TABLES, and the last two are the capture half. The SUBMISSION is unavoidable for the reason Phase
// 2's run was: without it an answer has nothing to belong to, "this form was completed on Tuesday by Dr
// Okello" has no row, and the same question answered on two occasions collides.
//
// Plain idempotent statements, ASCII only, no do-blocks and no plpgsql, because the migration runner
// splits on semicolons. ⚠ NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT, INCLUDING INSIDE A COMMENT --
// that silently shredded two sections of migration 238 while reporting success.
//
// ⚠ REQUIRED TEXT IS `btrim(x) <> ''` AND NEVER `x is not null`. Migration 256 shipped that mistake and
// migration 257 was the correction. Every required-text constraint below is written the corrected way the
// first time, INCLUDING the one over a jsonb answer -- a form answer of a single space is not an answer,
// and if the database accepted one then a required question could be satisfied with the space bar.
//
// ⚠ NEVER .upsert() ONTO practice_form. It carries a PARTIAL unique index, and an upsert whose conflict
// target does not match a real TOTAL unique index fails silently rather than loudly. Every write below is
// an explicit insert or update and no error from one is discarded.
//
//   -- ============================================================
//   -- MIGRATION 263: PRACTICE FORMS (CPR-KS-001 section 4, Phase 3)
//   --
//   -- Form, question, submission and answer, for a practice_workspace. Section 4's thirteen offered
//   -- kinds, its eleven storable question types, its range and mandatory rules, its conditional
//   -- questions and a narrow calculated field.
//   --
//   -- NOT the patient registration form (that is one per practice, resolved automatically for every
//   -- registration, with its answers written onto the patient row), NOT a checklist (migration 262's
//   -- answer column is a CHECK over three values on purpose), NOT a guidance document (prose with eight
//   -- named sections and nowhere to record an answer), and NOT a note template (a body of text applied
//   -- to a patient inside a consultation).
//   --
//   -- Approval routes through the existing practice_approval_request with subject_kind 'other', so there
//   -- is no approval migration.
//   --
//   -- WARNING: NOTHING IN THIS SCHEMA CHECKS THAT AN ANSWER IS TRUE, AND NO COLUMN HERE IS A SIGNATURE.
//   -- A completed consent form records that somebody with a practice login typed answers. There is no
//   -- handwritten mark, no drawing, no attachment and no fresh identity check anywhere in this build,
//   -- and the asset says so on screen and on paper.
//   --
//   -- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql, and no semicolon anywhere
//   -- except ending a statement.
//   -- ============================================================
//
//   -- ---- 1. The form ----------------------------------------------------------------------------
//
//   create table if not exists practice_form (
//     id uuid primary key default gen_random_uuid(),
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//
//     -- The practice's own reference, e.g. CONS-01. Not a uuid: it is what people say out loud, and the
//     -- partial unique index below is about this and not about the id.
//     code text not null check (btrim(code) <> '' and char_length(code) <= 40),
//     title text not null check (btrim(title) <> '' and char_length(title) <= 200),
//     purpose text check (purpose is null or char_length(purpose) <= 600),
//
//     -- WARNING: THIRTEEN KINDS, AND SECTION 4 NAMES FOURTEEN. The fourteenth is "Registration forms" and
//     -- it is left out on purpose: this product already has one, it is a different object with a floor
//     -- of its own, and a second thing called the registration form that the registration desk never
//     -- sees is a support call waiting to happen. FORM_TYPE_NOT_OFFERED says so on the screen.
//     -- WARNING: A FOURTEENTH KIND IS A MIGRATION BEFORE THE UI OFFERS IT, NEVER AFTER. A studio that
//     -- lets somebody invent a kind produces rows the DATABASE rejects and no front-end work fixes it.
//     form_type text not null check (form_type in (
//       'clinical_assessment', 'referral', 'consent', 'procedure', 'audit', 'research',
//       'questionnaire', 'patient_survey', 'risk_assessment', 'inspection', 'incident',
//       'teaching', 'custom')),
//
//     -- WARNING: WHAT ONE COMPLETED FORM IS ABOUT, DECLARED ON THE FORM. TWO VALUES AND NOT THREE, which
//     -- is migration 262's decision taken again: "you may name a patient" means half a practice's
//     -- consent forms have one and nothing can then tell a deliberate omission from a forgotten one.
//     -- WARNING: THE MATCH IS THE ENGINE'S RULE, NOT A CONSTRAINT. This column is on the form and the
//     -- patient is on the submission, and a CHECK cannot see a sibling table.
//     subject text not null default 'none' check (subject in ('patient', 'none')),
//
//     specialty text,
//     tags text[] not null default '{}'
//       check (array_length(tags, 1) is null or array_length(tags, 1) <= 12),
//
//     -- ACCOUNTABILITY, NOT PERMISSION. Naming an owner does not restrict who may edit, and the screen
//     -- says so -- an owner column that looked like an access rule and was not would be worse than none.
//     owner_id uuid,
//
//     status text not null default 'draft'
//       check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
//     version integer not null default 1 check (version >= 1),
//
//     -- EVERY VERSION IS A ROW, linked backwards, because a completed form names the version it answered
//     -- and a reader has to be able to open the questions that were actually in front of the person.
//     supersedes_id uuid references practice_form(id) on delete set null,
//
//     -- WARNING: NO `on delete` CLAUSE, AND IT IS THE CONSIDERED CHOICE OF THREE, exactly as migrations
//     -- 256 and 262 reasoned. Deleting the approval out from under a form in use would leave it in use
//     -- with nothing behind it, so a lone deletion must be refused -- but `on delete restrict` checks
//     -- IMMEDIATELY and both tables cascade from practice_workspace, so dropping a workspace could abort
//     -- depending on which cascade Postgres ran first. `on delete set null` is worse: it is an UPDATE, so
//     -- it would trip practice_form_in_force on any published row. The DEFAULT (`no action`) is checked
//     -- at END OF STATEMENT, which refuses the lone deletion and lets the workspace cascade run.
//     approval_request_id uuid references practice_approval_request(id),
//
//     -- A DATE, NOT A TIMESTAMP. "In use from 1 January" is a day, and rendering a timezone-shifted
//     -- instant for it is how a form appears to start the evening before.
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
//     -- WARNING: IN USE MEANS IN USE, AND IT NEEDS BOTH FACTS. THE ENGINE DOES NOT REPEAT THIS -- it
//     -- reports the gap so somebody sees it before trying, and when they try anyway the database refuses
//     -- and the constraint is named in the refusal.
//     -- WARNING: WHAT IT CANNOT SEE: whether that approval was actually DECIDED. A PENDING request
//     -- satisfies this constraint. APPROVAL_DECIDED in form-constants.ts is the engine's, and the split
//     -- of authority is written down so nobody later assumes the database covered both.
//     constraint practice_form_in_force
//       check (status <> 'published'
//              or (effective_from is not null and approval_request_id is not null)),
//
//     constraint practice_form_review_after_effect
//       check (review_on is null or effective_from is null or review_on > effective_from),
//
//     -- WARNING: `btrim(...) <> ''` AND NOT `is not null`. Migration 257's correction, applied the first
//     -- time: a blank string is not null, so `is not null` alone lets somebody withdraw a consent form by
//     -- pressing the space bar.
//     constraint practice_form_archived_reason
//       check (status <> 'archived'
//              or (archived_reason is not null and btrim(archived_reason) <> '')),
//
//     constraint practice_form_not_self_superseding
//       check (supersedes_id is null or supersedes_id <> id)
//   );
//
//   -- WARNING: ONE REFERENCE, ONE FORM IN USE, AND IT IS PARTIAL ON PURPOSE. A practice may hold ten
//   -- drafts of CONS-01 and exactly one in use. Two forms in use under one reference is how half a
//   -- practice fills in a different set of questions, and no amount of engine care prevents it if the
//   -- database allows it. Publishing a new version therefore requires withdrawing the old one, in that
//   -- order.
//   create unique index if not exists ux_practice_form_published_code
//     on practice_form(workspace_id, lower(code)) where status = 'published';
//
//   create index if not exists idx_practice_form_library
//     on practice_form(workspace_id, status, form_type);
//   create index if not exists idx_practice_form_review_due
//     on practice_form(workspace_id, review_on) where status = 'published';
//   create index if not exists idx_practice_form_supersedes
//     on practice_form(supersedes_id) where supersedes_id is not null;
//
//   -- ---- 2. The questions -------------------------------------------------------------------------
//   --
//   -- WARNING: THE ELEVEN TYPES ARE MIGRATION 223's NINE, IN 223's ORDER, PLUS TWO. That ordering is
//   -- load-bearing rather than tidy: practice_registration_field.field_type carries the same nine as a
//   -- CHECK, and PRACTICE_FIELD_TYPES in form-field.ts carries all eleven, and the harness asserts the
//   -- three lists against one another including against 223's SQL text. If they drift, an author builds
//   -- a form whose submission the database refuses and the practitioner has no way to tell which of the
//   -- choices on their own screen was the impossible one.
//   --
//   -- `time` is added because section 4 names it. `calculated` is added because section 4 asks for
//   -- calculated fields -- narrowed here to adding up or counting other answers, with no expression
//   -- language anywhere, and nothing of the sort is added to the registration table.
//
//   create table if not exists practice_form_field (
//     id uuid primary key default gen_random_uuid(),
//
//     -- WARNING: DENORMALISED FROM THE PARENT ON PURPOSE. It lets every write scope itself IN THE UPDATE
//     -- STATEMENT rather than after a prior read -- a bulk write verified by an earlier read is one that
//     -- writes whatever it was passed if the read and the write disagree. Written on insert, never after.
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//     form_id uuid not null references practice_form(id) on delete cascade,
//
//     -- THE STABLE NAME A CONDITION AND A CALCULATION POINT AT. Same pattern and same regex as
//     -- practice_registration_field.field_key, so one authoring habit covers both.
//     field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,40}$'),
//
//     -- NULL means the question is not under a heading. The btrim guard is there because a section of
//     -- spaces renders as a heading with no name.
//     section text check (section is null or (btrim(section) <> '' and char_length(section) <= 120)),
//
//     position integer not null check (position >= 1),
//     label text not null check (btrim(label) <> '' and char_length(label) <= 240),
//     help text check (help is null or char_length(help) <= 2000),
//
//     field_type text not null default 'text' check (field_type in (
//       'text', 'long_text', 'number', 'date', 'select', 'multi_select', 'boolean', 'phone', 'email',
//       'time', 'calculated')),
//
//     -- REQUIRED means a completed form cannot be submitted without an answer to it. An answer of spaces
//     -- is not an answer -- see practice_form_answer_not_empty below, and isBlankAnswer in form-field.ts,
//     -- which are the same rule in the two places it has to hold.
//     required boolean not null default true,
//
//     -- [{"value":"yes","label":"Agreed"}]. A select with nothing in it is refused at publish by
//     -- RULES_COHERENT rather than by a CHECK, because "this type needs options" is a fact about two
//     -- columns at once and a CHECK reading both would have to be rewritten for every new type.
//     options jsonb not null default '[]'::jsonb,
//
//     -- Section 4's Ranges and Calculations. {"min":0,"max":10} or
//     -- {"calculate":{"of":"sum","fields":["a","b"]}}. WARNING: THERE IS NO `pattern` KEY AND THERE MAY
//     -- NEVER BE ONE. An author-written regular expression run on the server for every submission is a
//     -- denial of service somebody can create by accident. validateAnswer refuses a rules object carrying
//     -- one BY NAME rather than ignoring it, so an author finds out at once instead of believing a rule
//     -- is in force.
//     rules jsonb,
//
//     -- Section 4's "Conditional questions", and it is practice_registration_field.condition's COLUMN,
//     -- shape for shape. Three forms and no fourth --
//     --   {"when": "has_allergy", "equals": "yes"}
//     --   {"when": "referral_source", "in": ["gp", "self"]}
//     --   {"when": "weight_kg", "isPresent": true}
//     -- `when` is another question's field_key ON THIS FORM and the value compared against is THAT
//     -- QUESTION'S ANSWER -- which is the difference from migration 262, where it was one of three
//     -- response codes. Evaluated by ONE function, conditionMet in registration-condition.ts, which the
//     -- server and the fill-in screen both import.
//     -- WARNING: NOT A CHECK CONSTRAINT: whether a condition names a question that exists, and one that
//     -- comes EARLIER, is a fact about sibling rows. CONDITIONS_RESOLVE is the engine's, at publish.
//     condition jsonb,
//
//     created_at timestamptz not null default now()
//   );
//
//   -- One question per name, and one question per slot. The second is not redundant: without it two
//   -- questions can both claim position 3 and the order of a consent form becomes whatever the planner
//   -- returns.
//   create unique index if not exists ux_practice_form_field_key
//     on practice_form_field(form_id, field_key);
//   create unique index if not exists ux_practice_form_field_position
//     on practice_form_field(form_id, position);
//   create index if not exists idx_practice_form_field_list
//     on practice_form_field(form_id, position);
//
//   -- ---- 3. The completed form --------------------------------------------------------------------
//
//   create table if not exists practice_form_submission (
//     id uuid primary key default gen_random_uuid(),
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//
//     -- WARNING: NO `on delete` CLAUSE, DELIBERATELY. Deleting a form would take with it the record of
//     -- what people answered against it, which is the one thing nobody may lose. The default
//     -- (`no action`) refuses the lone deletion and is checked at END OF STATEMENT, so the workspace
//     -- cascade that removes both still succeeds. Withdrawing a form is `archived`, never a delete.
//     form_id uuid not null references practice_form(id),
//
//     -- WARNING: WHICH VERSION WAS ON THE SCREEN. Snapshotted rather than joined, because the form can be
//     -- revised and a reader of last year's record has to see which questions were actually asked. It is
//     -- a number and not a copy of the questions -- the questions are immutable once published, since
//     -- editing anything that is not a draft is refused.
//     form_version integer not null check (form_version >= 1),
//
//     -- WARNING: NO `on delete` CLAUSE HERE EITHER. A patient row is never deleted by this product -- a
//     -- merge marks the loser `merged` with merged_into_patient_id -- so nothing legitimate is blocked,
//     -- and `on delete set null` would quietly strip the subject off a completed form.
//     -- WARNING: THE KNOWN GAP: mergePatients() repoints a fixed list of child tables and this is not on
//     -- it, so a merged patient's completed forms stay attached to the row that was merged away.
//     -- Declared in FORM_KNOWN_GAPS and shown on screen, because a gap recorded only in a commit message
//     -- is one the next person rediscovers as a bug.
//     patient_id uuid references practice_patient(id),
//
//     -- Which clinic, which visit, which machine. Free text, because the alternative is a location
//     -- vocabulary this phase has no business inventing.
//     context_note text check (context_note is null or char_length(context_note) <= 200),
//
//     status text not null default 'in_progress'
//       check (status in ('in_progress', 'submitted', 'abandoned')),
//
//     started_at timestamptz not null default now(),
//     started_by uuid,
//     submitted_at timestamptz,
//     submitted_by uuid,
//     abandoned_reason text,
//
//     -- A record marked submitted with no time on it cannot be read as a record of anything.
//     constraint practice_form_submission_submitted
//       check (status <> 'submitted' or submitted_at is not null),
//
//     -- Started and left, with no word about why, tells the next person nothing. Written with btrim for
//     -- migration 257's reason.
//     constraint practice_form_submission_abandoned_reason
//       check (status <> 'abandoned'
//              or (abandoned_reason is not null and btrim(abandoned_reason) <> ''))
//   );
//
//   create index if not exists idx_practice_form_submission_list
//     on practice_form_submission(workspace_id, form_id, started_at desc);
//   create index if not exists idx_practice_form_submission_open
//     on practice_form_submission(workspace_id, status) where status = 'in_progress';
//   create index if not exists idx_practice_form_submission_patient
//     on practice_form_submission(workspace_id, patient_id) where patient_id is not null;
//
//   -- ---- 4. The answers ---------------------------------------------------------------------------
//   --
//   -- WARNING: ONE ROW PER ANSWER AND NOT ONE jsonb BLOB PER SUBMISSION, and this is the one place this
//   -- phase deliberately does NOT copy the registration model. custom_fields is a blob because it belongs
//   -- to a person and is read whole. A form answer has to be countable across submissions -- section 4
//   -- lists Analytics as an output -- and a blob makes that a jsonb scan over every completed form. It
//   -- also makes "which answers were cleared when a condition withdrew a question" a read-modify-write of
//   -- the whole record, which is exactly the shape that loses somebody else's concurrent answer.
//
//   create table if not exists practice_form_answer (
//     id uuid primary key default gen_random_uuid(),
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//     submission_id uuid not null references practice_form_submission(id) on delete cascade,
//
//     -- WARNING: NO `on delete` CLAUSE. Deleting a question somebody has already answered would erase the
//     -- answer and leave the record shorter than it was, with nothing saying so. Through the engine it
//     -- cannot happen -- only a draft is editable and a form may only be filled in when published -- but
//     -- a direct write must be refused rather than allowed to cascade quietly.
//     field_id uuid not null references practice_form_field(id),
//
//     -- jsonb, because an answer is a string, a number, a boolean or a list depending on the question,
//     -- and eleven typed columns would be ten nulls per row. The TYPE is the question's, not this
//     -- column's, and validateAnswer in form-field.ts is what makes the two agree before anything is
//     -- written -- it returns the NORMALISED value and the engine writes that rather than what it was
//     -- given, so "12" from an HTML input is stored as the number 12.
//     value jsonb not null,
//
//     answered_at timestamptz not null default now(),
//     answered_by uuid,
//
//     -- WARNING: AN ANSWER OF SPACES IS NOT AN ANSWER, AND NEITHER IS AN EMPTY LIST. This is migration
//     -- 257's `btrim` correction carried onto a jsonb column, and it is load-bearing rather than tidy:
//     -- without it, a required question could be satisfied with the space bar, the form would submit, and
//     -- the completed record would show a blank beside a question that the engine had counted as
//     -- answered. There is no row for an unanswered question, so "unanswered" and "answered blank" can
//     -- never be confused for one another.
//     constraint practice_form_answer_not_empty
//       check (value <> 'null'::jsonb
//              and (jsonb_typeof(value) <> 'string' or btrim(value #>> '{}') <> '')
//              and (jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 0))
//   );
//
//   -- One answer per question per completed form.
//   create unique index if not exists ux_practice_form_answer_once
//     on practice_form_answer(submission_id, field_id);
//   create index if not exists idx_practice_form_answer_submission
//     on practice_form_answer(submission_id);
//   -- Section 4's Analytics output would start here: every answer to one question, across every completed
//   -- form. Nothing reads it yet and FORM_OUTPUTS says so.
//   create index if not exists idx_practice_form_answer_field
//     on practice_form_answer(workspace_id, field_id);
//
//   -- ---- Capabilities ------------------------------------------------------------------------------
//   --
//   -- NONE MINTED. Reading takes document.view, authoring takes template.manage, and FILLING ONE IN takes
//   -- task.manage -- probed live, 50 codes seeded, no form.* among them. task.manage is an approximation
//   -- and is declared as one in form-constants.ts: it is the closest seeded code for "recording that
//   -- practice work was done" and it is held by practitioner, practice_assistant and practice_owner,
//   -- which is the right audience. The honest consequence is that anybody who can close a task can fill
//   -- in a form, including a consent form. Six invented capability codes have shipped in this product --
//   -- an invented code compiles, 403s for everybody including the practice owner, and errors nowhere.
//
//   -- ---- RLS: deny-by-default ----------------------------------------------------------------------
//   alter table practice_form enable row level security;
//   alter table practice_form_field enable row level security;
//   alter table practice_form_submission enable row level security;
//   alter table practice_form_answer enable row level security;
//
//   notify pgrst, 'reload schema';
//
// ---- ⚠ UNTIL THAT MIGRATION IS APPLIED ------------------------------------------------------------
//
// Everything below is written against those tables and stops at the door rather than pretending.
// formStorePresence() ASKS THE DATABASE -- it does not assume, and it does not use head+count, because a
// missing table and an empty table both return count === null and four "missing" results in the survey
// this build follows were exactly that trap. The library reports `state: "absent"` with the migration
// named, and every write returns STORE_ABSENT rather than a stack trace. The moment the migration lands,
// all of it works with no code change.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const FORM_TABLE = "practice_form";
export const FORM_FIELD_TABLE = "practice_form_field";
export const FORM_SUBMISSION_TABLE = "practice_form_submission";
export const FORM_ANSWER_TABLE = "practice_form_answer";
export const FORM_TABLES = [
  FORM_TABLE, FORM_FIELD_TABLE, FORM_SUBMISSION_TABLE, FORM_ANSWER_TABLE,
];
/** Named in the absent-store message so nobody has to guess which migration is missing. */
export const FORM_MIGRATION =
  "practice-forms (practice_form + practice_form_field + practice_form_submission + practice_form_answer)";

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
  message: `${FORM_MODULE_NAME} has no store in this deployment yet. Migration "${FORM_MIGRATION}" has not been applied, so there is nowhere for a form or a completed form to go.`,
});

// ── IS THE STORE THERE? ─────────────────────────────────────────────────────────────────────────────

export type FormStorePresence = {
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
 * "missing" is the trap that produced four wrong answers in the survey this build follows. The error CODE
 * is the only thing that distinguishes them.
 */
export async function formStorePresence(admin: any): Promise<FormStorePresence> {
  const results: { table: string; present: boolean }[] = [];
  let failure: string | null = null;

  for (const table of FORM_TABLES) {
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
      : `Migration "${FORM_MIGRATION}" has not been applied. ${results.filter(r => !r.present).map(r => r.table).join(", ")} do not exist.`,
  };
}

// ── PURE: WHICH QUESTIONS APPLY, AND WHAT A COMPLETED FORM STILL NEEDS ──────────────────────────────

export type FormFieldRow = FormFieldLike & {
  id: string;
  field_key: string;
  section: string | null;
  position: number;
  label: string;
  help: string | null;
  field_type: string;
  required: boolean;
};

export type FormAnswerRow = {
  field_id: string; value: unknown;
  answered_at?: string | null; answered_by?: string | null;
};

export type RenderedFormField = FormFieldRow & {
  /** ⚠ FOUR OUTCOMES AND NOT TWO. `did_not_apply` and `not_answered` mean opposite things. */
  state: "answered" | "not_answered" | "did_not_apply" | "calculated";
  value: unknown;
  /** The answer as words, or null. ⚠ Never an empty string -- a blank reads as "nothing to say here". */
  display: string | null;
  answeredAt: string | null;
  /** Only for did_not_apply: the question whose answer withdrew this one, so the reason is readable. */
  withheldBy: string | null;
  /** Only for calculated: the figure, what went into it, and what did not. */
  calculated: CalculatedValue | null;
};

/** The answers as the shared resolver wants them: keyed by field_key, valued by the answer itself. */
export function answerMap(fields: FormFieldRow[], answers: FormAnswerRow[]): Record<string, unknown> {
  const byId = new Map(fields.map(f => [f.id, f.field_key]));
  const out: Record<string, unknown> = {};
  for (const a of answers ?? []) {
    const key = byId.get(a.field_id);
    if (key !== undefined) out[key] = a.value;
  }
  return out;
}

/**
 * The form as the person filling it in sees it, and as a reader of the finished record sees it.
 *
 * ⚠ A QUESTION THAT DID NOT APPLY IS NOT A QUESTION THAT WAS MISSED, and rendering both as a blank is how
 * a printed record loses the difference. Four states, each with its own mark, none of them blank.
 */
export function renderForm(
  fields: FormFieldRow[],
  answers: FormAnswerRow[],
): {
  rendered: RenderedFormField[];
  applicable: FormFieldRow[];
  withdrawn: FormFieldRow[];
  calculated: CalculatedValue[];
} {
  const ordered = [...(fields ?? [])].sort((a, b) => a.position - b.position);
  const values = answerMap(ordered, answers ?? []);
  const { applicable } = applicableFields(ordered, values);
  const applicableKeys = new Set(applicable.map(f => f.field_key));
  const byField = new Map((answers ?? []).map(a => [a.field_id, a]));

  // ⚠ THE WHOLE AUTHORED FORM AND THE WHOLE ANSWER MAP GO IN, AND THIS IS DELIBERATE.
  //
  // It used to hand in only the questions currently drawn, and that was a defect with a clinical
  // consequence: the moment a condition withdrew one of a total's inputs, the reference read as dangling
  // and the total collapsed to nought. `calculatedValues` now works out applicability itself, so it can
  // tell "this input was withdrawn" from "this input is missing" -- which are opposite things and must
  // never print as the same sentence.
  const calculated = calculatedValues(ordered, values);
  const calcByKey = new Map(calculated.map(c => [c.field_key, c]));

  const rendered: RenderedFormField[] = ordered.map(field => {
    const base = { ...field, value: null as unknown, display: null as string | null, answeredAt: null as string | null, withheldBy: null as string | null, calculated: null as CalculatedValue | null };

    if (!applicableKeys.has(field.field_key)) {
      // Which earlier question's answer withdrew this one. Read off the condition rather than guessed.
      const c = field.condition && typeof field.condition === "object"
        ? (field.condition as Record<string, unknown>) : null;
      const when = c && typeof c.when === "string" ? c.when : null;
      const source = when ? ordered.find(f => f.field_key === when) ?? null : null;
      return { ...base, state: "did_not_apply", withheldBy: source ? source.label : when };
    }

    if (fieldType(field.field_type)?.valueKind === "derived") {
      const calc = calcByKey.get(field.field_key) ?? null;
      return {
        ...base, state: "calculated", calculated: calc,
        value: calc && !calc.problem ? calc.value : null,
        display: calc && !calc.problem ? String(calc.value) : null,
      };
    }

    const answer = byField.get(field.id) ?? null;
    if (!answer || isBlankAnswer(answer.value)) return { ...base, state: "not_answered" };
    return {
      ...base, state: "answered", value: answer.value,
      display: displayAnswer(field, answer.value),
      answeredAt: answer.answered_at ?? null,
    };
  });

  return {
    rendered, applicable,
    withdrawn: ordered.filter(f => !applicableKeys.has(f.field_key)),
    calculated,
  };
}

export type SubmissionCompleteness = {
  /** Required, applicable and unanswered. A LIST, never a bare number. */
  outstanding: RenderedFormField[];
  /**
   * ⚠ Answers that are stored and no longer satisfy their own question's rules. Through the engine this
   * cannot happen -- every write validates -- so a non-empty list means somebody wrote directly to the
   * table, and the person about to submit needs to know rather than to be silently refused later.
   */
  invalid: { field: RenderedFormField; message: string }[];
  /** Questions whose conditions withdrew them. Also a list -- "eleven of twelve" needs the twelfth named. */
  didNotApply: RenderedFormField[];
  /** Every worked-out answer, each naming what it could not use. */
  calculated: CalculatedValue[];
  answered: number;
  applicable: number;
  /** ⚠ SUBMITTABLE, not "correct". */
  submittable: boolean;
};

/**
 * What a completed form still needs before it can be submitted.
 *
 * ⚠ A CALCULATED QUESTION IS NEVER OUTSTANDING. Nobody answers it, so waiting for an answer to it would
 * be a form that can never be submitted. What it CAN be is incomplete -- a total missing two of its five
 * inputs -- and that is reported through `calculated`, beside the figure, rather than as a refusal.
 */
export function submissionCompleteness(
  fields: FormFieldRow[],
  answers: FormAnswerRow[],
): SubmissionCompleteness {
  const { rendered, calculated } = renderForm(fields, answers);
  const live = rendered.filter(r => r.state !== "did_not_apply" && r.state !== "calculated");

  const invalid: { field: RenderedFormField; message: string }[] = [];
  for (const r of live) {
    if (r.state !== "answered") continue;
    const check = validateAnswer(r, r.value);
    if (!check.ok) invalid.push({ field: r, message: check.message });
  }

  const outstanding = live.filter(r => r.required !== false && r.state === "not_answered");
  return {
    outstanding,
    invalid,
    didNotApply: rendered.filter(r => r.state === "did_not_apply"),
    calculated,
    answered: live.filter(r => r.state === "answered").length,
    applicable: live.length,
    submittable: outstanding.length === 0 && invalid.length === 0,
  };
}

// ── PURE: PUBLICATION READINESS ─────────────────────────────────────────────────────────────────────

export type FormCheckResult = {
  code: string; requirement: string; severity: string; authority: string;
  state: "pass" | "fail" | "not_checked";
  detail: string; wouldNeed: string | null;
};

/**
 * ⚠ THREE STATES, and `not_checked` is the honest answer for the three rows whose facts have no store to
 * live in. Never a green tick and never silence.
 *
 * The `database` rows are REPORTED, NOT RE-IMPLEMENTED. They restate what the constraint will do, so
 * somebody can see the gap before they try.
 */
export function formReadiness(
  doc: { effective_from: string | null; review_on: string | null; approval_request_id: string | null; status: string },
  fields: FormFieldRow[],
  approval: { status: string } | null,
): { checks: FormCheckResult[]; blockers: number; warnings: number; publishable: boolean } {
  const ordered = [...(fields ?? [])].sort((a, b) => a.position - b.position);
  const keyPosition = new Map(ordered.map(f => [f.field_key, f.position]));

  // ⚠ EVERY CONDITION HAS TO NAME AN EARLIER QUESTION ON THIS FORM. An unknown key hides its question
  // forever. A LATER key can never be true when its own question is reached, which is the same outcome by
  // a slower route -- and forbidding backwards references is also what makes a loop impossible to author.
  const badConditions = ordered.filter(f => {
    if (!f.condition || typeof f.condition !== "object") return false;
    const when = (f.condition as Record<string, unknown>).when;
    if (typeof when !== "string") return true;
    const at = keyPosition.get(when);
    return at === undefined || at >= f.position;
  });

  // ⚠ AND THE SAME RULE FOR A CALCULATION, PLUS TWO MORE: it may not use another worked-out answer, and
  // when it is adding up it may only use numbers. Chaining one calculation onto another is an expression
  // language by the back door.
  const badCalculations: { key: string; why: string }[] = [];
  for (const f of ordered) {
    const isDerived = fieldType(f.field_type)?.valueKind === "derived";
    const calc = fieldRules(f).calculate;
    if (!isDerived && calc)
      badCalculations.push({ key: f.field_key, why: `"${f.label}" carries a calculation but is not a worked-out question` });
    if (!isDerived) continue;
    if (!calc || !CALCULATION_CODES.includes(calc.of) || !Array.isArray(calc.fields) || calc.fields.length === 0) {
      badCalculations.push({ key: f.field_key, why: `"${f.label}" is worked out from other answers but does not say which ones or how` });
      continue;
    }
    for (const key of calc.fields.map(String)) {
      const source = ordered.find(x => x.field_key === key);
      if (!source) { badCalculations.push({ key: f.field_key, why: `"${f.label}" names "${key}", which is not a question on this form` }); continue; }
      if (source.position >= f.position) { badCalculations.push({ key: f.field_key, why: `"${f.label}" uses "${key}", which comes after it` }); continue; }
      const sourceKind = fieldType(source.field_type)?.valueKind;
      if (sourceKind === "derived") { badCalculations.push({ key: f.field_key, why: `"${f.label}" uses "${key}", which is itself worked out -- one calculation may not feed another` }); continue; }
      if (calc.of === "sum" && sourceKind !== "number")
        badCalculations.push({ key: f.field_key, why: `"${f.label}" adds up "${key}", which is not a number question` });
    }
  }

  // Rules nothing could ever satisfy.
  const badRules: string[] = [];
  for (const f of ordered) {
    const r = fieldRules(f);
    const kind = fieldType(f.field_type)?.valueKind;
    if (!kind) { badRules.push(`"${f.label}" is a ${f.field_type}, which is not a kind of question this build can store`); continue; }
    if (r.min !== undefined && r.max !== undefined && r.min > r.max)
      badRules.push(`"${f.label}" has a lowest of ${r.min} above its highest of ${r.max}`);
    if (r.minLength !== undefined && r.maxLength !== undefined && r.minLength > r.maxLength)
      badRules.push(`"${f.label}" has a shortest of ${r.minLength} above its longest of ${r.maxLength}`);
    if (r.earliest && r.latest && r.earliest > r.latest)
      badRules.push(`"${f.label}" has an earliest of ${r.earliest} after its latest of ${r.latest}`);
    if ("pattern" in (r as Record<string, unknown>))
      badRules.push(`"${f.label}" carries a pattern rule, which this build does not run -- use a list of choices instead`);
    if (fieldType(f.field_type)?.needsOptions && fieldOptions(f).length === 0)
      badRules.push(`"${f.label}" is a list with nothing in it`);
  }

  const checks: FormCheckResult[] = FORM_CHECKS.map(def => {
    const base = {
      code: def.code, requirement: def.requirement, severity: def.severity,
      authority: def.authority, detail: def.detail, wouldNeed: def.wouldNeed,
    };
    if (def.authority === "absent") return { ...base, state: "not_checked" as const };
    if (def.authority === "build") return { ...base, state: "pass" as const };

    switch (def.code) {
      case "HAS_FIELDS":
        return { ...base, state: ordered.length > 0 ? ("pass" as const) : ("fail" as const) };
      case "CONDITIONS_RESOLVE":
        return {
          ...base, state: badConditions.length === 0 ? ("pass" as const) : ("fail" as const),
          detail: badConditions.length
            ? `${def.detail} Broken on: ${badConditions.map(f => f.field_key).join(", ")}.`
            : def.detail,
        };
      case "CALCULATIONS_RESOLVE":
        return {
          ...base, state: badCalculations.length === 0 ? ("pass" as const) : ("fail" as const),
          detail: badCalculations.length
            ? `${def.detail} Broken on: ${badCalculations.map(b => b.why).join("; ")}.`
            : def.detail,
        };
      case "RULES_COHERENT":
        return {
          ...base, state: badRules.length === 0 ? ("pass" as const) : ("fail" as const),
          detail: badRules.length ? `${def.detail} Broken on: ${badRules.join("; ")}.` : def.detail,
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
        // ⚠ DELIBERATELY NOT PRE-CHECKED AGAINST THE TABLE. The index is the rule. Reporting it as a pass
        // here would be a second implementation of it, and the two would eventually disagree.
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

export type FormLibrary = {
  /** ⚠ Three states. `failed` is not `absent` and neither is an empty library. */
  state: "ok" | "absent" | "failed";
  detail: string | null;
  items: any[];
  /** Every figure below is the length of a list, and each carries the filter that opens it. */
  counts: { key: string; label: string; total: number; href: string }[];
  reviewOverdue: any[];
  facets: typeof FORM_FACETS;
  notVerified: typeof FORM_NOT_VERIFIED;
};

const LIBRARY_COLUMNS =
  "id, code, title, purpose, form_type, subject, specialty, tags, owner_id, status, version, " +
  "supersedes_id, approval_request_id, effective_from, review_on, published_at, archived_at, " +
  "archived_reason, created_at, created_by, updated_at";

const FIELD_COLUMNS =
  "id, field_key, section, position, label, help, field_type, required, options, rules, condition";

export async function formLibrary(admin: any, workspaceId: string, opts: {
  q?: string | null; kind?: string | null; status?: string | null;
  specialty?: string | null; tag?: string | null; author?: string | null;
} = {}): Promise<FormLibrary> {
  const shell = {
    items: [] as any[],
    counts: [] as { key: string; label: string; total: number; href: string }[],
    reviewOverdue: [] as any[],
    facets: FORM_FACETS,
    notVerified: FORM_NOT_VERIFIED,
  };

  // ⚠ NO SEPARATE PRESENCE PROBE ON THE PAGE PATH. The real query's own error CODE distinguishes a
  // missing table from a failed read. What is NOT done either way is head+count.
  let query = admin.from(FORM_TABLE).select(LIBRARY_COLUMNS).eq("workspace_id", workspaceId);
  if (opts.kind && FORM_TYPE_CODES.includes(opts.kind)) query = query.eq("form_type", opts.kind);
  if (opts.status && FORM_STATE_CODES.includes(opts.status)) query = query.eq("status", opts.status);
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
      detail: `Migration "${FORM_MIGRATION}" has not been applied. ${FORM_TABLES.join(", ")} do not exist.`,
    };
  // ⚠ A FAILED READ IS NEVER A ZERO. `data == null` with no error is also a failure, not an empty shelf.
  if (error || data == null)
    return { ...shell, state: "failed", detail: error?.message ?? "the form library came back as neither rows nor an error" };

  const rows = data as any[];

  const people = [...new Set(rows.flatMap(r => [r.created_by, r.owner_id]).filter(Boolean))];
  const { data: profiles } = people.length
    ? await admin.from("profiles").select("id, full_name").in("id", people)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  // ⚠ ONE COUNT QUERY FOR THE QUESTIONS, NOT ONE PER FORM. A question count on the library is a figure
  // and it has to be the length of the list its row opens -- so it is read, not estimated.
  const ids = rows.map(r => r.id);
  const { data: fieldRows, error: fErr } = ids.length
    ? await admin.from(FORM_FIELD_TABLE).select("id, form_id").in("form_id", ids).limit(5000)
    : { data: [], error: null };
  // ⚠ A FAILED QUESTION READ IS NOT ZERO QUESTIONS. It is `null`, and the screen says "not counted".
  const fieldsBy = new Map<string, number>();
  if (!fErr && fieldRows != null)
    for (const r of fieldRows as any[]) fieldsBy.set(r.form_id, (fieldsBy.get(r.form_id) ?? 0) + 1);
  const fieldCountsKnown = !fErr && fieldRows != null;

  const items = rows.map(r => ({
    ...r,
    kindLabel: formTypeLabel(r.form_type),
    stateLabel: formState(r.status)?.label ?? r.status,
    usable: FORM_STATES_USABLE.includes(r.status),
    fieldCount: fieldCountsKnown ? (fieldsBy.get(r.id) ?? 0) : null,
    authorName: r.created_by ? nameOf.get(r.created_by) ?? null : null,
    ownerName: r.owner_id ? nameOf.get(r.owner_id) ?? null : null,
    href: `${FORM_ROUTE}/${r.id}`,
  }));

  // ⚠ COUNTED OFF THE ROWS ALREADY READ, not by a second query with a different filter.
      // ⚠ THE PRACTICE'S DAY, NOT THE SERVER'S. This decides whether a published form is shown as
      // overdue for review. On the server's day the flag turned over three hours early or late, so an item
      // due today read as overdue -- and the count above the list disagreed with the list for that window.
      const { today } = await workspaceClock(admin, workspaceId);
  const reviewOverdue = items.filter(i => i.status === "published" && i.review_on && i.review_on < today);

  const counts = [
    { key: "published", label: "In use", total: items.filter(i => i.status === "published").length,
      href: `${FORM_ROUTE}?status=published` },
    { key: "in_review", label: "Waiting for approval", total: items.filter(i => i.status === "in_review").length,
      href: `${FORM_ROUTE}?status=in_review` },
    { key: "approved", label: "Approved, not yet in use", total: items.filter(i => i.status === "approved").length,
      href: `${FORM_ROUTE}?status=approved` },
    { key: "draft", label: "Drafts", total: items.filter(i => i.status === "draft").length,
      href: `${FORM_ROUTE}?status=draft` },
    { key: "review_overdue", label: "Past their review date", total: reviewOverdue.length,
      href: `${FORM_ROUTE}?status=published&overdue=1` },
  ];

  return { state: "ok", detail: null, items, counts, reviewOverdue, facets: FORM_FACETS, notVerified: FORM_NOT_VERIFIED };
}

export type FormDetail = {
  state: "ok" | "absent" | "failed" | "not_found";
  detail: string | null;
  form: any | null;
  fields: FormFieldRow[];
  approval: any | null;
  readiness: ReturnType<typeof formReadiness> | null;
  /** Forms completed against it. A list you can open, never a bare count. */
  submissions: any[];
  /** ⚠ "failed" when the list could not be read. NOT an empty array -- that would read as "never used". */
  submissionsState: "ok" | "failed";
  history: any[];
  moves: { from: string; to: string; label: string; why: string }[];
  notVerified: typeof FORM_NOT_VERIFIED;
};

export async function getForm(admin: any, workspaceId: string, formId: string): Promise<FormDetail> {
  const empty: FormDetail = {
    state: "absent", detail: null, form: null, fields: [], approval: null, readiness: null,
    submissions: [], submissionsState: "ok", history: [], moves: [], notVerified: FORM_NOT_VERIFIED,
  };

  const { data: doc, error } = await admin.from(FORM_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", formId).eq("workspace_id", workspaceId).maybeSingle();
  if (isMissingTable(error))
    return {
      ...empty, state: "absent",
      detail: `Migration "${FORM_MIGRATION}" has not been applied. ${FORM_TABLES.join(", ")} do not exist.`,
    };
  if (error) return { ...empty, state: "failed", detail: error.message };
  if (!doc) return { ...empty, state: "not_found", detail: null };

  const { data: fields, error: fErr } = await admin.from(FORM_FIELD_TABLE)
    .select(FIELD_COLUMNS).eq("form_id", formId).eq("workspace_id", workspaceId).order("position");
  if (fErr || fields == null)
    return { ...empty, state: "failed", detail: fErr?.message ?? "the form's questions came back as neither rows nor an error" };

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

  const { data: subs, error: sErr } = await admin.from(FORM_SUBMISSION_TABLE)
    .select("id, form_version, patient_id, context_note, status, started_at, started_by, submitted_at, submitted_by, abandoned_reason")
    .eq("form_id", formId).eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false }).limit(200);

  const { data: history } = await admin.from(FORM_TABLE)
    .select("id, code, title, status, version, published_at, archived_at, archived_reason")
    .eq("workspace_id", workspaceId).eq("supersedes_id", formId);
  const { data: replaced } = doc.supersedes_id
    ? await admin.from(FORM_TABLE)
      .select("id, code, title, status, version, published_at, archived_at, archived_reason")
      .eq("workspace_id", workspaceId).eq("id", doc.supersedes_id).maybeSingle()
    : { data: null };

  return {
    state: "ok", detail: null,
    form: {
      ...doc,
      kindLabel: formTypeLabel(doc.form_type),
      stateLabel: formState(doc.status)?.label ?? doc.status,
      stateMeaning: formState(doc.status)?.meaning ?? null,
      editable: FORM_STATES_EDITABLE.includes(doc.status),
      usable: FORM_STATES_USABLE.includes(doc.status),
    },
    fields: fields as FormFieldRow[],
    approval,
    readiness: formReadiness(doc, fields as FormFieldRow[], approval),
    // ⚠ A FAILED SUBMISSION READ IS NOT "NEVER USED". Reported, so the screen can say so.
    submissions: sErr || subs == null ? [] : (subs as any[]).map(s => ({
      ...s,
      stateLabel: formSubmissionState(s.status)?.label ?? s.status,
      href: `${FORM_ROUTE}/${formId}/submissions/${s.id}`,
    })),
    submissionsState: sErr || subs == null ? "failed" : "ok",
    history: [
      ...(replaced ? [{ ...replaced, relation: "replaced by this" }] : []),
      ...(((history ?? []) as any[]).map(h => ({ ...h, relation: "replaces this" }))),
    ],
    moves: formMovesFrom(doc.status),
    notVerified: FORM_NOT_VERIFIED,
  };
}

export type FormSubmissionDetail = {
  state: "ok" | "absent" | "failed" | "not_found";
  detail: string | null;
  submission: any | null;
  form: any | null;
  fields: FormFieldRow[];
  answers: FormAnswerRow[];
  rendered: RenderedFormField[];
  completeness: SubmissionCompleteness | null;
  notVerified: typeof FORM_NOT_VERIFIED;
};

export async function getFormSubmission(admin: any, workspaceId: string, submissionId: string): Promise<FormSubmissionDetail> {
  const empty: FormSubmissionDetail = {
    state: "absent", detail: null, submission: null, form: null, fields: [], answers: [],
    rendered: [], completeness: null, notVerified: FORM_NOT_VERIFIED,
  };

  const { data: sub, error } = await admin.from(FORM_SUBMISSION_TABLE)
    .select("id, form_id, form_version, patient_id, context_note, status, started_at, started_by, submitted_at, submitted_by, abandoned_reason")
    .eq("id", submissionId).eq("workspace_id", workspaceId).maybeSingle();
  if (isMissingTable(error))
    return { ...empty, state: "absent", detail: `Migration "${FORM_MIGRATION}" has not been applied.` };
  if (error) return { ...empty, state: "failed", detail: error.message };
  if (!sub) return { ...empty, state: "not_found", detail: null };

  const { data: doc } = await admin.from(FORM_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", sub.form_id).eq("workspace_id", workspaceId).maybeSingle();

  const { data: fields, error: fErr } = await admin.from(FORM_FIELD_TABLE)
    .select(FIELD_COLUMNS).eq("form_id", sub.form_id).eq("workspace_id", workspaceId).order("position");
  if (fErr || fields == null)
    return { ...empty, state: "failed", detail: fErr?.message ?? "the form's questions came back as neither rows nor an error" };

  const { data: answers, error: aErr } = await admin.from(FORM_ANSWER_TABLE)
    .select("field_id, value, answered_at, answered_by")
    .eq("submission_id", submissionId).eq("workspace_id", workspaceId);
  if (aErr || answers == null)
    return { ...empty, state: "failed", detail: aErr?.message ?? "the answers came back as neither rows nor an error" };

  const rows = fields as FormFieldRow[];
  const given = answers as FormAnswerRow[];
  const { rendered } = renderForm(rows, given);

  const people = [...new Set([sub.started_by, sub.submitted_by].filter(Boolean))];
  const { data: profiles } = people.length
    ? await admin.from("profiles").select("id, full_name").in("id", people) : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  return {
    state: "ok", detail: null,
    submission: {
      ...sub,
      stateLabel: formSubmissionState(sub.status)?.label ?? sub.status,
      startedByName: sub.started_by ? nameOf.get(sub.started_by) ?? null : null,
      submittedByName: sub.submitted_by ? nameOf.get(sub.submitted_by) ?? null : null,
      open: sub.status === "in_progress",
    },
    form: doc ? { ...doc, kindLabel: formTypeLabel(doc.form_type) } : null,
    fields: rows, answers: given, rendered,
    completeness: submissionCompleteness(rows, given),
    notVerified: FORM_NOT_VERIFIED,
  };
}

// ── WRITES: THE FORM ────────────────────────────────────────────────────────────────────────────────

const cleanTags = (tags: unknown): string[] => {
  const list = Array.isArray(tags) ? tags : [];
  return [...new Set(list.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
};

export async function createForm(admin: any, args: {
  workspaceId: string; code: string; title: string; kind: string; subject?: string;
  purpose?: string | null; specialty?: string | null; tags?: unknown; ownerId?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim();
  const title = args.title.trim();
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "give it a reference somebody can quote, like CONS-01" };
  if (!title) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the form needs a title" };
  // ⚠ CHECKED HERE TOO, because the CHECK constraint's refusal names a column and this names the thirteen
  // and says where the fourteenth lives. The constraint is still the rule.
  if (!FORM_TYPE_CODES.includes(args.kind))
    return {
      ok: false, status: 400, code: "UNKNOWN_KIND",
      message: `a form is one of: ${FORM_TYPE_CODES.join(", ")}. ${args.kind === "registration" ? "A patient registration form is a different object in this product and lives in the practice's settings, not here." : ""}`.trim(),
    };
  const subject = args.subject ?? "none";
  if (!FORM_SUBJECT_CODES.includes(subject))
    return { ok: false, status: 400, code: "UNKNOWN_SUBJECT", message: `a form is about one of: ${FORM_SUBJECT_CODES.join(", ")}` };

  const { data, error } = await admin.from(FORM_TABLE).insert({
    workspace_id: args.workspaceId, code, title, form_type: args.kind, subject,
    purpose: args.purpose?.trim() || null, specialty: args.specialty?.trim() || null,
    tags: cleanTags(args.tags), owner_id: args.ownerId ?? args.actorId,
    status: "draft", version: 1, created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (isMissingTable(error)) return storeAbsent();
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  // ⚠ NO QUESTIONS ARE SEEDED. The questions ARE the content, and there is no correct starter set for a
  // consent form or an incident report -- inventing one would be this product suggesting what to ask.
  // HAS_FIELDS refuses publication of an empty one instead.
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_created",
    payload: { formId: data.id, code, kind: args.kind }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Edit a draft, including its whole question list.
 *
 * ⚠ ONLY A DRAFT. A published form has COMPLETED FORMS against it, and changing a question would
 * retrospectively change what somebody was asked.
 *
 * ⚠ THE QUESTION LIST IS REPLACED WHOLE, as delete-then-insert INSIDE the form rather than row by row.
 * Two positions cannot be swapped incrementally without transiently colliding on
 * ux_practice_form_field_position, and a partial reorder that half-failed would leave the questions in an
 * order nobody chose. The delete's error is NOT discarded -- if it fails nothing is inserted and the old
 * list stands, which is recoverable.
 */
export async function updateForm(admin: any, args: {
  workspaceId: string; formId: string;
  title?: string; purpose?: string | null; specialty?: string | null; tags?: unknown;
  ownerId?: string | null; subject?: string; effectiveFrom?: string | null; reviewOn?: string | null;
  fields?: { fieldKey: string; label: string; section?: string | null; help?: string | null;
             fieldType?: string; required?: boolean; options?: unknown; rules?: unknown; condition?: unknown }[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ updated: true; fieldsWritten: number | null }>> {
  const { data: doc, error: rErr } = await admin.from(FORM_TABLE)
    .select("id, status, code").eq("id", args.formId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!FORM_STATES_EDITABLE.includes(doc.status))
    return {
      ok: false, status: 422, code: "NOT_EDITABLE",
      message: `this form is ${formState(doc.status)?.label.toLowerCase() ?? doc.status} and cannot be edited. ${doc.status === "published" ? "Start a new version instead -- the one in use stays exactly as it was approved, and so does every form completed against it." : doc.status === "archived" ? "An archived form is a record of what the practice used to ask." : "Withdraw it from review first, or re-open it if it has been approved."}`,
    };

  const patch: Record<string, unknown> = { updated_at: nowIso(), updated_by: args.actorId };
  if (args.title !== undefined) {
    if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the form needs a title" };
    patch.title = args.title.trim();
  }
  if (args.purpose !== undefined) patch.purpose = args.purpose?.trim() || null;
  if (args.specialty !== undefined) patch.specialty = args.specialty?.trim() || null;
  if (args.tags !== undefined) patch.tags = cleanTags(args.tags);
  if (args.ownerId !== undefined) patch.owner_id = args.ownerId || null;
  if (args.effectiveFrom !== undefined) patch.effective_from = args.effectiveFrom || null;
  if (args.reviewOn !== undefined) patch.review_on = args.reviewOn || null;
  if (args.subject !== undefined) {
    if (!FORM_SUBJECT_CODES.includes(args.subject))
      return { ok: false, status: 400, code: "UNKNOWN_SUBJECT", message: `a form is about one of: ${FORM_SUBJECT_CODES.join(", ")}` };
    patch.subject = args.subject;
  }

  const { error } = await admin.from(FORM_TABLE).update(patch)
    .eq("id", doc.id).eq("workspace_id", args.workspaceId);
  if (error) {
    if (isCheckViolation(error) && /review_after_effect/.test(String(error.message)))
      return { ok: false, status: 422, code: "REVIEW_BEFORE_EFFECT", message: `the review date has to be after the effective date -- the database refuses it (${FORM_CONSTRAINTS.reviewAfterEffect}), because a form whose review has already passed on the day it starts is born overdue` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  if (args.fields === undefined)
    return { ok: true, data: { updated: true, fieldsWritten: null } };

  const seen = new Set<string>();
  const rows = args.fields.map((f, i) => ({
    workspace_id: args.workspaceId, form_id: doc.id,
    field_key: String(f.fieldKey ?? "").trim(), position: i + 1,
    label: String(f.label ?? "").trim(),
    section: f.section?.trim() || null,
    help: f.help?.trim() || null,
    field_type: String(f.fieldType ?? "text"),
    required: f.required !== false,
    options: Array.isArray(f.options) ? f.options : [],
    rules: f.rules ?? null,
    condition: f.condition ?? null,
  }));
  for (const r of rows) {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(r.field_key))
      return { ok: false, status: 400, code: "BAD_FIELD_KEY", message: `"${r.field_key}" is not a usable question name. It has to start with a letter and hold only lower-case letters, digits and underscores -- because a condition and a calculation point at it by this name.` };
    if (seen.has(r.field_key))
      return { ok: false, status: 400, code: "DUPLICATE_FIELD_KEY", message: `two questions are both called "${r.field_key}". A condition naming it could not say which one it meant.` };
    seen.add(r.field_key);
    if (!r.label) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `the question "${r.field_key}" has no words on it` };
    // ⚠ REFUSED HERE AS WELL AS BY THE CHECK CONSTRAINT, because the constraint's message names a column
    // and this names the eleven types.
    if (!PRACTICE_FIELD_TYPE_CODES.includes(r.field_type))
      return { ok: false, status: 400, code: "UNKNOWN_FIELD_TYPE", message: `"${r.field_type}" is not a kind of question this build can store. The kinds that exist are: ${PRACTICE_FIELD_TYPE_CODES.join(", ")}.` };
  }

  // ⚠ SCOPED IN THE STATEMENT ITSELF -- workspace AND parent -- rather than trusted from the prior read,
  // and the error is NOT discarded.
  const { error: dErr } = await admin.from(FORM_FIELD_TABLE).delete()
    .eq("form_id", doc.id).eq("workspace_id", args.workspaceId);
  if (dErr) return { ok: false, status: 400, code: "FIELDS_NOT_REPLACED", message: `the existing questions could not be cleared, so nothing was changed about the form: ${dErr.message}` };

  if (rows.length) {
    const { error: iErr } = await admin.from(FORM_FIELD_TABLE).insert(rows);
    if (iErr) {
      if (isUniqueViolation(iErr))
        return { ok: false, status: 409, code: "FIELD_COLLISION", message: `two questions claim the same name or the same place on the form -- the database refuses it (${FORM_CONSTRAINTS.fieldKey} / ${FORM_CONSTRAINTS.fieldPosition})` };
      return { ok: false, status: 400, code: "FIELDS_NOT_WRITTEN", message: `the questions could not be written, and the form is now empty. Put them in again: ${iErr.message}` };
    }
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_updated",
    payload: { formId: doc.id, fields: rows.length }, correlationId: args.correlationId,
  });
  return { ok: true, data: { updated: true, fieldsWritten: rows.length } };
}

/** draft -> in_review, creating the approval request. */
export async function submitFormForApproval(admin: any, args: {
  workspaceId: string; formId: string; assignedTo?: string | null; urgency?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ approvalId: string }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.formId, "in_review");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  const { data: fields } = await admin.from(FORM_FIELD_TABLE)
    .select(FIELD_COLUMNS).eq("form_id", doc.id).eq("workspace_id", args.workspaceId).order("position");
  const list = (fields ?? []) as FormFieldRow[];
  if (list.length === 0)
    return { ok: false, status: 422, code: "NO_FIELDS", message: "there is nothing to answer on this form yet. A form with no questions is a title, and sending one for approval spends the one scarce thing in this loop, which is a colleague's attention." };

  // The blockers a colleague cannot be expected to catch by reading. A condition naming a question that
  // is not there hides its question silently, and no reviewer would ever see it.
  // ⚠ EACH REFUSAL CARRIES ITS OWN CODE, spelled out rather than derived from the check's name. A code
  // computed by string surgery is one a harness cannot be sure it asserted, and the three failures are
  // genuinely different things a caller may want to tell apart.
  const readiness = formReadiness(doc, list, null);
  const AT_SUBMIT: { check: string; code: string }[] = [
    { check: "CONDITIONS_RESOLVE", code: "CONDITIONS_BROKEN" },
    { check: "CALCULATIONS_RESOLVE", code: "CALCULATIONS_BROKEN" },
    { check: "RULES_COHERENT", code: "RULES_BROKEN" },
  ];
  for (const { check, code } of AT_SUBMIT) {
    const broken = readiness.checks.find(c => c.code === check);
    if (broken?.state === "fail")
      return { ok: false, status: 422, code, message: broken.detail };
  }

  const approval = await requestApproval(admin, {
    workspaceId: args.workspaceId,
    // ⚠ 'other' IS ALREADY IN MIGRATION 208's CHECK, which is why this phase needs no approval migration.
    subjectKind: "other", subjectId: doc.id, area: "form",
    summary: `${formTypeLabel(doc.form_type)} ${doc.code}: ${doc.title}`.slice(0, 300),
    urgency: args.urgency === "urgent" ? "urgent" : "routine",
    assignedTo: args.assignedTo ?? null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!approval.ok) return approval;

  const { error } = await admin.from(FORM_TABLE)
    .update({ status: "in_review", approval_request_id: approval.data.id, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "draft");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_sent_for_approval",
    payload: { formId: doc.id, approvalId: approval.data.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { approvalId: approval.data.id } };
}

/**
 * Bring the form into line with the decision on its approval request.
 *
 * ⚠ THIS ENGINE DOES NOT DECIDE. delegation.ts's decideApproval() owns the decision, including its
 * refusal to let anybody approve their own work and its refusal of a rejection without words.
 */
export async function syncFormApproval(admin: any, args: {
  workspaceId: string; formId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; changed: boolean }>> {
  const { data: doc, error: rErr } = await admin.from(FORM_TABLE)
    .select("id, status, approval_request_id").eq("id", args.formId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (doc.status !== "in_review")
    return { ok: false, status: 422, code: "NOT_IN_REVIEW", message: `only a form in review follows its approval; this one is ${formState(doc.status)?.label.toLowerCase() ?? doc.status}` };
  if (!doc.approval_request_id)
    return { ok: false, status: 422, code: "NO_APPROVAL", message: "this form is in review with no approval request behind it" };

  const { data: a } = await admin.from("practice_approval_request")
    .select("id, status, decision_note").eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!a) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (a.status === "PENDING") return { ok: true, data: { status: "in_review", changed: false } };

  // APPROVED -> approved. REJECTED or WITHDRAWN -> back to draft, and the approval link goes with it: a
  // rejected request left attached would satisfy the published-row constraint on a later attempt.
  const next = a.status === "APPROVED" ? "approved" : "draft";
  const { error } = await admin.from(FORM_TABLE).update({
    status: next,
    approval_request_id: next === "approved" ? doc.approval_request_id : null,
    updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "in_review");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.form_${next}`,
    payload: { formId: doc.id, approvalStatus: a.status }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: next, changed: true } };
}

/** in_review -> draft, or approved -> draft. The pending request goes with it. */
export async function withdrawFormFromReview(admin: any, args: {
  workspaceId: string; formId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.formId, "draft");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  if (doc.approval_request_id)
    await admin.from("practice_approval_request")
      .update({ status: "WITHDRAWN", decided_at: nowIso(), decision_note: "the author took the form back for further work" })
      .eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).eq("status", "PENDING");

  const { error } = await admin.from(FORM_TABLE)
    .update({ status: "draft", approval_request_id: null, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", doc.status);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: doc.status === "approved" ? "practice.form_reopened" : "practice.form_withdrawn_from_review",
    payload: { formId: doc.id, from: doc.status }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "draft" } };
}

/**
 * approved -> published.
 *
 * ⚠ THE PREDECESSOR IS WITHDRAWN FIRST, AND THE ORDER IS THE WHOLE POINT.
 * `ux_practice_form_published_code` allows exactly one published row per reference, so publishing before
 * withdrawing is refused by the database. Nothing here pre-checks the code -- the index is the rule, and
 * a unique violation comes back as CODE_IN_USE with the index named.
 */
export async function publishForm(admin: any, args: {
  workspaceId: string; formId: string; effectiveFrom?: string | null; reviewOn?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; superseded: string | null }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.formId, "published");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  const effective = args.effectiveFrom ?? doc.effective_from ?? null;
  const review = args.reviewOn ?? doc.review_on ?? null;

  const { data: fields } = await admin.from(FORM_FIELD_TABLE)
    .select(FIELD_COLUMNS).eq("form_id", doc.id).eq("workspace_id", args.workspaceId).order("position");
  const list = (fields ?? []) as FormFieldRow[];

  const { data: approval } = doc.approval_request_id
    ? await admin.from("practice_approval_request").select("id, status")
      .eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).maybeSingle()
    : { data: null };

  // The engine-owned blockers, in front of the constraints rather than instead of them.
  const readiness = formReadiness(doc, list, approval ?? null);
  const blocking = readiness.checks.filter(c => c.state === "fail" && c.severity === "blocker" && c.authority === "engine");
  if (blocking.length)
    return { ok: false, status: 422, code: blocking[0].code, message: blocking.map(c => c.detail).join(" ") };

  // Withdraw the predecessor FIRST. If this fails, publishing is not attempted.
  let superseded: string | null = null;
  if (doc.supersedes_id) {
    const { data: prev } = await admin.from(FORM_TABLE)
      .select("id, status, version").eq("id", doc.supersedes_id).eq("workspace_id", args.workspaceId).maybeSingle();
    if (prev && prev.status === "published") {
      const { error: aErr } = await admin.from(FORM_TABLE).update({
        status: "archived", archived_at: nowIso(),
        archived_reason: `superseded by version ${doc.version}`,
        updated_at: nowIso(), updated_by: args.actorId,
      }).eq("id", prev.id).eq("workspace_id", args.workspaceId).eq("status", "published");
      if (aErr) return { ok: false, status: 400, code: "PREDECESSOR_NOT_WITHDRAWN", message: `the version this replaces could not be withdrawn, so nothing was published: ${aErr.message}` };
      superseded = prev.id;
    }
  }

  const { error } = await admin.from(FORM_TABLE).update({
    status: "published", effective_from: effective, review_on: review,
    published_at: nowIso(), published_by: args.actorId, updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "approved");

  if (error) {
    if (isUniqueViolation(error))
      return {
        ok: false, status: 409, code: "CODE_IN_USE",
        message: `another form is already in use under "${doc.code}". The database refuses it (${FORM_CONSTRAINTS.publishedCode}): one reference, one form in use. Withdraw the one in use first.`,
      };
    if (isCheckViolation(error) && /in_force/.test(String(error.message)))
      return {
        ok: false, status: 422, code: "NOT_IN_FORCE_READY",
        message: `a form in use needs an effective date and an approval on the record. The database refuses it (${FORM_CONSTRAINTS.inForce}).`,
      };
    if (isCheckViolation(error) && /review_after_effect/.test(String(error.message)))
      return { ok: false, status: 422, code: "REVIEW_BEFORE_EFFECT", message: `the review date has to be after the effective date (${FORM_CONSTRAINTS.reviewAfterEffect})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_published",
    payload: { formId: doc.id, code: doc.code, version: doc.version, superseded },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "published", superseded } };
}

export async function archiveForm(admin: any, args: {
  workspaceId: string; formId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; openSubmissions: number }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.formId, "archived");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  const reason = (args.reason ?? "").trim();
  // ⚠ THE TWO REFUSALS CARRY DIFFERENT CODES ON PURPOSE. REASON_REQUIRED is this one and
  // REASON_REQUIRED_BY_DATABASE names the constraint, so a harness can tell which layer refused. They
  // were the same code in Phase 1 until a run proved that could not distinguish them: deleting the guard
  // merely handed the same refusal, under the same name, to the layer below and the assertion stayed
  // green. That is the exact shape of the vacuous assertions this codebase keeps finding.
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this is being withdrawn. The next person needs to tell \"superseded\" from \"found to be wrong\"." };

  // ⚠ FORMS PART-WAY THROUGH ARE COUNTED AND REPORTED, NOT CLOSED. Somebody is half-way through a consent
  // conversation on the version being withdrawn. Submitting their form for them would put a completed form
  // in the register that nobody made, and refusing the withdrawal would leave a form in use that the
  // practice has decided is wrong. So the withdrawal proceeds and the number comes back, as a fact the
  // caller has to show.
  const { data: open } = await admin.from(FORM_SUBMISSION_TABLE)
    .select("id").eq("form_id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "in_progress");
  const openSubmissions = ((open ?? []) as any[]).length;

  const { error } = await admin.from(FORM_TABLE).update({
    status: "archived", archived_at: nowIso(), archived_reason: reason,
    updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", doc.status);
  if (error) {
    if (isCheckViolation(error) && /archived_reason/.test(String(error.message)))
      return { ok: false, status: 422, code: "REASON_REQUIRED_BY_DATABASE", message: `the database refuses an archived form with no reason (${FORM_CONSTRAINTS.archivedReason})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_archived",
    payload: { formId: doc.id, from: doc.status, reason, openSubmissions }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "archived", openSubmissions } };
}

/**
 * Start the next version of something that is in use.
 *
 * A NEW ROW, NOT AN EDIT. The version in use stays exactly as it was approved -- and so does every form
 * completed against it.
 */
export async function reviseForm(admin: any, args: {
  workspaceId: string; formId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number }>> {
  const { data: doc, error: rErr } = await admin.from(FORM_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", args.formId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (doc.status !== "published")
    return { ok: false, status: 422, code: "NOT_PUBLISHED", message: `only a form in use has a next version; this one is ${formState(doc.status)?.label.toLowerCase() ?? doc.status}` };

  const { data: existing } = await admin.from(FORM_TABLE)
    .select("id, status, version").eq("workspace_id", args.workspaceId).eq("supersedes_id", doc.id)
    .neq("status", "archived").limit(1).maybeSingle();
  if (existing)
    return { ok: false, status: 409, code: "REVISION_OPEN", message: `version ${existing.version} of this form is already open (${formState(existing.status)?.label.toLowerCase() ?? existing.status}). Finish or abandon it first.` };

  const { data: created, error } = await admin.from(FORM_TABLE).insert({
    workspace_id: args.workspaceId, code: doc.code, title: doc.title, purpose: doc.purpose,
    form_type: doc.form_type, subject: doc.subject, specialty: doc.specialty,
    tags: doc.tags ?? [], owner_id: doc.owner_id,
    status: "draft", version: (doc.version ?? 1) + 1, supersedes_id: doc.id,
    // ⚠ THE APPROVAL IS NOT COPIED. A new version carries none of the old one's approval, because nobody
    // has read it. The dates are not copied either -- an effective date is about this version.
    approval_request_id: null, effective_from: null, review_on: null,
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id, version").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const { data: fields } = await admin.from(FORM_FIELD_TABLE)
    .select("field_key, section, position, label, help, field_type, required, options, rules, condition")
    .eq("form_id", doc.id).eq("workspace_id", args.workspaceId).order("position");
  const rows = ((fields ?? []) as any[]).map(s => ({
    workspace_id: args.workspaceId, form_id: created.id, field_key: s.field_key,
    section: s.section, position: s.position, label: s.label, help: s.help,
    field_type: s.field_type, required: s.required, options: s.options ?? [],
    rules: s.rules, condition: s.condition,
  }));

  if (rows.length) {
    const { error: iErr } = await admin.from(FORM_FIELD_TABLE).insert(rows);
    if (iErr) {
      // ⚠ NOT DISCARDED. A new version with no questions is worse than no new version -- somebody would
      // open it, see nothing, and believe the practice had deleted its form.
      await admin.from(FORM_TABLE).delete().eq("id", created.id).eq("workspace_id", args.workspaceId);
      return { ok: false, status: 400, code: "FIELDS_NOT_COPIED", message: `the new version's questions could not be created, so nothing was kept: ${iErr.message}` };
    }
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_revised",
    payload: { formId: created.id, supersedes: doc.id, version: created.version },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: created.id as string, version: created.version as number } };
}

// ── WRITES: THE COMPLETED FORM ──────────────────────────────────────────────────────────────────────

/**
 * Start filling one in.
 *
 * ⚠ ONLY AGAINST A FORM IN USE. A draft being filled in for real is the same class of error as a ward
 * following a draft protocol, and the completed form would name a version that changed the next morning.
 *
 * ⚠ AND THE SUBJECT HAS TO MATCH WHAT THE FORM DECLARED, in both directions.
 */
export async function startFormSubmission(admin: any, args: {
  workspaceId: string; formId: string; patientId?: string | null; contextNote?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number }>> {
  const { data: doc, error } = await admin.from(FORM_TABLE)
    .select("id, status, version, subject, code, title").eq("id", args.formId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (!FORM_STATES_USABLE.includes(doc.status))
    return {
      ok: false, status: 422, code: "NOT_IN_USE",
      message: `this form is ${formState(doc.status)?.label.toLowerCase() ?? doc.status} and cannot be filled in. ${doc.status === "draft" ? "A draft can still change, so answers given against it would be answers to questions that no longer exist." : "Only the version in use can be completed."}`,
    };

  const patientId = args.patientId?.trim() || null;
  if (doc.subject === "patient" && !patientId)
    return { ok: false, status: 422, code: "PATIENT_REQUIRED", message: "this form is about one patient, so a completed one has to name them. A consent form with nobody on it is one nobody can use." };
  if (doc.subject === "none" && patientId)
    return { ok: false, status: 422, code: "PATIENT_NOT_ALLOWED", message: "this form is not about a patient, so no patient may be recorded on it. Naming one would put a room or a machine in somebody's file." };

  const { data: fields } = await admin.from(FORM_FIELD_TABLE)
    .select("id").eq("form_id", doc.id).eq("workspace_id", args.workspaceId).limit(1);
  if (((fields ?? []) as any[]).length === 0)
    return { ok: false, status: 422, code: "NO_FIELDS", message: "this form has nothing on it to answer" };

  const { data: sub, error: insErr } = await admin.from(FORM_SUBMISSION_TABLE).insert({
    workspace_id: args.workspaceId, form_id: doc.id, form_version: doc.version,
    patient_id: patientId, context_note: args.contextNote?.trim() || null,
    status: "in_progress", started_by: args.actorId,
  }).select("id, form_version").single();
  if (insErr) {
    if (isMissingTable(insErr)) return storeAbsent();
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: insErr.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_submission_started",
    payload: { submissionId: sub.id, formId: doc.id, version: doc.version, patientId },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: sub.id as string, version: sub.form_version as number } };
}

export type RecordedAnswers = {
  written: number;
  /** ⚠ Answers deleted because their question no longer applies. A LIST of labels, said on screen. */
  cleared: string[];
  completeness: SubmissionCompleteness;
};

/**
 * Record answers.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ THIS IS THE ONE WRITE PATH, AND IT IS WHERE A WITHDRAWN QUESTION'S ANSWER IS THROWN AWAY.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The registration fix found the real hazard and it is identical here. A hidden question that KEEPS its
 * answer makes the screen and the server disagree, and then:
 *
 *   - the completed form holds an answer to a question the screen withdrew, and the printed copy shows it
 *     beside a question the person filling it in never saw;
 *   - and submissionCompleteness evaluates conditions against the answers it HAS. It would see the stale
 *     answer, decide the dependent question applies, find it unanswered, and refuse to submit over a
 *     question that is not on the screen. That was the exact live defect on the registration form.
 *
 * So: the incoming answers are merged with the ones already stored, the WHOLE set is resolved once, and
 * every stored answer whose question no longer applies is DELETED. Resolved against what is in the
 * database rather than against what the client sent, because the client is a claim and the store is the
 * record.
 *
 * ⚠ AND THE PAYLOAD IS A POSITIVE WHITELIST. An answer for a question that does not apply is not written
 * at all, rather than written and then cleaned up.
 *
 * ⚠ AN ANSWER IS STORED AS validateAnswer NORMALISED IT, never as it arrived. "12" from an HTML input is
 * stored as the number 12, or `sum` would be adding writing to writing and a later range query would
 * compare "9" against "10" alphabetically.
 */
export async function recordAnswers(admin: any, args: {
  workspaceId: string; submissionId: string;
  answers: { fieldKey: string; value: unknown }[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<RecordedAnswers>> {
  const loaded = await loadOpenSubmission(admin, args.workspaceId, args.submissionId);
  if (!loaded.ok) return loaded;
  const { submission, fields, existing } = loaded.data;

  const byKey = new Map(fields.map(f => [f.field_key, f]));

  // 1. Validate every incoming answer before anything is written.
  const incoming: { field: FormFieldRow; value: unknown; clear: boolean }[] = [];
  for (const a of args.answers ?? []) {
    const field = byKey.get(String(a.fieldKey ?? ""));
    if (!field)
      return { ok: false, status: 400, code: "UNKNOWN_FIELD", message: `"${a.fieldKey}" is not a question on this form` };

    // ⚠ AN EMPTY ANSWER IS A DELIBERATE ERASURE, NOT A VALIDATION FAILURE. Somebody clearing a box they
    // filled in by mistake must be able to. Whether the form can then be SUBMITTED is a different
    // question and submissionCompleteness answers it -- refusing the erasure here would leave a wrong
    // answer in the record because the person could not take it out.
    if (isBlankAnswer(a.value)) { incoming.push({ field, value: null, clear: true }); continue; }

    const check = validateAnswer(field, a.value);
    if (!check.ok) return { ok: false, status: 422, code: check.code, message: check.message };
    incoming.push({ field, value: check.value, clear: false });
  }

  // 2. Resolve the WHOLE picture -- stored plus incoming -- through the one shared evaluator.
  const merged = new Map(existing.map(r => [r.field_id, { field_id: r.field_id, value: r.value }]));
  for (const inc of incoming) {
    if (inc.clear) merged.delete(inc.field.id);
    else merged.set(inc.field.id, { field_id: inc.field.id, value: inc.value });
  }
  const mergedRows = [...merged.values()];
  const { applicable } = applicableFields(fields, answerMap(fields, mergedRows));
  const applicableKeys = new Set(applicable.map(f => f.field_key));

  // 3. Write only what applies. THE WHITELIST, and it is positive rather than a filter of exclusions.
  let written = 0;
  for (const inc of incoming) {
    if (inc.clear) continue;
    if (!applicableKeys.has(inc.field.field_key)) continue;
    const already = existing.find(r => r.field_id === inc.field.id);
    // ⚠ NOT .upsert(). An explicit update-or-insert, scoped in the statement, with the error kept.
    const { error } = already
      ? await admin.from(FORM_ANSWER_TABLE)
        .update({ value: inc.value, answered_at: nowIso(), answered_by: args.actorId })
        .eq("submission_id", submission.id).eq("field_id", inc.field.id).eq("workspace_id", args.workspaceId)
      : await admin.from(FORM_ANSWER_TABLE).insert({
        workspace_id: args.workspaceId, submission_id: submission.id, field_id: inc.field.id,
        value: inc.value, answered_at: nowIso(), answered_by: args.actorId,
      });
    if (error) {
      if (isCheckViolation(error) && /answer_not_empty/.test(String(error.message)))
        return { ok: false, status: 422, code: "ANSWER_EMPTY_BY_DATABASE", message: `the database refuses an answer of nothing (${FORM_CONSTRAINTS.answerNotEmpty})` };
      return { ok: false, status: 400, code: "ANSWER_NOT_RECORDED", message: `"${inc.field.label}" could not be recorded, so do not assume it was: ${error.message}` };
    }
    written++;
  }

  // 4. Delete the answers whose questions no longer apply, and the ones deliberately erased. ⚠ AND THE
  // DELETE'S ERROR IS NOT DISCARDED -- a stale answer left behind is exactly the state that makes the
  // screen and the server disagree.
  const cleared: string[] = [];
  const erasedIds = new Set(incoming.filter(i => i.clear).map(i => i.field.id));
  for (const r of existing) {
    const field = fields.find(f => f.id === r.field_id);
    const withdrawn = !field || !applicableKeys.has(field.field_key);
    if (!withdrawn && !erasedIds.has(r.field_id)) continue;
    const { error } = await admin.from(FORM_ANSWER_TABLE).delete()
      .eq("submission_id", submission.id).eq("field_id", r.field_id).eq("workspace_id", args.workspaceId);
    if (error)
      return { ok: false, status: 400, code: "STALE_ANSWER_NOT_CLEARED", message: `an answer that no longer applies could not be removed, and leaving it would make this record say something nobody was asked: ${error.message}` };
    // ⚠ ONLY A WITHDRAWAL IS REPORTED AS CLEARED. Somebody who emptied a box themselves does not need to
    // be told their answer was removed -- saying so would be a false sentence about who did it.
    if (withdrawn) cleared.push(field?.label ?? r.field_id);
  }

  const { data: after } = await admin.from(FORM_ANSWER_TABLE)
    .select("field_id, value, answered_at, answered_by")
    .eq("submission_id", submission.id).eq("workspace_id", args.workspaceId);
  const finalRows = ((after ?? []) as FormAnswerRow[]);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_answers_recorded",
    payload: { submissionId: submission.id, written, cleared: cleared.length }, correlationId: args.correlationId,
  });
  return { ok: true, data: { written, cleared, completeness: submissionCompleteness(fields, finalRows) } };
}

/**
 * Submit it.
 *
 * ⚠ SUBMITTING IS NOT SIGNING. It records that a named person closed the form at a recorded time. Nothing
 * here captured a mark and nothing re-checked who was at the keyboard, and the completed form says so on
 * screen and on paper.
 */
export async function submitFormSubmission(admin: any, args: {
  workspaceId: string; submissionId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; answered: number; applicable: number; incompleteTotals: string[] }>> {
  const loaded = await loadOpenSubmission(admin, args.workspaceId, args.submissionId);
  if (!loaded.ok) return loaded;
  const { submission, fields, existing } = loaded.data;

  const completeness = submissionCompleteness(fields, existing);
  if (completeness.outstanding.length)
    return {
      ok: false, status: 422, code: "ANSWERS_OUTSTANDING",
      message: `these questions still need an answer before this can be submitted: ${completeness.outstanding.map(f => f.label).join(", ")}.`,
    };
  if (completeness.invalid.length)
    return {
      ok: false, status: 422, code: "ANSWERS_INVALID",
      message: `these answers no longer satisfy their own question: ${completeness.invalid.map(i => i.message).join(" ")}`,
    };

  const { error } = await admin.from(FORM_SUBMISSION_TABLE).update({
    status: "submitted", submitted_at: nowIso(), submitted_by: args.actorId,
  }).eq("id", submission.id).eq("workspace_id", args.workspaceId).eq("status", "in_progress");
  if (error) {
    if (isCheckViolation(error) && /submission_submitted/.test(String(error.message)))
      return { ok: false, status: 422, code: "SUBMISSION_TIME_MISSING", message: `the database refuses a submitted form with no time on it (${FORM_CONSTRAINTS.submissionSubmitted})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  // ⚠ A TOTAL THAT COULD NOT USE ALL OF ITS INPUTS IS NAMED ON THE AUDIT TRAIL, because a figure quoted
  // from a completed form later is the thing somebody comes looking for, and a count would not say which.
  const incompleteTotals = completeness.calculated.filter(c => !c.complete || c.problem).map(c => c.field_key);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_submitted",
    payload: {
      submissionId: submission.id, formId: submission.form_id,
      answered: completeness.answered, applicable: completeness.applicable, incompleteTotals,
    },
    correlationId: args.correlationId,
  });
  return {
    ok: true,
    data: {
      status: "submitted", answered: completeness.answered,
      applicable: completeness.applicable, incompleteTotals,
    },
  };
}

/** Started and left. Kept with a reason, never deleted -- a form begun and abandoned is a fact. */
export async function abandonFormSubmission(admin: any, args: {
  workspaceId: string; submissionId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const loaded = await loadOpenSubmission(admin, args.workspaceId, args.submissionId);
  if (!loaded.ok) return loaded;
  const { submission } = loaded.data;

  const reason = (args.reason ?? "").trim();
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this was not finished. A record that stops half way with no word about why tells the next person nothing." };

  const { error } = await admin.from(FORM_SUBMISSION_TABLE).update({
    status: "abandoned", abandoned_reason: reason,
  }).eq("id", submission.id).eq("workspace_id", args.workspaceId).eq("status", "in_progress");
  if (error) {
    if (isCheckViolation(error) && /abandoned_reason/.test(String(error.message)))
      return { ok: false, status: 422, code: "REASON_REQUIRED_BY_DATABASE", message: `the database refuses an abandoned form with no reason (${FORM_CONSTRAINTS.submissionAbandonedReason})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.form_submission_abandoned",
    payload: { submissionId: submission.id, reason }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "abandoned" } };
}

// ── SHARED ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Load a form and refuse the move by NAME if it is not one that exists.
 *
 * ⚠ REFUSED BY NAME, NOT BY FALLING THROUGH. A transition that quietly does nothing is how somebody comes
 * to believe a form is in use when it is not.
 */
async function loadForMove(admin: any, workspaceId: string, formId: string, to: string): Promise<
  { ok: true; data: any } | { ok: false; status: number; code: string; message: string }
> {
  const { data: doc, error } = await admin.from(FORM_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", formId).eq("workspace_id", workspaceId).maybeSingle();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (!formCanMove(doc.status, to)) {
    const from = formState(doc.status)?.label.toLowerCase() ?? doc.status;
    const target = formState(to)?.label.toLowerCase() ?? to;
    // "a approved form" is what this said before a harness run put it on screen. A refusal a practitioner
    // reads has to be written in English.
    const article = /^[aeiou]/.test(from) ? "an" : "a";
    return {
      ok: false, status: 422, code: "MOVE_NOT_ALLOWED",
      message: `${article} ${from} form cannot become ${target}. From ${from}, the moves that exist are: ${
        formMovesFrom(doc.status).map(t => t.label).join(", ") || "none -- this is where a form's life ends"
      }.`,
    };
  }
  return { ok: true, data: doc };
}

/** A submission that is still open, with its questions and everything already answered. */
async function loadOpenSubmission(admin: any, workspaceId: string, submissionId: string): Promise<
  { ok: true; data: { submission: any; fields: FormFieldRow[]; existing: FormAnswerRow[] } }
  | { ok: false; status: number; code: string; message: string }
> {
  const { data: submission, error } = await admin.from(FORM_SUBMISSION_TABLE)
    .select("id, form_id, form_version, status, patient_id")
    .eq("id", submissionId).eq("workspace_id", workspaceId).maybeSingle();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!submission) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (submission.status !== "in_progress")
    return {
      ok: false, status: 422, code: "SUBMISSION_CLOSED",
      message: `this ${formSubmissionState(submission.status)?.label.toLowerCase() ?? submission.status} form cannot be changed. What was recorded at the time is what it says, and altering it afterwards would make it a record of something else.`,
    };

  const { data: fields, error: fErr } = await admin.from(FORM_FIELD_TABLE)
    .select(FIELD_COLUMNS).eq("form_id", submission.form_id).eq("workspace_id", workspaceId).order("position");
  // ⚠ A FAILED QUESTION READ IS NOT AN EMPTY FORM. Writing answers against a list that came back as
  // nothing would silently record against nothing at all.
  if (fErr || fields == null)
    return { ok: false, status: 503, code: "FIELDS_UNREADABLE", message: `the form's questions could not be read, so nothing was recorded: ${fErr?.message ?? "the questions came back as neither rows nor an error"}` };

  const { data: existing, error: eErr } = await admin.from(FORM_ANSWER_TABLE)
    .select("field_id, value, answered_at, answered_by")
    .eq("submission_id", submission.id).eq("workspace_id", workspaceId);
  if (eErr || existing == null)
    return { ok: false, status: 503, code: "ANSWERS_UNREADABLE", message: `what has already been answered could not be read, and recording over an unknown state is how an answer disappears: ${eErr?.message ?? "the answers came back as neither rows nor an error"}` };

  return {
    ok: true,
    data: { submission, fields: fields as FormFieldRow[], existing: existing as FormAnswerRow[] },
  };
}
