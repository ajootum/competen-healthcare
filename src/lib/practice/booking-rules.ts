import type { WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/audit";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { defaultAppointmentMinutes } from "@/lib/practice/configuration";
import { checkPlacement } from "@/lib/practice/scheduling";
import { loadTaxonomy, validateChoice, deriveBookingSource } from "@/lib/practice/taxonomy";
import { bookingBlock } from "@/lib/practice/lifecycle-constants";
// CPR-V5-007 s8. A LEAF MODULE, so this import cannot become a cycle -- see patient-session.ts.
import { checkPatientSession } from "@/lib/practice/patient-session";
import {
  BOOKING_CHANNELS, BOOKING_CHANNEL_CODES, BOOKING_CHANNELS_WITH_A_DOOR, bookingChannel,
  RULE_STATUS_CODES, RULE_STATUSES_IN_FORCE,
  CONFIRMATION_MODE_CODES, PATIENT_ELIGIBILITY_CODES,
  specificityOf, specificityRung, specificityReasons, scopesCanOverlap, scopeDimensions,
  plainWindow, plainCapacity, PLATFORM_DEFAULT_RUNG,
  plainWalkIn, plainCancellation, plainRequiredInformation,
  BOOKING_INTAKE_FIELDS, requiredInformationOf, levelFor, resolveIntake,
  intakeRefusalMessage, intakeDiscardNotice,
  BOOKING_INTAKE_FIELD_KEYS, INTAKE_FIELDS_ALWAYS_REQUIRED,
  WALK_IN_QUEUE_POLICY_CODES, DNA_ACTION_CODES, WALK_IN_OVERRIDABLE_CODES, walkInCutoff,
  type ScopeShape, type RequiredInformation,
} from "@/lib/practice/booking-rule-constants";
// CPR-V5-007 s7.7. ⚠ No cycle: practice-sessions reaches 11 modules and this one is not among them,
// which scheduling.ts checked when it took the same import for the same reason -- the per-session
// walk-in limit and the cutoff have ONE resolver, shared with the screen that reports them.
import { walkInAllowance } from "@/lib/practice/practice-sessions";
import { onAppointmentCreated } from "./activation-hooks";
import { WEEKDAY_NAME } from "@/lib/practice/planner-constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 3 -- THE BOOKING RULES ENGINE. Migration 244.
//
// s19's Phase 3: "Rule cards, builder, hierarchy, conflict validation, simulation", exit condition
// "INTERNAL PRACTITIONER/STAFF BOOKING FOLLOWS RULES". So this file has two halves that must agree with
// each other: the half that AUTHORS a rule (s7.1's card, s7.2's builder, s11's conflict validation,
// migration 244's versioning) and the half that DECIDES A BOOKING with one (s11's ladder, s7.4's
// capacity, s7.5's follow-up window, s7.6's eligibility, s7.2's confirmation).
//
// ---- FIVE RULES THIS FILE EXISTS TO ENFORCE ---------------------------------------------------------
//
//   1. ⚠ AC-13: EVERY BOOKING STORES THE RULE ID AND THE VERSION THAT DECIDED IT. A booking made in
//      March under a rule edited in June must still be explicable in September; without the version,
//      "which rule allowed this?" is answered with a different rule wearing the same id. Both columns
//      are written in the SAME INSERT as the appointment -- a second UPDATE could fail and leave a
//      booking that lies about having been decided by nothing.
//
//   2. ⚠ s11: AT EQUAL SPECIFICITY AND EQUAL PRIORITY, ACTIVATION IS BLOCKED UNTIL RESOLVED. Not a coin
//      toss, not first-wins, not newest-wins. Enforced in BOTH directions: activating a rule that would
//      tie is refused with the other rule NAMED, and if two tied rules are somehow both active anyway
//      (they can be written straight into the table) evaluation REFUSES rather than picking one.
//
//   3. ⚠ EVALUATION IS SERVER-SIDE, AND NOTHING ABOUT A DECISION ARRIVES IN A REQUEST. The argument to
//      bookUnderRules is a description of the booking -- who, when, what, which channel -- and never a
//      rule id, a version or a verdict. Even the facts eligibility turns on (is this patient new, how
//      old are they, do they have a live follow-up) are READ HERE rather than accepted, because a fact
//      that arrives in a body is a fact somebody can edit.
//
//   4. ⚠ A FAILED READ IS NEVER A ZERO. If the rules cannot be read, a booking REFUSES; it does not fall
//      through to "no rule applies", which would turn a database blip into an open diary. The same for
//      the capacity count, the patient's history and the follow-up plan.
//
//   5. ⚠ AN OVERRIDE REQUIRES A REASON, IS WRITTEN BEFORE THE BOOKING, AND ITS WRITE IS CHECKED (s14,
//      AC-14). audit() swallows its own failure by design, which is right for a log and wrong for this:
//      an override nobody can find afterwards is an override that did not happen, so the record is
//      written here with its error read, and the booking is refused if it could not be recorded.
//
// ---- THE `active` FLAG, AND WHY IT MIRRORS `status` AGAIN (migration 245) ---------------------------
//
// ⚠ `status` IS THE AUTHORITY AND `active` IS ITS MIRROR: active === (status === 'active'). Nothing in
// this engine reads `active`; it is written so that the OTHER readers of this table agree with it.
//
// Phase 3 shipped with `active` forced to FALSE on every card rule, and it was a workaround. Migration
// 230's partial unique index -- ux_practice_booking_rule_scope, over (workspace_id, location_id,
// appointment_type) WHERE active -- knew of a scope with two parts, and migration 244 gave a rule three
// more: a session, a channel and a priority. Under the old key a Friday session rule and a Monday
// session rule at one hospital were a duplicate, and s11's "at equal specificity, explicit priority
// determines the winner" described a state the database forbade. Leaving `active` false kept the index
// satisfied, and the cost was stated on screen rather than hidden: availability-config.ts's
// resolveBookingRule -- the check the calendar's own quick-book runs -- filters on `active`, so the
// calendar could not see a single card rule.
//
// Migration 245 rekeyed that index on all five scope columns PLUS priority, still partial but now
// `where status = 'active'`. The workaround has no reason left, so it is gone and the calendar sees
// card rules again.
//
// ⚠ THE CONSEQUENCE, WHICH IS REAL: THE BOOKING WINDOW IS NOW CHECKED TWICE. checkPlacement() resolves
// its own rule through resolveBookingRule and re-checks the lead time and the horizon, and it has no
// concept of s14's override. bookUnderRules therefore tells it which window codes an authorised
// override has already lifted -- and only those, so that an override of the notice period can never
// become an override of the double-booking check. See the comment at the call site.
//
// ---- WHAT IS NOT HERE ------------------------------------------------------------------------------
//
//   Phase 4  s8's patient-facing SCREENS. The engines are here and in patient-booking.ts; what does not
//            exist is a wizard a stranger can use, which PATIENT_BOOKING_SCREENS_BUILT states.
//   Phase 6  s7.2's NOTIFICATIONS section, and it is not here on purpose rather than by omission.
//            Nothing in this product sends a message to a patient, so a trigger stored here would
//            promise a notification nobody would receive. The section is drawn as not built and says so.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// MIGRATIONS 268 AND 269 -- THE FOUR SECTIONS s7.2 NAMED AND THIS TABLE COULD NOT HOLD
//
// ⚠ TWO FILES RATHER THAN ONE, AND THE SPLIT IS DELIBERATE. Migration 108 was truncated on the way in
// and had to be re-run by hand. 268 is the one everything below depends on and it touches ONE table.
// 269 adds the two stores that only the cancellation and queue engines read, so a truncated 269 leaves
// the rule card fully working and reports the missing half rather than half-breaking the screen.
//
// ⚠ REQUIRED TEXT IS `btrim(x) <> ''`, NEVER `is not null`. Migration 256 shipped that mistake and 257
// was the correction. Every text check below is written the corrected way the first time.
//
// ⚠ NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT, INCLUDING INSIDE A COMMENT, and no `--` inside a
// string literal. The runner splits on semicolons and a comment stripper works line-wise -- one of each
// silently shredded two sections of migration 238 and truncated a literal in 264.
//
//   -- ============================================================
//   -- MIGRATION 268: BOOKING RULE -- REQUIRED INFORMATION, WALK-IN CUTOFF AND QUEUE, CANCELLATIONS
//   -- CPR-V5-007 s7.2, s7.7, s9
//   --
//   -- Additive columns on practice_booking_rule only. Nothing is dropped and nothing is backfilled:
//   -- every default below is the behaviour this product had before the column existed, so applying
//   -- this migration changes no decision anywhere until somebody configures something.
//   -- ============================================================
//
//   -- ---- 1. s7.2 REQUIRED INFORMATION (s9's intake) ---------------------------------------------
//   --
//   -- A JSONB COLUMN RATHER THAN A CHILD TABLE, AND THE REASON IS AC-13. The rule VERSION snapshot in
//   -- practice_booking_rule_version photographs COLUMNS. A child table would not be in the photograph,
//   -- so "which questions were required when this booking was made" would be answered with today's
//   -- answer -- which is the exact defect versioning exists to prevent.
//   --
//   -- The shape is { "fields": { "<field_key>": "off|optional|required" } }, or an object per field
//   -- carrying a condition. It is validated in requiredInformationOf(), which drops anything it does
//   -- not recognise rather than enforcing it. An EMPTY object means every question is accepted if given
//   -- and demanded of nobody, which is what this product did before this column existed.
//   alter table practice_booking_rule add column if not exists required_information jsonb not null default '{}'::jsonb;
//   alter table practice_booking_rule drop constraint if exists practice_booking_rule_required_info_object;
//   alter table practice_booking_rule add constraint practice_booking_rule_required_info_object
//     check (jsonb_typeof(required_information) = 'object');
//
//   -- ---- 2. s7.7 WALK-IN CUTOFF AND QUEUE POLICY ------------------------------------------------
//   --
//   -- ⚠ ON THE RULE, NOT ON THE SESSION, AND THAT IS A DEPARTURE FROM WHAT recall-constants.ts SAID
//   -- WOULD BE NEEDED. Its note proposed walk_in_cutoff_minutes on practice_availability_template. The
//   -- rule table is better and the reason is the ladder that already exists: a rule may name a session
//   -- (session_template_id), so a cutoff here can be per session, per location, per appointment type or
//   -- practice-wide, and s11 decides which one applies. On the template it could only ever be one of
//   -- those four. The note is corrected rather than followed.
//   --
//   -- NULL MEANS NO CUTOFF. The range starts at 1 rather than 0 because a cutoff of 0 minutes before the
//   -- end is a session with no cutoff, and two spellings of one answer is a question with two answers.
//   alter table practice_booking_rule add column if not exists walk_in_cutoff_minutes integer;
//   alter table practice_booking_rule drop constraint if exists practice_booking_rule_walk_in_cutoff_range;
//   alter table practice_booking_rule add constraint practice_booking_rule_walk_in_cutoff_range
//     check (walk_in_cutoff_minutes is null or walk_in_cutoff_minutes between 1 and 720);
//
//   -- 'first_come' is what happened before this column, so it is the default and applying this changes
//   -- no waiting room anywhere.
//   alter table practice_booking_rule add column if not exists walk_in_queue_policy text not null default 'first_come';
//   alter table practice_booking_rule drop constraint if exists practice_booking_rule_queue_policy_known;
//   alter table practice_booking_rule add constraint practice_booking_rule_queue_policy_known
//     check (walk_in_queue_policy in ('first_come', 'priority_then_first_come'));
//
//   -- ---- 3. s7.2 CANCELLATIONS ------------------------------------------------------------------
//   --
//   -- ⚠ THESE GOVERN A PATIENT'S OWN CANCELLATION AND NOTHING ELSE. A practice must always be able to
//   -- correct its own diary, so nothing here is ever consulted for a practitioner or staff cancellation.
//   -- TRUE by default: patient self-service was already permitted and this must not switch it off.
//   alter table practice_booking_rule add column if not exists self_cancel_allowed boolean not null default true;
//   alter table practice_booking_rule add column if not exists self_reschedule_allowed boolean not null default true;
//
//   -- NULL MEANS THE CANCELLATION NOTICE GOVERNS A MOVE TOO, which is what patient-booking.ts already
//   -- did and reported doing. A number here separates the two.
//   alter table practice_booking_rule add column if not exists reschedule_notice_minutes integer;
//   alter table practice_booking_rule drop constraint if exists practice_booking_rule_reschedule_notice_range;
//   alter table practice_booking_rule add constraint practice_booking_rule_reschedule_notice_range
//     check (reschedule_notice_minutes is null or reschedule_notice_minutes between 0 and 43200);
//
//   -- s7.2's DNA handling. NULL threshold means no rule, which is not the same as a threshold of 0 --
//   -- 0 would mean a single missed appointment counts, and somebody has to be able to write that.
//   alter table practice_booking_rule add column if not exists dna_threshold integer;
//   alter table practice_booking_rule drop constraint if exists practice_booking_rule_dna_threshold_range;
//   alter table practice_booking_rule add constraint practice_booking_rule_dna_threshold_range
//     check (dna_threshold is null or dna_threshold between 0 and 50);
//
//   alter table practice_booking_rule add column if not exists dna_action text not null default 'none';
//   alter table practice_booking_rule drop constraint if exists practice_booking_rule_dna_action_known;
//   alter table practice_booking_rule add constraint practice_booking_rule_dna_action_known
//     check (dna_action in ('none', 'require_approval', 'block_self_booking'));
//
//   -- A threshold with nothing to do, and an action with nothing to count, are both half a rule. Refused
//   -- here rather than left to a screen, because the halves are written on two different controls.
//   alter table practice_booking_rule drop constraint if exists practice_booking_rule_dna_pair;
//   alter table practice_booking_rule add constraint practice_booking_rule_dna_pair
//     check ((dna_action = 'none' and dna_threshold is null) or (dna_action <> 'none' and dna_threshold is not null));
//
//   alter table practice_booking_rule add column if not exists waiting_list_enabled boolean not null default false;
//
//   alter table practice_booking_rule enable row level security;
//
//   notify pgrst, 'reload schema';
//
//   -- ============================================================
//   -- MIGRATION 269: THE WAITING LIST, THE QUEUE PRIORITY AND WHAT A CANCELLATION RECORDS
//   -- CPR-V5-007 s7.2, s7.7
//   -- ============================================================
//
//   -- ---- 1. s7.7's QUEUE ORDERING ---------------------------------------------------------------
//   --
//   -- ⚠ ONE ORDERING, NOT TWO. Every queue read in this product orders by priority then arrival, and
//   -- under the default policy every row is 0, so that order IS arrival order and nothing changed. The
//   -- policy on the rule decides whether the desk may set a priority at all -- it never decides how a
//   -- queue is sorted, because two sort orders for one waiting room is two answers to one question.
//   alter table practice_queue_entry add column if not exists priority integer not null default 0;
//   alter table practice_queue_entry drop constraint if exists practice_queue_entry_priority_range;
//   alter table practice_queue_entry add constraint practice_queue_entry_priority_range
//     check (priority between 0 and 3);
//
//   -- ⚠ A QUEUE JUMP NOBODY EXPLAINED CANNOT BE ANSWERED FOR. Above routine, a reason is not optional,
//   -- and the check is btrim so the space bar does not satisfy it.
//   alter table practice_queue_entry add column if not exists priority_reason text;
//   alter table practice_queue_entry drop constraint if exists practice_queue_entry_priority_reason;
//   alter table practice_queue_entry add constraint practice_queue_entry_priority_reason
//     check ((priority = 0 and (priority_reason is null or btrim(priority_reason) <> ''))
//         or (priority > 0 and priority_reason is not null and btrim(priority_reason) <> ''
//             and char_length(priority_reason) <= 300));
//
//   create index if not exists idx_practice_queue_entry_order
//     on practice_queue_entry(workspace_id, priority desc, entered_at);
//
//   -- ---- 2. WHAT A CANCELLATION RECORDS ---------------------------------------------------------
//   --
//   -- practice_appointment has held a status and nothing else about a cancellation. "Who cancelled this
//   -- and why" was answerable only from the audit trail, which is a log and not a column a report can
//   -- group by. cancelManagedBooking already said out loud that a patient's reason had nowhere to go.
//   alter table practice_appointment add column if not exists cancellation_reason text;
//   alter table practice_appointment drop constraint if exists practice_appointment_cancellation_reason_len;
//   alter table practice_appointment add constraint practice_appointment_cancellation_reason_len
//     check (cancellation_reason is null or (btrim(cancellation_reason) <> '' and char_length(cancellation_reason) <= 500));
//
//   alter table practice_appointment add column if not exists cancelled_by_kind text;
//   alter table practice_appointment drop constraint if exists practice_appointment_cancelled_by_kind_known;
//   alter table practice_appointment add constraint practice_appointment_cancelled_by_kind_known
//     check (cancelled_by_kind is null or cancelled_by_kind in ('patient', 'practice'));
//
//   -- ⚠ THREE STATES AND NULL IS ONE OF THEM. True means inside the notice period, false means outside,
//   -- and null means this appointment was never cancelled OR was cancelled before this column existed.
//   alter table practice_appointment add column if not exists cancelled_within_notice boolean;
//   alter table practice_appointment add column if not exists cancelled_at timestamptz;
//
//   -- ---- 3. s7.2's WAITING LIST -----------------------------------------------------------------
//   --
//   -- ⚠ IT HOLDS NO SLOT AND RESERVES NOTHING, exactly as practice_booking_request holds no slot. An
//   -- offer is a record that somebody was told about a time, and the time stays bookable by anybody
//   -- until an appointment row takes it -- migration 255's exclusion constraint has the last word.
//   create table if not exists practice_waiting_list_entry (
//     id uuid primary key default gen_random_uuid(),
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//     location_id uuid references practice_location(id) on delete set null,
//     appointment_type text not null default 'new_consultation'
//       check (appointment_type in ('new_consultation', 'scheduled_followup', 'walk_in', 'emergency',
//                                  'hospital_consultation', 'teleconsultation', 'home_visit')),
//
//     -- Nullable, because somebody may be on a list before they are a patient record.
//     patient_id uuid references practice_patient(id) on delete set null,
//     patient_name text not null check (btrim(patient_name) <> '' and char_length(patient_name) <= 160),
//     contact_phone text check (contact_phone is null or (btrim(contact_phone) <> '' and char_length(contact_phone) <= 40)),
//     contact_email text check (contact_email is null or (btrim(contact_email) <> '' and char_length(contact_email) <= 160)),
//
//     -- The window they can actually be seen in. Both nullable: "any time" is a real answer.
//     earliest_date date,
//     latest_date date,
//     note text check (note is null or (btrim(note) <> '' and char_length(note) <= 500)),
//
//     status text not null default 'waiting'
//       check (status in ('waiting', 'offered', 'booked', 'withdrawn', 'expired')),
//     offered_at timestamptz,
//     offered_start timestamptz,
//     offer_note text check (offer_note is null or (btrim(offer_note) <> '' and char_length(offer_note) <= 500)),
//     appointment_id uuid references practice_appointment(id) on delete set null,
//
//     -- Who put them on it. 'patient' exists so the column can tell the truth the day a patient screen
//     -- can add to it. Nothing patient-facing writes this row today.
//     source text not null default 'practice' check (source in ('practice', 'patient')),
//
//     created_at timestamptz not null default now(),
//     created_by uuid,
//     updated_at timestamptz not null default now(),
//     updated_by uuid
//   );
//
//   alter table practice_waiting_list_entry drop constraint if exists practice_waiting_list_window_order;
//   alter table practice_waiting_list_entry add constraint practice_waiting_list_window_order
//     check (earliest_date is null or latest_date is null or latest_date >= earliest_date);
//
//   -- An offered row that names no time, and a booked row that names no appointment, are both records
//   -- that claim something happened without saying what.
//   alter table practice_waiting_list_entry drop constraint if exists practice_waiting_list_offer_complete;
//   alter table practice_waiting_list_entry add constraint practice_waiting_list_offer_complete
//     check (status <> 'offered' or (offered_at is not null and offered_start is not null));
//   alter table practice_waiting_list_entry drop constraint if exists practice_waiting_list_booked_complete;
//   alter table practice_waiting_list_entry add constraint practice_waiting_list_booked_complete
//     check (status <> 'booked' or appointment_id is not null);
//
//   create index if not exists idx_practice_waiting_list_ws
//     on practice_waiting_list_entry(workspace_id, status, appointment_type);
//
//   alter table practice_waiting_list_entry enable row level security;
//
//   notify pgrst, 'reload schema';
//
// ---- ⚠ UNTIL THOSE MIGRATIONS ARE APPLIED ----------------------------------------------------------
//
// This engine does NOT put the new columns into RULE_COLUMNS unconditionally, and that is the difference
// between a screen that degrades and a screen that dies. PostgREST refuses an entire select naming one
// column that does not exist, so a single unconditional addition would turn every booking-rules read at
// every practice into "your booking rules could not be read" until somebody applied a file by hand.
//
// So the extension is PROBED, once per process, exactly as forms.ts probes for its four tables -- by a
// real `select ... limit 1`, never by head+count, because a missing table and an empty one both return a
// null count and that trap produced four wrong answers in the survey this build follows. When the probe
// says absent, the four new sections report themselves absent WITH THE MIGRATION NAMED and enforce
// nothing. The moment the migration lands the answer changes on its own, with no code change.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** The three states, as practice-sessions.ts defines them. `ok` with an empty value is not `unreadable`. */
export type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable"; reason: string };

export const ruleReadingValue = <T>(r: Reading<T>, fallback: T): T =>
  r.state === "ok" ? r.value : fallback;

const nowIso = () => new Date().toISOString();

/** Live = a real person expecting to be seen. The same three statuses the rest of this area uses. */
const LIVE_BOOKING_STATUSES = ["REQUESTED", "CONFIRMED", "ARRIVED"];
/** A follow-up somebody is still expected to attend. */
const LIVE_FOLLOW_UP_STATUSES = ["OPEN", "SCHEDULED"];

/**
 * ⚠ EVERY COLUMN THIS ENGINE DECIDES WITH, IN ONE LIST. A rule read that omits a column silently turns
 * that part of somebody's policy off, and the omission looks exactly like a policy nobody set.
 */
const RULE_COLUMNS_BASE =
  "id, workspace_id, name, description, status, priority, effective_from, effective_to, "
  + "location_id, session_template_id, appointment_type, channel, "
  + "capacity_total, capacity_new, capacity_follow_up, capacity_urgent_reserve, overbooking_allowed, "
  + "patient_eligibility, min_age_years, max_age_years, confirmation_mode, "
  + "follow_up_early_days, follow_up_late_days, version, active, "
  + "lead_time_minutes, booking_horizon_days, cancellation_notice_minutes, walk_in_daily_limit, "
  + "emergency_reserve_minutes, visibility, created_at, updated_at, created_by";

/** Migration 268's columns. Read only once the probe below says they exist. */
const RULE_COLUMNS_268 =
  "required_information, walk_in_cutoff_minutes, walk_in_queue_policy, "
  + "self_cancel_allowed, self_reschedule_allowed, reschedule_notice_minutes, "
  + "dna_threshold, dna_action, waiting_list_enabled";

export const BOOKING_RULE_MIGRATION_268 =
  "268-practice-booking-rule-sections (required_information, walk-in cutoff and queue, cancellations)";
export const BOOKING_RULE_MIGRATION_269 =
  "269-practice-waiting-list (waiting list, queue priority, what a cancellation records)";

/** PostgREST's schema-cache miss, its column miss, and Postgres's own two. All mean "not applied". */
const NOT_APPLIED_CODES = new Set(["PGRST204", "PGRST205", "PGRST202", "42703", "42P01"]);
const isNotApplied = (error: any) =>
  !!error && (NOT_APPLIED_CODES.has(String(error.code))
    || /could not find the .*column|could not find the table|does not exist/i.test(String(error.message ?? "")));

/**
 * ⚠ ONE PROBE PER PROCESS, AND `null` IS NOT `false`.
 *
 * Three answers, and the third is what stops a database wobble reading as an unapplied migration:
 * `true` the columns are there, `false` the migration has not been applied, `null` NOBODY COULD TELL.
 * A caller that treats null as false would report a practitioner's configured requirements as absent
 * for the length of an outage, which is the fail-quiet direction this file's rule 4 forbids.
 */
let extension268: boolean | null | undefined;

export async function bookingRuleExtensionPresent(admin: any): Promise<boolean | null> {
  if (extension268 !== undefined) return extension268;
  const { error } = await admin.from("practice_booking_rule").select(RULE_COLUMNS_268).limit(1);
  if (!error) { extension268 = true; return true; }
  if (isNotApplied(error)) { extension268 = false; return false; }
  // ⚠ NOT CACHED. An outage must not pin this process to "unknown" for its whole life.
  return null;
}

/** Test seam. The harness flips the schema underneath a live process and must not read a stale answer. */
export function forgetBookingRuleExtension() { extension268 = undefined; }

const ruleColumns = (extended: boolean) =>
  extended ? `${RULE_COLUMNS_BASE}, ${RULE_COLUMNS_268}` : RULE_COLUMNS_BASE;

/**
 * The sentence every section of this build says when its columns are not there.
 *
 * ⚠ IT NAMES THE FILE. "Not available" sends somebody looking. "Migration 268 has not been applied" is
 * something a person can act on in one step.
 */
export const sectionAbsentNote = (what: string, migration: string) =>
  `${what} is not configurable in this deployment yet: migration "${migration}" has not been applied, so `
  + `there is nowhere to store it. Nothing is being enforced and nothing has been lost.`;

/** The fields a version snapshot photographs. Changing any of them is an edit worth a new version. */
export const VERSIONED_FIELDS = [
  "name", "description", "status", "priority", "effective_from", "effective_to",
  "location_id", "session_template_id", "appointment_type", "channel",
  "capacity_total", "capacity_new", "capacity_follow_up", "capacity_urgent_reserve",
  "overbooking_allowed", "patient_eligibility", "min_age_years", "max_age_years",
  "confirmation_mode", "follow_up_early_days", "follow_up_late_days",
  "lead_time_minutes", "booking_horizon_days", "cancellation_notice_minutes",
  "walk_in_daily_limit", "emergency_reserve_minutes", "visibility",
] as const;

/**
 * ⚠ MIGRATION 268's FIELDS ARE VERSIONED TOO, AND THAT IS THE WHOLE REASON required_information IS A
 * COLUMN RATHER THAN A CHILD TABLE. "Which questions were required when this booking was made" is an
 * AC-13 question, and only a column is in the version photograph.
 *
 * They are a SEPARATE list because a snapshot must not photograph a column that does not exist: before
 * the migration lands, writing these keys into a version payload would record nulls as though somebody
 * had cleared a setting they never had.
 */
export const VERSIONED_FIELDS_268 = [
  "required_information", "walk_in_cutoff_minutes", "walk_in_queue_policy",
  "self_cancel_allowed", "self_reschedule_allowed", "reschedule_notice_minutes",
  "dna_threshold", "dna_action", "waiting_list_enabled",
] as const;

export const versionedFields = (extended: boolean): string[] =>
  extended ? [...VERSIONED_FIELDS, ...VERSIONED_FIELDS_268] : [...VERSIONED_FIELDS];

const scopeOf = (r: any): ScopeShape => ({
  effectiveFrom: (r.effective_from as string | null) ?? null,
  effectiveTo: (r.effective_to as string | null) ?? null,
  sessionTemplateId: (r.session_template_id as string | null) ?? null,
  locationId: (r.location_id as string | null) ?? null,
  appointmentType: (r.appointment_type as string | null) ?? null,
  channel: (r.channel as string | null) ?? null,
  patientEligibility: (r.patient_eligibility as string) ?? "any",
  minAgeYears: (r.min_age_years as number | null) ?? null,
  maxAgeYears: (r.max_age_years as number | null) ?? null,
});

// ── s7.1's CARD ──────────────────────────────────────────────────────────────────────────────────────

export type BookingRuleCard = {
  id: string;
  /** ⚠ NULL for a rule written before the card model. The screen says so; it never prints an empty name. */
  name: string | null;
  description: string | null;
  status: string;
  priority: number;
  version: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  locationId: string | null;
  locationName: string | null;
  sessionTemplateId: string | null;
  sessionName: string | null;
  appointmentType: string | null;
  channel: string | null;
  channelLabel: string;
  /** s7.1: "Scope -- TMR International Hospital · Friday outpatient session". */
  scopeLine: string;
  /** s7.1: "Window -- Opens 60 days ahead · closes 2 hours before", in s15's plain language. */
  windowLine: string;
  /** s7.1: "Capacity -- 5 new · 10 follow-up · 2 walk-ins · 1 urgent reserve". */
  capacityLine: string;
  confirmationMode: string;
  patientEligibility: string;
  minAgeYears: number | null;
  maxAgeYears: number | null;
  followUpEarlyDays: number | null;
  followUpLateDays: number | null;
  capacityTotal: number | null;
  capacityNew: number | null;
  capacityFollowUp: number | null;
  capacityUrgentReserve: number | null;
  overbookingAllowed: number;
  leadTimeMinutes: number;
  bookingHorizonDays: number | null;
  walkInDailyLimit: number | null;
  /** s11's arithmetic, on the card, so the ladder is legible before anything is refused. */
  specificity: number;
  rung: string;
  reasons: string[];
  /** True when this row predates the card model and has no name of its own. */
  legacy: boolean;
  /** The ids of every active rule this one is deadlocked with. s11: activation is blocked until resolved. */
  conflictsWith: string[];

  // ── MIGRATION 268's FOUR SECTIONS ────────────────────────────────────────────────────────────────
  //
  // ⚠ `sectionsConfigurable` IS FALSE WHEN THE MIGRATION IS NOT APPLIED, and every field below is then
  // the value that enforces nothing. A screen must draw the absence rather than draw "off", because
  // "you have switched this off" and "this deployment cannot store it" are opposite facts.
  sectionsConfigurable: boolean;
  sectionsAbsentNote: string | null;
  /** s7.2's required information, already read into the shape the resolver takes. */
  requiredInformation: RequiredInformation;
  /** In the practitioner's words: which questions this rule insists on. Empty means none. */
  requiredFieldLabels: string[];
  walkInCutoffMinutes: number | null;
  walkInQueuePolicy: string;
  selfCancelAllowed: boolean;
  selfRescheduleAllowed: boolean;
  rescheduleNoticeMinutes: number | null;
  dnaThreshold: number | null;
  dnaAction: string;
  waitingListEnabled: boolean;
  /** s7.1's card lines for the three new sections, in s15's plain language. */
  walkInLine: string;
  cancellationLine: string;
  requiredInformationLine: string;
};

export type RuleConflict = {
  a: { id: string; name: string | null };
  b: { id: string; name: string | null };
  specificity: number;
  priority: number;
  rung: string;
  /** What a practitioner has to do about it, in their words. */
  resolution: string;
};

function toCard(
  r: any, names: { location: Map<string, string>; session: Map<string, string> }, extended: boolean,
): BookingRuleCard {
  const s = scopeOf(r);
  const required = requiredInformationOf(extended ? r.required_information : null);
  const requiredFieldLabels = BOOKING_INTAKE_FIELDS
    .filter(f => !f.alwaysRequired && levelFor(required, f.field_key) === "required")
    .map(f => f.label);
  const walkInCutoffMinutes = extended ? ((r.walk_in_cutoff_minutes as number | null) ?? null) : null;
  const walkInQueuePolicy = extended ? ((r.walk_in_queue_policy as string) ?? "first_come") : "first_come";
  const selfCancelAllowed = extended ? r.self_cancel_allowed !== false : true;
  const selfRescheduleAllowed = extended ? r.self_reschedule_allowed !== false : true;
  const rescheduleNoticeMinutes = extended ? ((r.reschedule_notice_minutes as number | null) ?? null) : null;
  const dnaThreshold = extended ? ((r.dna_threshold as number | null) ?? null) : null;
  const dnaAction = extended ? ((r.dna_action as string) ?? "none") : "none";
  const waitingListEnabled = extended ? r.waiting_list_enabled === true : false;
  const scopeBits: string[] = [];
  scopeBits.push(r.location_id ? names.location.get(r.location_id as string) ?? "A location" : "Whole practice");
  if (r.session_template_id) scopeBits.push(names.session.get(r.session_template_id as string) ?? "One session");
  if (r.appointment_type) scopeBits.push(String(r.appointment_type).replace(/_/g, " "));
  if (r.effective_from || r.effective_to)
    scopeBits.push(`${r.effective_from ?? "any date"} to ${r.effective_to ?? "no end"}`);

  return {
    id: r.id as string,
    name: (r.name as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    status: (r.status as string) ?? "active",
    priority: (r.priority as number) ?? 0,
    version: (r.version as number) ?? 1,
    effectiveFrom: s.effectiveFrom,
    effectiveTo: s.effectiveTo,
    locationId: s.locationId,
    locationName: s.locationId ? names.location.get(s.locationId) ?? null : null,
    sessionTemplateId: s.sessionTemplateId,
    sessionName: s.sessionTemplateId ? names.session.get(s.sessionTemplateId) ?? null : null,
    appointmentType: s.appointmentType,
    channel: s.channel,
    channelLabel: s.channel ? bookingChannel(s.channel)?.label ?? s.channel : "Every channel",
    scopeLine: scopeBits.join(" · "),
    windowLine: plainWindow((r.booking_horizon_days as number | null) ?? null, (r.lead_time_minutes as number) ?? 0),
    capacityLine: plainCapacity({
      total: (r.capacity_total as number | null) ?? null,
      newPatients: (r.capacity_new as number | null) ?? null,
      followUp: (r.capacity_follow_up as number | null) ?? null,
      urgentReserve: (r.capacity_urgent_reserve as number | null) ?? null,
      overbooking: (r.overbooking_allowed as number) ?? 0,
      walkInDailyLimit: (r.walk_in_daily_limit as number | null) ?? null,
    }),
    confirmationMode: (r.confirmation_mode as string) ?? "instant",
    patientEligibility: s.patientEligibility,
    minAgeYears: s.minAgeYears,
    maxAgeYears: s.maxAgeYears,
    followUpEarlyDays: (r.follow_up_early_days as number | null) ?? null,
    followUpLateDays: (r.follow_up_late_days as number | null) ?? null,
    capacityTotal: (r.capacity_total as number | null) ?? null,
    capacityNew: (r.capacity_new as number | null) ?? null,
    capacityFollowUp: (r.capacity_follow_up as number | null) ?? null,
    capacityUrgentReserve: (r.capacity_urgent_reserve as number | null) ?? null,
    overbookingAllowed: (r.overbooking_allowed as number) ?? 0,
    leadTimeMinutes: (r.lead_time_minutes as number) ?? 0,
    bookingHorizonDays: (r.booking_horizon_days as number | null) ?? null,
    walkInDailyLimit: (r.walk_in_daily_limit as number | null) ?? null,
    specificity: specificityOf(s),
    rung: specificityRung(s),
    reasons: specificityReasons(s),
    legacy: (r.name as string | null) === null,
    conflictsWith: [],

    sectionsConfigurable: extended,
    sectionsAbsentNote: extended ? null
      : sectionAbsentNote("Required information, the walk-in cutoff and queue, and the cancellation rules", BOOKING_RULE_MIGRATION_268),
    requiredInformation: required,
    requiredFieldLabels,
    walkInCutoffMinutes, walkInQueuePolicy,
    selfCancelAllowed, selfRescheduleAllowed, rescheduleNoticeMinutes,
    dnaThreshold, dnaAction, waitingListEnabled,
    walkInLine: plainWalkIn({
      dailyLimit: (r.walk_in_daily_limit as number | null) ?? null,
      cutoffMinutes: walkInCutoffMinutes, queuePolicy: walkInQueuePolicy,
    }),
    cancellationLine: plainCancellation({
      noticeMinutes: (r.cancellation_notice_minutes as number) ?? 0,
      rescheduleNoticeMinutes, selfCancelAllowed, selfRescheduleAllowed,
      dnaThreshold, dnaAction, waitingListEnabled,
    }),
    requiredInformationLine: plainRequiredInformation(required),
  };
}

/**
 * s11's CONFLICT TEST, over a set of rules that are already in force.
 *
 * ⚠ EQUAL SPECIFICITY, EQUAL PRIORITY, AND SCOPES THAT COULD BOTH APPLY. The third clause is not in
 * s11's sentence and it is what keeps the rule from crying wolf: two rules at different hospitals score
 * identically and can never decide the same booking, and reporting that pair as a conflict would stop a
 * practitioner having two hospitals.
 */
export function conflictsAmong(rules: any[]): RuleConflict[] {
  const inForce = rules.filter(r => RULE_STATUSES_IN_FORCE.includes((r.status as string) ?? "active"));
  const out: RuleConflict[] = [];
  for (let i = 0; i < inForce.length; i++) {
    for (let j = i + 1; j < inForce.length; j++) {
      const a = inForce[i], b = inForce[j];
      const sa = scopeOf(a), sb = scopeOf(b);
      if (specificityOf(sa) !== specificityOf(sb)) continue;
      if (((a.priority as number) ?? 0) !== ((b.priority as number) ?? 0)) continue;
      if (!scopesCanOverlap(sa, sb)) continue;
      out.push({
        a: { id: a.id as string, name: (a.name as string | null) ?? null },
        b: { id: b.id as string, name: (b.name as string | null) ?? null },
        specificity: specificityOf(sa),
        priority: (a.priority as number) ?? 0,
        rung: specificityRung(sa),
        resolution:
          "These two are equally specific and equally important, so nothing can choose between them. "
          + "Give one of them a higher priority, narrow one of their scopes, or pause one.",
      });
    }
  }
  return out;
}

/** Every rule this practice has, as cards, with the conflicts marked on them. */
export async function listBookingRules(admin: any, ctx: WorkspaceContext): Promise<Reading<BookingRuleCard[]>> {
  const extended = await bookingRuleExtensionPresent(admin) === true;
  const { data, error } = await admin.from("practice_booking_rule")
    .select(ruleColumns(extended)).eq("workspace_id", ctx.workspaceId);
  // ⚠ NOT AN EMPTY LIST. "No rules" and "the rules could not be read" are the same length and opposite
  // facts, and only one of them means nothing is refusing a booking today.
  if (error) return { state: "unreadable", reason: `your booking rules could not be read: ${error.message}` };

  const rows = (data ?? []) as any[];
  const [{ data: locs }, { data: sess }] = await Promise.all([
    admin.from("practice_location").select("id, name").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_availability_template")
      .select("id, session_name, weekday, starts_minute, location_id")
      .eq("workspace_id", ctx.workspaceId),
  ]);
  const locationNames = new Map(((locs ?? []) as any[]).map(l => [l.id as string, l.name as string]));
  const names = {
    location: locationNames,
    session: new Map(((sess ?? []) as any[]).map(s => [
      s.id as string,
      availabilitySessionLabel(s, locationNames),
    ])),
  };

  const cards = rows.map(r => toCard(r, names, extended));
  const byId = new Map(cards.map(c => [c.id, c]));
  for (const c of conflictsAmong(rows)) {
    byId.get(c.a.id)?.conflictsWith.push(c.b.id);
    byId.get(c.b.id)?.conflictsWith.push(c.a.id);
  }
  // Most specific first, then most important, then by name -- the order the ladder decides in.
  cards.sort((x, y) => y.specificity - x.specificity || y.priority - x.priority
    || (x.name ?? "").localeCompare(y.name ?? ""));
  return { state: "ok", value: cards };
}

// ── AUTHORING (s7.2's builder, s14's permission, migration 244's versioning) ─────────────────────────

export type RuleInput = {
  ruleId?: string | null;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  locationId?: string | null;
  sessionTemplateId?: string | null;
  appointmentType?: string | null;
  channel?: string | null;
  capacityTotal?: number | null;
  capacityNew?: number | null;
  capacityFollowUp?: number | null;
  capacityUrgentReserve?: number | null;
  overbookingAllowed?: number | null;
  patientEligibility?: string | null;
  minAgeYears?: number | null;
  maxAgeYears?: number | null;
  confirmationMode?: string | null;
  followUpEarlyDays?: number | null;
  followUpLateDays?: number | null;
  leadTimeMinutes?: number | null;
  bookingHorizonDays?: number | null;
  cancellationNoticeMinutes?: number | null;
  walkInDailyLimit?: number | null;

  // ── MIGRATION 268. ⚠ Every one is `undefined`-tolerant: a screen that does not draw a section must
  //    not clear it, and a deployment without the migration must not be told it tried.
  requiredInformation?: unknown;
  walkInCutoffMinutes?: number | null;
  walkInQueuePolicy?: string | null;
  selfCancelAllowed?: boolean | null;
  selfRescheduleAllowed?: boolean | null;
  rescheduleNoticeMinutes?: number | null;
  dnaThreshold?: number | null;
  dnaAction?: string | null;
  waitingListEnabled?: boolean | null;

  /** Why it changed. s14 wants a reason on a configuration change; a version nobody explained is a guess. */
  reason?: string | null;
  actorId: string;
  correlationId: string;
};

const int = (v: unknown): number | null =>
  v === undefined || v === null || v === "" ? null : Math.trunc(Number(v));

/**
 * CREATE OR EDIT A RULE, AND KEEP THE HISTORY THAT MAKES AC-13 MEAN SOMETHING.
 *
 * ⚠ THE SNAPSHOT IS WRITTEN BEFORE THE UPDATE, AND ITS ERROR IS READ. The other order loses history
 * silently: if the update lands and the snapshot fails, version 3 exists and nothing records what
 * version 2 said, which is exactly the question a booking made under version 2 will be asked.
 *
 * ⚠ A SAVE THAT CHANGES NOTHING DOES NOT BUMP THE VERSION. A version that moves when nothing moved makes
 * the number meaningless as an answer to "which rule decided this", because two different numbers would
 * name the same rule.
 */
export async function saveBookingRule(admin: any, ctx: WorkspaceContext, args: RuleInput): Promise<EngineResult<{
  id: string; version: number; created: boolean; changed: string[]; conflicts: RuleConflict[];
}>> {
  // s14: "Create/override booking rule -- account owner: Yes. AUTHORISED STAFF: EXPLICIT PERMISSION
  // ONLY." practice.settings.manage is the capability the owner role holds by default and no other role
  // does, so a delegate only has it if somebody granted it to them by name. That IS "explicit permission
  // only", expressed in the capability catalogue that already exists rather than in a new invented code.
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required to write a booking rule" };

  // ⚠ ASKED ONCE, AT THE TOP, AND CARRIED. Asking twice inside one save is how the read half and the
  // write half of one function end up disagreeing about which columns exist.
  const extended = await bookingRuleExtensionPresent(admin) === true;

  // ── The rule as it exists now, if it exists.
  let existing: any = null;
  if (args.ruleId) {
    const { data, error } = await admin.from("practice_booking_rule")
      .select(ruleColumns(extended)).eq("id", args.ruleId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the rule could not be read: ${error.message}` };
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    existing = data;
  }

  const name = args.name === undefined ? (existing?.name ?? null) : (args.name?.trim() || null);
  // s7.1's card is a card because it has a NAME. A new rule without one is a row nobody can recognise on
  // a list of four, which is the defect s2.1 names.
  if (!existing && !name)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a rule needs a name; the card model exists so you can tell four rules apart" };
  if (name !== null && (name.length < 1 || name.length > 120))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a rule name runs from 1 to 120 characters" };

  const next: Record<string, any> = {
    name,
    description: args.description === undefined ? (existing?.description ?? null) : (args.description?.trim() || null),
    status: args.status ?? existing?.status ?? "draft",
    priority: args.priority === undefined || args.priority === null ? (existing?.priority ?? 0) : int(args.priority),
    effective_from: args.effectiveFrom === undefined ? (existing?.effective_from ?? null) : (args.effectiveFrom || null),
    effective_to: args.effectiveTo === undefined ? (existing?.effective_to ?? null) : (args.effectiveTo || null),
    location_id: args.locationId === undefined ? (existing?.location_id ?? null) : (args.locationId || null),
    session_template_id: args.sessionTemplateId === undefined ? (existing?.session_template_id ?? null) : (args.sessionTemplateId || null),
    appointment_type: args.appointmentType === undefined ? (existing?.appointment_type ?? null) : (args.appointmentType || null),
    channel: args.channel === undefined ? (existing?.channel ?? null) : (args.channel || null),
    capacity_total: args.capacityTotal === undefined ? (existing?.capacity_total ?? null) : int(args.capacityTotal),
    capacity_new: args.capacityNew === undefined ? (existing?.capacity_new ?? null) : int(args.capacityNew),
    capacity_follow_up: args.capacityFollowUp === undefined ? (existing?.capacity_follow_up ?? null) : int(args.capacityFollowUp),
    capacity_urgent_reserve: args.capacityUrgentReserve === undefined ? (existing?.capacity_urgent_reserve ?? null) : int(args.capacityUrgentReserve),
    overbooking_allowed: args.overbookingAllowed === undefined || args.overbookingAllowed === null
      ? (existing?.overbooking_allowed ?? 0) : int(args.overbookingAllowed),
    patient_eligibility: args.patientEligibility ?? existing?.patient_eligibility ?? "any",
    min_age_years: args.minAgeYears === undefined ? (existing?.min_age_years ?? null) : int(args.minAgeYears),
    max_age_years: args.maxAgeYears === undefined ? (existing?.max_age_years ?? null) : int(args.maxAgeYears),
    confirmation_mode: args.confirmationMode ?? existing?.confirmation_mode ?? "instant",
    follow_up_early_days: args.followUpEarlyDays === undefined ? (existing?.follow_up_early_days ?? null) : int(args.followUpEarlyDays),
    follow_up_late_days: args.followUpLateDays === undefined ? (existing?.follow_up_late_days ?? null) : int(args.followUpLateDays),
    lead_time_minutes: args.leadTimeMinutes === undefined || args.leadTimeMinutes === null
      ? (existing?.lead_time_minutes ?? 0) : int(args.leadTimeMinutes),
    booking_horizon_days: args.bookingHorizonDays === undefined ? (existing?.booking_horizon_days ?? null) : int(args.bookingHorizonDays),
    cancellation_notice_minutes: args.cancellationNoticeMinutes === undefined || args.cancellationNoticeMinutes === null
      ? (existing?.cancellation_notice_minutes ?? 0) : int(args.cancellationNoticeMinutes),
    walk_in_daily_limit: args.walkInDailyLimit === undefined ? (existing?.walk_in_daily_limit ?? null) : int(args.walkInDailyLimit),
    emergency_reserve_minutes: existing?.emergency_reserve_minutes ?? 0,
    visibility: existing?.visibility ?? "internal",
  };

  // ══ MIGRATION 268's FOUR SECTIONS ══════════════════════════════════════════════════════════════
  //
  // ⚠ REFUSED RATHER THAN DROPPED WHEN THE MIGRATION IS NOT APPLIED. Writing a rule and silently
  // discarding the requirement somebody just typed is the single worst outcome available here: they
  // would leave the screen believing a booking will be refused without a date of birth, and it will not
  // be. The refusal names the file.
  const wants268 = [
    args.requiredInformation, args.walkInCutoffMinutes, args.walkInQueuePolicy,
    args.selfCancelAllowed, args.selfRescheduleAllowed, args.rescheduleNoticeMinutes,
    args.dnaThreshold, args.dnaAction, args.waitingListEnabled,
  ].some(v => v !== undefined);
  if (wants268 && !extended)
    return {
      ok: false, status: 503, code: "STORE_ABSENT",
      message: sectionAbsentNote(
        "Required information, the walk-in cutoff and queue, and the cancellation rules",
        BOOKING_RULE_MIGRATION_268),
    };

  if (extended) {
    // ⚠ NORMALISED THROUGH requiredInformationOf BEFORE IT IS STORED, so what lands in the column is
    // exactly what the resolver will read back. Storing a shape the reader then ignores is a setting
    // that appears saved and decides nothing.
    next.required_information = args.requiredInformation === undefined
      ? (existing?.required_information ?? {})
      : requiredInformationOf(args.requiredInformation);
    next.walk_in_cutoff_minutes = args.walkInCutoffMinutes === undefined
      ? (existing?.walk_in_cutoff_minutes ?? null) : int(args.walkInCutoffMinutes);
    next.walk_in_queue_policy = args.walkInQueuePolicy ?? existing?.walk_in_queue_policy ?? "first_come";
    next.self_cancel_allowed = args.selfCancelAllowed === undefined || args.selfCancelAllowed === null
      ? (existing?.self_cancel_allowed ?? true) : args.selfCancelAllowed === true;
    next.self_reschedule_allowed = args.selfRescheduleAllowed === undefined || args.selfRescheduleAllowed === null
      ? (existing?.self_reschedule_allowed ?? true) : args.selfRescheduleAllowed === true;
    next.reschedule_notice_minutes = args.rescheduleNoticeMinutes === undefined
      ? (existing?.reschedule_notice_minutes ?? null) : int(args.rescheduleNoticeMinutes);
    next.dna_threshold = args.dnaThreshold === undefined
      ? (existing?.dna_threshold ?? null) : int(args.dnaThreshold);
    next.dna_action = args.dnaAction ?? existing?.dna_action ?? "none";
    next.waiting_list_enabled = args.waitingListEnabled === undefined || args.waitingListEnabled === null
      ? (existing?.waiting_list_enabled ?? false) : args.waitingListEnabled === true;
  }

  const bad = validateRuleShape(next, extended);
  if (bad) return bad;

  // Scope references must belong to this practice. A rule naming another practice's location or session
  // is a cross-tenant reference nothing else would ever notice.
  for (const [table, id, what] of [
    ["practice_location", next.location_id, "location"],
    ["practice_availability_template", next.session_template_id, "session"],
  ] as const) {
    if (!id) continue;
    const { data: row, error } = await admin.from(table)
      .select("id").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the ${what} could not be read: ${error.message}` };
    if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  // ══ s11's CONFLICT VALIDATION, BEFORE THE WRITE ═════════════════════════════════════════════════
  //
  // Only when the rule is being put IN FORCE. A draft that would tie is a draft somebody is still
  // writing, and refusing to save it would make the conflict impossible to see before committing to it.
  const conflicts = await conflictsIfActivated(admin, ctx, next, existing?.id ?? null);
  if (!conflicts.ok) return conflicts;
  if (RULE_STATUSES_IN_FORCE.includes(next.status) && conflicts.data.length > 0) {
    const other = conflicts.data[0];
    const otherName = other.b.name ?? other.a.name ?? "an unnamed rule from before the card model";
    return {
      ok: false, status: 422, code: "RULE_CONFLICT",
      message: `this rule and "${otherName}" are equally specific (${other.rung.toLowerCase()}) and equally important (priority ${other.priority}), so nothing could choose between them. ${other.resolution}`,
    };
  }

  // ══ CREATE ═════════════════════════════════════════════════════════════════════════════════════
  if (!existing) {
    const { data, error } = await admin.from("practice_booking_rule").insert({
      workspace_id: ctx.workspaceId,
      ...next,
      version: 1,
      // ⚠ THE MIRROR, NOT A SECOND OPINION. `status` decides; `active` is written so the readers that
      // still filter on it -- resolveBookingRule, the calendar's quick-book, the legacy availability
      // console -- see the same rule this engine does. Migration 245 rekeyed the scope index on
      // `status`, so this no longer has to lie to get past it.
      active: next.status === "active",
      created_by: args.actorId,
    }).select("id, version").maybeSingle();
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
    if (!data) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the rule was not created" };

    await audit(admin, {
      workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_rule_created",
      payload: { ruleId: data.id, version: 1, reason: args.reason ?? null, rule: next },
      correlationId: args.correlationId,
    });
    return { ok: true, data: { id: data.id as string, version: 1, created: true, changed: versionedFields(extended), conflicts: [] } };
  }

  // ══ EDIT ═══════════════════════════════════════════════════════════════════════════════════════
  const changed = versionedFields(extended).filter(f => (existing[f] ?? null) !== (next[f] ?? null));
  if (changed.length === 0)
    return { ok: true, data: { id: existing.id as string, version: existing.version as number, created: false, changed: [], conflicts: conflicts.data } };

  // THE WHOLE PRIOR SHAPE, AT THE PRIOR VERSION NUMBER. So "what did version 3 say" is one row lookup
  // months later, rather than a replay of every diff since.
  const priorPayload: Record<string, any> = {};
  for (const f of versionedFields(extended)) priorPayload[f] = existing[f] ?? null;
  const { error: snapErr } = await admin.from("practice_booking_rule_version").insert({
    workspace_id: ctx.workspaceId,
    rule_id: existing.id,
    version: existing.version,
    payload: priorPayload,
    reason: args.reason?.trim()?.slice(0, 500) || null,
    created_by: args.actorId,
  });
  // ⚠ REFUSED, NOT LOGGED AND CONTINUED. An edit whose predecessor was not kept is an edit that destroys
  // the answer AC-13 exists to give.
  if (snapErr)
    return { ok: false, status: 500, code: "HISTORY_NOT_KEPT", message: `the previous version could not be kept, so the rule was not changed: ${snapErr.message}` };

  const nextVersion = (existing.version as number) + 1;
  const { data: updated, error: upErr } = await admin.from("practice_booking_rule")
    // ⚠ THE MIRROR MOVES IN BOTH DIRECTIONS. Pausing or archiving a rule must clear `active` as well,
    // or the calendar would keep enforcing a rule this engine has taken out of force.
    .update({ ...next, version: nextVersion, active: next.status === "active", updated_at: nowIso() })
    .eq("id", existing.id).eq("workspace_id", ctx.workspaceId).eq("version", existing.version)
    .select("id, version").maybeSingle();
  if (upErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: upErr.message };
  // The version is the optimistic-concurrency token as well as the audit one: two people editing one
  // rule cannot both win, and the loser is told rather than overwritten.
  if (!updated)
    return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "this rule changed underneath you; reload and try again" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_rule_updated",
    payload: {
      ruleId: existing.id, fromVersion: existing.version, toVersion: nextVersion,
      changed, reason: args.reason ?? null,
      before: priorPayload, after: next,
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: existing.id as string, version: nextVersion, created: false, changed: [...changed], conflicts: conflicts.data } };
}

function validateRuleShape(next: Record<string, any>, extended = false): EngineResult<never> | null {
  if (extended) {
    if (!WALK_IN_QUEUE_POLICY_CODES.includes(next.walk_in_queue_policy))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `the walk-in queue policy must be one of: ${WALK_IN_QUEUE_POLICY_CODES.join(", ")}` };
    if (!DNA_ACTION_CODES.includes(next.dna_action))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `what happens after missed appointments must be one of: ${DNA_ACTION_CODES.join(", ")}` };
    // ⚠ REFUSED IN FRONT OF THE PERSON TYPING IT, as well as by migration 268's own CHECK. A threshold
    // with nothing to do and an action with nothing to count are each half a rule, and the halves sit on
    // two different controls -- so a constraint name would arrive with no way to act on it.
    if (next.dna_action === "none" && next.dna_threshold !== null)
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "you have set a number of missed appointments and chosen nothing to happen at it. Choose what should happen, or clear the number." };
    if (next.dna_action !== "none" && next.dna_threshold === null)
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "you have chosen what happens after missed appointments without saying how many. Set the number, or choose nothing automatic." };
    if (next.dna_threshold !== null && (next.dna_threshold < 0 || next.dna_threshold > 50))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the number of missed appointments runs from 0 to 50" };
    if (next.walk_in_cutoff_minutes !== null
      && (next.walk_in_cutoff_minutes < 1 || next.walk_in_cutoff_minutes > 720))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a walk-in cutoff runs from 1 to 720 minutes before a session ends. Leave it empty for no cutoff -- a cutoff of nought and no cutoff are the same thing, so only one of them may be written." };
    if (next.reschedule_notice_minutes !== null
      && (next.reschedule_notice_minutes < 0 || next.reschedule_notice_minutes > 43200))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the notice needed to move a booking runs from 0 to 43200 minutes. Leave it empty and the cancellation notice governs a move too." };

    const req = requiredInformationOf(next.required_information);
    for (const key of Object.keys(req.fields)) {
      // ⚠ A LEVEL ON A QUESTION THAT CANNOT BE SWITCHED OFF IS A SETTING THAT DECIDES NOTHING. Refused
      // rather than stored, because a stored setting that is ignored is exactly the class of thing this
      // whole build is correcting.
      if (INTAKE_FIELDS_ALWAYS_REQUIRED.includes(key) && req.fields[key].level !== "required")
        return {
          ok: false, status: 400, code: "VALIDATION_ERROR",
          message: `"${BOOKING_INTAKE_FIELDS.find(f => f.field_key === key)?.label ?? key}" is asked of everybody and cannot be made optional or switched off. A booking nobody can call by name is one nobody can call.`,
        };
    }
    const unknown = Object.keys(
      (next.required_information && typeof next.required_information === "object"
        ? ((next.required_information as any).fields ?? {}) : {}) as Record<string, unknown>,
    ).filter(k => !BOOKING_INTAKE_FIELD_KEYS.includes(k));
    if (unknown.length > 0)
      return {
        ok: false, status: 400, code: "VALIDATION_ERROR",
        message: `${unknown.map(u => `"${u}"`).join(", ")} ${unknown.length === 1 ? "is not a question" : "are not questions"} a booking can ask. The booking intake asks only what has a column on the booking record: ${BOOKING_INTAKE_FIELD_KEYS.join(", ")}.`,
      };
  }
  return validateRuleShapeBase(next);
}

function validateRuleShapeBase(next: Record<string, any>): EngineResult<never> | null {
  if (!RULE_STATUS_CODES.includes(next.status))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `status must be one of: ${RULE_STATUS_CODES.join(", ")}` };
  if (next.channel !== null && !BOOKING_CHANNEL_CODES.includes(next.channel))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `channel must be one of s7.3's six: ${BOOKING_CHANNEL_CODES.join(", ")}` };
  if (!CONFIRMATION_MODE_CODES.includes(next.confirmation_mode))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `confirmation must be one of: ${CONFIRMATION_MODE_CODES.join(", ")}` };
  if (!PATIENT_ELIGIBILITY_CODES.includes(next.patient_eligibility))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `patient eligibility must be one of s7.6's: ${PATIENT_ELIGIBILITY_CODES.join(", ")}` };
  if (typeof next.priority !== "number" || !Number.isFinite(next.priority) || next.priority < 0 || next.priority > 1000)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "priority runs from 0 to 1000" };
  if (next.effective_from && next.effective_to && next.effective_to < next.effective_from)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the last date a rule applies cannot be before the first" };
  if (next.min_age_years !== null && next.max_age_years !== null && next.max_age_years < next.min_age_years)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the oldest age cannot be below the youngest" };

  // ⚠ s7.4's FIRST RULE, REFUSED HERE AS WELL AS BY THE DATABASE. Migration 244's CHECK is the backstop
  // and a constraint name is not a sentence: a reserve larger than the total is a rule that can never be
  // satisfied, and it must fail in front of the person typing it rather than in front of a patient.
  const reserved = (next.capacity_new ?? 0) + (next.capacity_follow_up ?? 0) + (next.capacity_urgent_reserve ?? 0);
  if (next.capacity_total !== null && reserved > next.capacity_total)
    return {
      ok: false, status: 422, code: "RESERVE_EXCEEDS_TOTAL",
      message: `you have set aside ${reserved} places out of a session total of ${next.capacity_total}. Reserved capacity cannot exceed the session's own, or the rule could never be satisfied.`,
    };
  return null;
}

/** Every in-force rule this one would deadlock with if it were put in force. */
async function conflictsIfActivated(
  admin: any, ctx: WorkspaceContext, candidate: Record<string, any>, excludeId: string | null,
): Promise<EngineResult<RuleConflict[]>> {
  const { data, error } = await admin.from("practice_booking_rule")
    .select(ruleColumns(await bookingRuleExtensionPresent(admin) === true)).eq("workspace_id", ctx.workspaceId);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the other rules could not be read, so a conflict could not be ruled out: ${error.message}` };
  const others = ((data ?? []) as any[]).filter(r => r.id !== excludeId);
  const probe = { ...candidate, id: excludeId ?? "__candidate__", status: "active" };
  return { ok: true, data: conflictsAmong([probe, ...others]).filter(c => c.a.id === probe.id || c.b.id === probe.id) };
}

/** s7.1's card actions: pause, resume, archive. Activation runs s11's conflict test. */
export async function setRuleStatus(admin: any, ctx: WorkspaceContext, args: {
  ruleId: string; status: string; reason?: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; status: string; version: number }>> {
  const saved = await saveBookingRule(admin, ctx, {
    ruleId: args.ruleId, status: args.status, reason: args.reason ?? null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!saved.ok) return saved;
  return { ok: true, data: { id: saved.data.id, status: args.status, version: saved.data.version } };
}

export type RuleVersionEntry = {
  version: number;
  live: boolean;
  payload: Record<string, any>;
  reason: string | null;
  recordedAt: string | null;
};

/** Every version of one rule, oldest first, with the live one last and marked. */
export async function ruleVersionHistory(
  admin: any, ctx: WorkspaceContext, ruleId: string,
): Promise<Reading<RuleVersionEntry[]>> {
  const extended = await bookingRuleExtensionPresent(admin) === true;
  const { data: live, error: liveErr } = await admin.from("practice_booking_rule")
    .select(ruleColumns(extended)).eq("id", ruleId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (liveErr) return { state: "unreadable", reason: `the rule could not be read: ${liveErr.message}` };
  if (!live) return { state: "unreadable", reason: "that rule is not in this practice" };

  const { data: past, error } = await admin.from("practice_booking_rule_version")
    .select("version, payload, reason, created_at")
    .eq("rule_id", ruleId).eq("workspace_id", ctx.workspaceId).order("version");
  if (error) return { state: "unreadable", reason: `the rule's history could not be read: ${error.message}` };

  const livePayload: Record<string, any> = {};
  for (const f of versionedFields(extended)) livePayload[f] = (live as any)[f] ?? null;

  return {
    state: "ok",
    value: [
      ...((past ?? []) as any[]).map(p => ({
        version: p.version as number, live: false,
        payload: (p.payload ?? {}) as Record<string, any>,
        reason: (p.reason as string | null) ?? null,
        recordedAt: (p.created_at as string) ?? null,
      })),
      { version: live.version as number, live: true, payload: livePayload, reason: null, recordedAt: (live.updated_at as string | null) ?? null },
    ],
  };
}

// ── EVALUATION (s11's ladder, s7.4, s7.5, s7.6, s7.2's confirmation) ────────────────────────────────

export type BookingRequest = {
  channel: string;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes?: number | null;
  locationId?: string | null;
  patientId?: string | null;
  /** s7.5. Present when the booking is being made against a follow-up plan. */
  followUpId?: string | null;
  /** s7.6's "referred only". A fact about this booking, not about the patient record. */
  referred?: boolean;
  /**
   * s9's intake, when there is one.
   *
   * ⚠ THIS IS NOT A BREACH OF THIS FILE'S RULE 3, AND THE DISTINCTION IS WORTH STATING. Rule 3 forbids a
   * DECISION arriving in a request -- a rule id, a version, a verdict, or a fact the engine could read
   * for itself. The patient's own answers are none of those: they are the SUBJECT of the check, they
   * exist nowhere else at the moment it runs, and the rule they are checked against is still resolved
   * here from the record. What must never happen is a caller asserting that the answers are SUFFICIENT,
   * and no field on this type lets one.
   *
   * ⚠ UNDEFINED IS NOT AN EMPTY INTAKE. `undefined` means this caller is not an intake path at all --
   * a practitioner at a desk -- and the requirements are not applied to them. `{}` means an intake path
   * that collected nothing, and every required question is then missing. See intakeAppliesTo().
   */
  intake?: Record<string, unknown>;
};

export type Refusal = {
  code: string;
  message: string;
  /** s14: an authorised override applies to CAPACITY and WINDOW, and to nothing else. */
  overridable: boolean;
};

/**
 * ⚠ WHOSE BOOKING THE REQUIRED-INFORMATION RULES ARE ABOUT.
 *
 * s7.2's section is the questions A PATIENT is asked. A practitioner typing a booking into their own
 * diary is not answering an intake form, and refusing them for a blank date of birth would make a
 * required question into a rule against the practice -- which is the same mistake as refusing a practice
 * its own cancellation. So the check runs for the two patient-facing channels ALWAYS (a patient_self
 * booking with no intake at all is every question missing, which is the honest answer), and for every
 * other channel only when the caller has actually supplied an intake to check.
 */
const INTAKE_CHANNELS = ["patient_self", "referral"];
const intakeAppliesTo = (channel: string, intake: Record<string, unknown> | undefined) =>
  INTAKE_CHANNELS.includes(channel) || intake !== undefined;

export type RuleDecision = {
  allowed: boolean;
  /** ⚠ NULL means no rule decided this. That is a real answer -- s11's sixth rung -- and never a blank. */
  ruleId: string | null;
  ruleName: string | null;
  ruleVersion: number | null;
  decidedBy: "rule" | "platform_default";
  rung: string;
  specificity: number;
  /** s11: "Users must be able to see why a rule won." */
  why: string[];
  runnersUp: { id: string; name: string | null; specificity: number; priority: number; rung: string }[];
  confirmationMode: string;
  /** What the appointment would be created as. s7.2's confirmation section, made concrete. */
  initialStatus: "CONFIRMED" | "REQUESTED";
  refusals: Refusal[];
  capacity: {
    windowLabel: string;
    used: number; usedNew: number; usedFollowUp: number;
    total: number | null; ceiling: number | null;
    urgentReserve: number | null;
  } | null;
  /** Caveats that are true of this decision. Never a substitute for a refusal. */
  notes: string[];

  // ── MIGRATION 268's SECTIONS, AS PART OF THE ANSWER RATHER THAN AS A SECOND CALL ─────────────────
  /**
   * s7.2's required information, resolved against this booking's own answers.
   *
   * ⚠ NULL WHEN THE CHECK DID NOT APPLY -- a practitioner's own booking -- and that is not the same as
   * an empty list of missing questions. A screen that drew "nothing missing" for a check nobody ran
   * would tell a practitioner their requirements had been satisfied by a booking they were never asked
   * about.
   */
  intake: {
    /** ⚠ `condition` is present only where the rule carries one, and it is what lets a FORM narrow itself. */
    asked: { fieldKey: string; label: string; level: string; condition?: unknown }[];
    missing: { fieldKey: string; label: string }[];
    discarded: { fieldKey: string; label: string }[];
    discardNotice: string | null;
    /** The answers as they must be WRITTEN. Anything this rule does not ask has been removed. */
    values: Record<string, unknown>;
  } | null;
  /** s7.7's walk-in picture for this time, when this is a walk-in. Null for every other type. */
  walkIn: {
    sessionName: string | null;
    used: number | null;
    sessionLimit: number | null;
    cutoffMinutes: number | null;
    /** Minutes left before the cutoff bites. Negative means it already has. Null when nothing applies. */
    minutesBeforeCutoff: number | null;
  } | null;
  /** s7.2's DNA count for this patient, and what the rule says about it. Null when no rule counts. */
  dna: { missed: number; threshold: number; action: string } | null;
  /** True when migration 268 is applied. False means the three sections above decided nothing. */
  sectionsConfigurable: boolean;
};

type PatientFacts = {
  isNew: boolean | null;
  ageYears: number | null;
  hasActiveFollowUp: boolean | null;
  /**
   * s7.6's "referred only". ⚠ THE ONE FACT THAT IS NOT READ FROM A RECORD, because there is no referral
   * table: it is a property of the booking being made, not of the patient. It is therefore the one
   * eligibility criterion an internal caller asserts, and the rule that turns on it says so on the card.
   */
  referred: boolean;
};

/**
 * ⚠ THE FACTS ELIGIBILITY TURNS ON ARE READ, NEVER ACCEPTED. "Is this patient new" arriving in a request
 * body is a claim, and a rule that only lets new patients into a Friday clinic would be settled by
 * whoever wrote the request.
 */
async function readPatientFacts(
  admin: any, ctx: WorkspaceContext, patientId: string | null, onDate: string, referred: boolean,
): Promise<Reading<PatientFacts>> {
  if (!patientId)
    return { state: "ok", value: { isNew: null, ageYears: null, hasActiveFollowUp: null, referred } };

  const { data: p, error: pErr } = await admin.from("practice_patient")
    .select("id, birth_date").eq("id", patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return { state: "unreadable", reason: `the patient record could not be read: ${pErr.message}` };
  if (!p) return { state: "unreadable", reason: "that patient is not in this practice" };

  const { data: history, error: hErr } = await admin.from("practice_appointment")
    .select("id, status").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .in("status", ["COMPLETED", "ARRIVED", "CONFIRMED", "REQUESTED", "NO_SHOW"]).limit(1);
  if (hErr) return { state: "unreadable", reason: `this patient's appointment history could not be read: ${hErr.message}` };

  const { data: fups, error: fErr } = await admin.from("practice_follow_up")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .in("status", LIVE_FOLLOW_UP_STATUSES).limit(1);
  if (fErr) return { state: "unreadable", reason: `this patient's follow-up plans could not be read: ${fErr.message}` };

  let ageYears: number | null = null;
  const dob = (p.birth_date as string | null) ?? null;
  if (dob) {
    const [by, bm, bd] = dob.split("-").map(Number);
    const [ay, am, ad] = onDate.split("-").map(Number);
    ageYears = ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
  }

  return {
    state: "ok",
    value: {
      isNew: ((history ?? []) as any[]).length === 0,
      ageYears,
      hasActiveFollowUp: ((fups ?? []) as any[]).length > 0,
      referred,
    },
  };
}

/** Does this rule's eligibility describe this patient? Null facts mean NO, and the caller says why. */
function eligibilityMatches(r: any, facts: PatientFacts): { matches: boolean; unknown: string | null } {
  const s = scopeOf(r);
  if (s.minAgeYears !== null || s.maxAgeYears !== null) {
    if (facts.ageYears === null)
      return { matches: false, unknown: "a rule scoped by age could not be applied because no date of birth is recorded for this patient" };
    if (s.minAgeYears !== null && facts.ageYears < s.minAgeYears) return { matches: false, unknown: null };
    if (s.maxAgeYears !== null && facts.ageYears > s.maxAgeYears) return { matches: false, unknown: null };
  }
  switch (s.patientEligibility) {
    case "any": return { matches: true, unknown: null };
    case "new_only":
      if (facts.isNew === null)
        return { matches: false, unknown: "a rule for new patients could not be applied because this booking is not linked to a patient record" };
      return { matches: facts.isNew, unknown: null };
    case "existing_only":
      if (facts.isNew === null)
        return { matches: false, unknown: "a rule for existing patients could not be applied because this booking is not linked to a patient record" };
      return { matches: !facts.isNew, unknown: null };
    case "referred_only":
      return { matches: facts.referred, unknown: null };
    case "paediatric":
      if (facts.ageYears === null)
        return { matches: false, unknown: "a rule for children could not be applied because no date of birth is recorded for this patient" };
      return { matches: facts.ageYears < 18, unknown: null };
    case "adult":
      if (facts.ageYears === null)
        return { matches: false, unknown: "a rule for adults could not be applied because no date of birth is recorded for this patient" };
      return { matches: facts.ageYears >= 18, unknown: null };
    case "active_follow_up":
      if (facts.hasActiveFollowUp === null)
        return { matches: false, unknown: "a rule for patients on a follow-up plan could not be applied because this booking is not linked to a patient record" };
      return { matches: facts.hasActiveFollowUp, unknown: null };
    default: return { matches: true, unknown: null };
  }
}

/** The session occurrence a moment falls inside, so s7.4's "capacity is per session" is per session. */
async function sessionAt(admin: any, ctx: WorkspaceContext, args: {
  timezone: string; date: string; minuteOfDay: number; locationId: string | null;
}): Promise<Reading<{ id: string; name: string | null; startsMinute: number; endsMinute: number } | null>> {
  const weekday = ((new Date(`${args.date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const { data, error } = await admin.from("practice_availability_template")
    .select("id, session_name, weekday, starts_minute, ends_minute, location_id, status, effective_from, effective_to")
    .eq("workspace_id", ctx.workspaceId).eq("weekday", weekday).eq("status", "active");
  if (error) return { state: "unreadable", reason: `your sessions could not be read: ${error.message}` };

  const hit = ((data ?? []) as any[]).find(t => {
    if (args.locationId && t.location_id && t.location_id !== args.locationId) return false;
    if (t.effective_from && args.date < t.effective_from) return false;
    if (t.effective_to && args.date > t.effective_to) return false;
    return args.minuteOfDay >= (t.starts_minute as number) && args.minuteOfDay < (t.ends_minute as number);
  });
  if (!hit) return { state: "ok", value: null };
  return {
    state: "ok",
    value: {
      id: hit.id as string, name: (hit.session_name as string | null) ?? null,
      startsMinute: hit.starts_minute as number, endsMinute: hit.ends_minute as number,
    },
  };
}

/**
 * s11's LADDER, s7.4's CAPACITY, s7.5's WINDOW AND s7.2's CONFIRMATION, IN ONE SERVER-SIDE ANSWER.
 *
 * ⚠ REFUSES (ok:false) FOR EXACTLY TWO THINGS: a read that failed, and a conflict s11 says blocks. A
 * booking that is merely NOT ALLOWED comes back ok:true with allowed:false and its refusals named, so a
 * screen can show why and offer an override. An outage and a policy are different answers.
 */
export async function evaluateBooking(
  admin: any, ctx: WorkspaceContext, req: BookingRequest,
): Promise<EngineResult<RuleDecision>> {
  if (!BOOKING_CHANNEL_CODES.includes(req.channel))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `channel must be one of s7.3's six: ${BOOKING_CHANNEL_CODES.join(", ")}` };
  const startMs = Date.parse(req.scheduledAt);
  if (Number.isNaN(startMs))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "scheduledAt is not a valid timestamp" };

  const { data: ws, error: wsErr } = await admin.from("practice_workspace")
    .select("timezone, status").eq("id", ctx.workspaceId).maybeSingle();
  if (wsErr) return { ok: false, status: 503, code: "READ_FAILED", message: `the practice timezone could not be read: ${wsErr.message}` };

  // ── CPR-LIFE-001 s2 AND s10: AN ARCHIVED, SUSPENDED OR CLOSED PRACTICE TAKES NO BOOKINGS ─────────
  //
  // ⚠ ok:false, NOT A REFUSAL IN THE DECISION. s14 lets an authorised person override a refusal WITH A
  // REASON, and this is not something an override may lift: s10's third acceptance criterion is that a
  // closed practice cannot receive bookings, full stop. A refusal in `decision.refusals` would appear on
  // the screen beside "override with a reason", which is the wrong offer to make here.
  //
  // checkPlacement refuses on the same ground for the same practice, so a booking is stopped whether it
  // arrives through this engine or through Phase 1's. This one exists so that the PREVIEW tells the
  // truth as well -- a screen that says a booking is allowed and then refuses it is worse than either.
  const notBookable = bookingBlock(ws ? (ws.status as string | null) : null);
  if (notBookable)
    return { ok: false, status: 409, code: notBookable.code, message: notBookable.message };

  const timezone = (ws?.timezone as string) || "UTC";

  const date = new Date(startMs).toLocaleDateString("en-CA", { timeZone: timezone });
  const dayStartMs = Date.parse(zonedDayRange(date, timezone).startIso);
  const minuteOfDay = Math.floor((startMs - dayStartMs) / 60000);
  const locationId = req.locationId ?? null;

  // ══ THE RULES. ⚠ AN UNREADABLE RULE SET IS NOT AN EMPTY ONE. ═══════════════════════════════════
  const extended = await bookingRuleExtensionPresent(admin) === true;
  const { data: ruleRows, error: ruleErr } = await admin.from("practice_booking_rule")
    .select(ruleColumns(extended)).eq("workspace_id", ctx.workspaceId);
  if (ruleErr)
    return {
      ok: false, status: 503, code: "RULES_UNREADABLE",
      message: `this booking was not made because your booking rules could not be read: ${ruleErr.message} — an unread rule is not an absent one`,
    };

  const facts = await readPatientFacts(admin, ctx, req.patientId ?? null, date, req.referred === true);
  if (facts.state !== "ok")
    return { ok: false, status: 503, code: "PATIENT_FACTS_UNREADABLE", message: `this booking was not made because ${facts.reason}` };

  const session = await sessionAt(admin, ctx, { timezone, date, minuteOfDay, locationId });
  if (session.state !== "ok")
    return { ok: false, status: 503, code: "SESSIONS_UNREADABLE", message: `this booking was not made because ${session.reason}` };

  const notes: string[] = [];
  const inForce = ((ruleRows ?? []) as any[])
    .filter(r => RULE_STATUSES_IN_FORCE.includes((r.status as string) ?? "active"));

  const candidates = inForce.filter(r => {
    const s = scopeOf(r);
    if (s.effectiveFrom && date < s.effectiveFrom) return false;
    if (s.effectiveTo && date > s.effectiveTo) return false;
    if (s.locationId && s.locationId !== locationId) return false;
    if (s.appointmentType && s.appointmentType !== req.appointmentType) return false;
    if (s.channel && s.channel !== req.channel) return false;
    if (s.sessionTemplateId && s.sessionTemplateId !== (session.value?.id ?? null)) return false;
    const e = eligibilityMatches(r, facts.value);
    if (e.unknown && !notes.includes(e.unknown)) notes.push(e.unknown);
    return e.matches;
  });

  // ══ s11: MOST SPECIFIC WINS; AT EQUAL SPECIFICITY, PRIORITY; AT BOTH EQUAL, BLOCKED ════════════
  const scored = candidates.map(r => ({ r, spec: specificityOf(scopeOf(r)), pri: (r.priority as number) ?? 0 }));
  const topSpec = scored.reduce((n, c) => Math.max(n, c.spec), -1);
  const atTopSpec = scored.filter(c => c.spec === topSpec);
  const topPri = atTopSpec.reduce((n, c) => Math.max(n, c.pri), -1);
  const winners = atTopSpec.filter(c => c.pri === topPri);

  if (winners.length > 1) {
    const named = winners.map(w => `"${(w.r.name as string | null) ?? "an unnamed rule from before the card model"}"`);
    return {
      ok: false, status: 422, code: "RULE_CONFLICT",
      message: `${named.join(" and ")} are equally specific (${specificityRung(scopeOf(winners[0].r)).toLowerCase()}) and equally important (priority ${topPri}), so nothing can choose between them. This booking is blocked until one of them is given a higher priority, narrowed or paused.`,
    };
  }

  const runnersUp = scored.filter(c => c.r.id !== winners[0]?.r.id).map(c => ({
    id: c.r.id as string, name: (c.r.name as string | null) ?? null,
    specificity: c.spec, priority: c.pri, rung: specificityRung(scopeOf(c.r)),
  })).sort((a, b) => b.specificity - a.specificity || b.priority - a.priority);

  // ══ s11's SIXTH RUNG: NO RULE AT ALL ═══════════════════════════════════════════════════════════
  if (winners.length === 0) {
    // ⚠ THE INTAKE IS STILL RESOLVED, and the reason is `values`. No rule means nothing is REQUIRED --
    // but the caller still has to be told which answers to write, and returning nothing here would make
    // "which answers may be stored" a question with two answers depending on whether a rule matched.
    const openIntake = intakeAppliesTo(req.channel, req.intake)
      ? resolveIntake(requiredInformationOf(null), req.intake ?? {}, date) : null;
    return {
      ok: true,
      data: {
        allowed: true, ruleId: null, ruleName: null, ruleVersion: null,
        decidedBy: "platform_default", rung: PLATFORM_DEFAULT_RUNG, specificity: -1,
        why: [
          inForce.length === 0
            ? "You have no booking rule in force, so nothing constrains this booking."
            : "No rule you have written covers this booking, so nothing constrains it.",
        ],
        runnersUp: [], confirmationMode: "instant", initialStatus: "CONFIRMED",
        refusals: [], capacity: null,
        notes: [
          ...notes,
          "This booking was not decided by a rule. It will be recorded as such rather than attributed to one.",
        ],
        intake: openIntake === null ? null : intakeBlock(openIntake),
        walkIn: null, dna: null, sectionsConfigurable: extended,
      },
    };
  }

  const win = winners[0].r;
  const winScope = scopeOf(win);
  const refusals: Refusal[] = [];

  // ── s7.2's BOOKING WINDOW, from the two columns that have held it since migration 230.
  const leadMinutes = (win.lead_time_minutes as number) ?? 0;
  const horizonDays = (win.booking_horizon_days as number | null) ?? null;
  if (leadMinutes > 0 && startMs < Date.now() + leadMinutes * 60000)
    refusals.push({
      code: "LEAD_TIME", overridable: true,
      message: `"${(win.name as string | null) ?? "this rule"}" needs ${leadMinutes} minutes' notice, and that time is sooner than that.`,
    });
  if (horizonDays !== null && startMs > Date.now() + horizonDays * 86400000)
    refusals.push({
      code: "BEYOND_HORIZON", overridable: true,
      message: `"${(win.name as string | null) ?? "this rule"}" opens the diary ${horizonDays} days ahead, and that date is further out.`,
    });

  // ── s7.4's CAPACITY, PER SESSION.
  let capacity: RuleDecision["capacity"] = null;
  const capacityWanted = win.capacity_total !== null || win.capacity_new !== null
    || win.capacity_follow_up !== null || (win.capacity_urgent_reserve ?? 0) > 0;
  if (capacityWanted) {
    const windowStartMin = session.value ? session.value.startsMinute : 0;
    const windowEndMin = session.value ? session.value.endsMinute : 1440;
    const startIso = new Date(dayStartMs + windowStartMin * 60000).toISOString();
    const endIso = new Date(dayStartMs + windowEndMin * 60000).toISOString();

    let q = admin.from("practice_appointment")
      .select("id, appointment_type")
      .eq("workspace_id", ctx.workspaceId).in("status", LIVE_BOOKING_STATUSES)
      .gte("scheduled_at", startIso).lt("scheduled_at", endIso);
    if (winScope.locationId) q = q.eq("location_id", winScope.locationId);
    const { data: taken, error: takenErr } = await q;
    // ⚠ A COUNT THAT FAILED IS NOT A COUNT OF NOUGHT. Waving a booking through here would overfill a
    // clinic because the database hiccupped, and the practitioner would find out on the day.
    if (takenErr)
      return {
        ok: false, status: 503, code: "CAPACITY_UNREADABLE",
        message: `this booking was not made because the appointments already in that session could not be counted: ${takenErr.message}`,
      };

    const rows = (taken ?? []) as any[];
    const used = rows.length;
    const usedNew = rows.filter(a => a.appointment_type === "new_consultation").length;
    const usedFollowUp = rows.filter(a => a.appointment_type === "scheduled_followup").length;
    const total = (win.capacity_total as number | null) ?? null;
    const over = (win.overbooking_allowed as number | null) ?? 0;
    const ceiling = total === null ? null : total + over;
    const reserve = (win.capacity_urgent_reserve as number | null) ?? null;

    // s7.4: "Capacity is calculated PER SESSION, not merely per day." The label says which, because a
    // refusal that names the wrong window is a refusal a practitioner cannot check.
    const windowLabel = session.value
      ? `${session.value.name ?? "the session"} on ${date}`
      : `${date} (no session covers that time, so the whole day was counted)`;

    capacity = { windowLabel, used, usedNew, usedFollowUp, total, ceiling, urgentReserve: reserve };

    if (ceiling !== null && used >= ceiling)
      refusals.push({
        code: "CAPACITY_FULL", overridable: true,
        message: `${windowLabel} already holds ${used} of ${ceiling}${over > 0 ? ` (${total} plus ${over} over)` : ""}.`,
      });
    else if (ceiling !== null && reserve !== null && reserve > 0
      && req.appointmentType !== "emergency" && used >= ceiling - reserve)
      refusals.push({
        code: "URGENT_RESERVE", overridable: true,
        message: `the last ${reserve} place${reserve === 1 ? "" : "s"} in ${windowLabel} ${reserve === 1 ? "is" : "are"} held for urgent appointments, and ${used} of ${ceiling} are taken.`,
      });

    const perType: [string, number | null, number][] = [
      ["new_consultation", (win.capacity_new as number | null) ?? null, usedNew],
      ["scheduled_followup", (win.capacity_follow_up as number | null) ?? null, usedFollowUp],
    ];
    for (const [type, cap, usedOfType] of perType) {
      if (req.appointmentType !== type || cap === null) continue;
      if (usedOfType >= cap)
        refusals.push({
          code: "TYPE_CAPACITY_FULL", overridable: true,
          message: `${windowLabel} allows ${cap} ${type.replace(/_/g, " ")} appointment${cap === 1 ? "" : "s"}, and ${usedOfType} ${usedOfType === 1 ? "is" : "are"} already booked.`,
        });
    }
  }

  // ── s7.5 AND AC-08: A FOLLOW-UP MAY ONLY BE OFFERED SESSIONS CONSISTENT WITH ITS DUE WINDOW.
  if (req.followUpId) {
    const { data: fup, error: fupErr } = await admin.from("practice_follow_up")
      .select("id, due_on, status").eq("id", req.followUpId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (fupErr)
      return { ok: false, status: 503, code: "FOLLOW_UP_UNREADABLE", message: `this booking was not made because the follow-up plan could not be read: ${fupErr.message}` };
    if (!fup) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

    const early = (win.follow_up_early_days as number | null) ?? null;
    const late = (win.follow_up_late_days as number | null) ?? null;
    const due = fup.due_on as string;
    if (early === null && late === null) {
      notes.push(`"${(win.name as string | null) ?? "this rule"}" sets no early or late window for follow-ups, so this booking was not checked against the ${due} due date.`);
    } else {
      const earliest = early === null ? null : shiftDate(due, -early);
      const latest = late === null ? null : shiftDate(due, late);
      if (earliest !== null && date < earliest)
        refusals.push({
          code: "FOLLOW_UP_TOO_EARLY", overridable: true,
          message: `this follow-up is due on ${due} and may be booked from ${earliest}. ${date} is earlier than that.`,
        });
      if (latest !== null && date > latest)
        refusals.push({
          code: "FOLLOW_UP_TOO_LATE", overridable: true,
          message: `this follow-up was due on ${due} and may be booked until ${latest}. ${date} is later than that.`,
        });
    }
  } else if (req.channel === "follow_up") {
    refusals.push({
      code: "FOLLOW_UP_PLAN_REQUIRED", overridable: false,
      message: "a follow-up booking has to say which follow-up plan it is for; without one there is no due date to book it against.",
    });
  }

  // ══ s7.2's REQUIRED INFORMATION (migration 268) ════════════════════════════════════════════════
  //
  // ⚠ NOT OVERRIDABLE, AND THAT IS A DELIBERATE DIFFERENCE FROM EVERY OTHER REFUSAL HERE. s14's
  // override lifts CAPACITY and WINDOW: a practitioner deciding to squeeze somebody in is a judgement
  // they may make and answer for. A missing date of birth is not a judgement -- there is no information
  // to be had, and "overriding" it would mean writing a record with a hole in it and a reason attached
  // saying the hole was intentional. If a practice wants the question to be skippable, the control for
  // that is on the rule and it is called optional.
  const requiredInfo: RequiredInformation = requiredInformationOf(extended ? win.required_information : null);
  const intakeApplies = intakeAppliesTo(req.channel, req.intake);
  const intake = intakeApplies ? resolveIntake(requiredInfo, req.intake ?? {}, date) : null;
  if (intake && intake.missing.length > 0)
    refusals.push({
      code: "INTAKE_INCOMPLETE", overridable: false,
      message: intakeRefusalMessage(intake.missing),
    });
  if (intake && !extended && Object.keys(requiredInfo.fields).length === 0)
    notes.push(sectionAbsentNote("Required information", BOOKING_RULE_MIGRATION_268));

  // ══ s7.7's WALK-IN CUTOFF AND SESSION LIMIT (migration 268) ════════════════════════════════════
  //
  // ⚠ RESOLVED BY walkInAllowance() AND NOWHERE ELSE, which is the same discipline scheduling.ts keeps
  // and for the same reason: the screen a practitioner acts on reads walkInPolicy(), so re-resolving the
  // session here would give this product two answers to one question.
  //
  // ⚠ THIS IS A PREVIEW OF A REFUSAL checkPlacement WILL MAKE ANYWAY, not a replacement for it. A screen
  // that says a walk-in is allowed and then watches it refused is worse than either half alone -- and a
  // refusal that only exists here would be one an API caller walks straight past.
  let walkIn: RuleDecision["walkIn"] = null;
  if (req.appointmentType === "walk_in") {
    const allowance = await walkInAllowance(admin, {
      workspaceId: ctx.workspaceId, locationId, startMs,
    });
    // ⚠ A FAILED READ IS NOT A FREE PLACE. Rule 4 of this file's header, applied to the newest control.
    if (allowance.state !== "ok")
      return {
        ok: false, status: 503, code: "SESSION_WALK_IN_UNREADABLE",
        message: `this booking was not made because the session's walk-in allowance could not be checked: ${allowance.reason}`,
      };
    const a = allowance.value;
    const cutoff = extended ? ((win.walk_in_cutoff_minutes as number | null) ?? null) : null;
    // ⚠ THE ARITHMETIC IS walkInCutoff()'s, NOT A SECOND COPY OF IT. checkPlacement enforces the same
    // rule from the same function, so the preview and the refusal cannot disagree about the boundary.
    const cut = walkInCutoff({
      cutoffMinutes: cutoff,
      sessionEndsMinute: a.session?.endsMinute ?? null,
      minuteOfDay,
    });
    // ⚠ A CUTOFF WITH NO SESSION TO MEASURE FROM APPLIES TO NOTHING, and that is said rather than
    // silently skipped: a practitioner who set a cutoff and watched a 23:00 walk-in accepted is
    // entitled to know why.
    if (cutoff !== null && a.session === null)
      notes.push(`This rule closes walk-ins ${cutoff} minutes before a session ends, and no session covers that time, so there was nothing to measure the cutoff against.`);
    if (cut.bites)
      refusals.push({
        code: "WALK_IN_CUTOFF", overridable: true,
        message: `"${(win.name as string | null) ?? "this rule"}" takes no walk-in in the last ${cutoff} minutes of a session. ${a.session?.sessionName ?? "That session"} takes its last walk-in at ${cut.lastWalkInAt}, which is ${Math.abs(cut.minutesLeft ?? 0)} minute${Math.abs(cut.minutesLeft ?? 0) === 1 ? "" : "s"} before that time.`,
      });
    const minutesBeforeCutoff = cut.minutesLeft;
    if (a.full && a.session)
      refusals.push({
        code: "SESSION_WALK_IN_LIMIT", overridable: true,
        message: `${a.session.sessionName} takes ${a.sessionLimit} walk-in${a.sessionLimit === 1 ? "" : "s"}, and ${a.used === 1 ? "there is already 1" : `there are already ${a.used}`}. This is that session's own limit, not your practice-wide one.`,
      });
    walkIn = {
      sessionName: a.session?.sessionName ?? null,
      used: a.used, sessionLimit: a.sessionLimit,
      cutoffMinutes: cutoff, minutesBeforeCutoff,
    };
  }

  // ══ s7.2's DNA HANDLING (migration 268) ════════════════════════════════════════════════════════
  //
  // ⚠ COUNTED FROM THE DIARY, NEVER ACCEPTED. "How many has this patient missed" is the kind of fact
  // rule 3 of this file's header exists for -- a number in a request body is a number somebody edits.
  let dna: RuleDecision["dna"] = null;
  const dnaThreshold = extended ? ((win.dna_threshold as number | null) ?? null) : null;
  const dnaAction = extended ? ((win.dna_action as string) ?? "none") : "none";
  let dnaForcesRequest = false;
  if (dnaThreshold !== null && dnaAction !== "none" && req.patientId) {
    const { data: missed, error: missedErr } = await admin.from("practice_appointment")
      .select("id").eq("workspace_id", ctx.workspaceId).eq("patient_id", req.patientId)
      .eq("status", "NO_SHOW");
    // ⚠ AN UNCOUNTED MISS IS NOT NO MISS. The whole point of the rule is that it bites at a number, and
    // a database wobble must not be the way past it.
    if (missedErr)
      return {
        ok: false, status: 503, code: "DNA_COUNT_UNREADABLE",
        message: `this booking was not made because this patient's missed appointments could not be counted: ${missedErr.message}`,
      };
    const count = ((missed ?? []) as any[]).length;
    dna = { missed: count, threshold: dnaThreshold, action: dnaAction };
    if (count >= dnaThreshold) {
      if (dnaAction === "block_self_booking" && req.channel === "patient_self")
        refusals.push({
          code: "DNA_LIMIT", overridable: true,
          message: `this booking cannot be made online. Please ring the practice to arrange it.`,
        });
      else if (dnaAction === "block_self_booking")
        notes.push(`This patient has missed ${count} appointment${count === 1 ? "" : "s"} and cannot book online under this rule. You are booking on their behalf, which this rule does not stop.`);
      else if (dnaAction === "require_approval") {
        dnaForcesRequest = true;
        notes.push(`This patient has missed ${count} appointment${count === 1 ? "" : "s"}, which is at or over this rule's threshold of ${dnaThreshold}, so this booking is a request for you to approve rather than a confirmed appointment.`);
      }
    }
  } else if (dnaThreshold !== null && dnaAction !== "none") {
    // ⚠ SAID, NOT SILENTLY SKIPPED. A rule that counts missed appointments cannot count them for a
    // booking that names nobody, and a practitioner is entitled to know their rule did not apply.
    notes.push("This rule acts on missed appointments, and this booking is not linked to a patient record, so there was nothing to count.");
  }

  // ── s7.2's CONFIRMATION.
  const mode = (win.confirmation_mode as string) ?? "instant";
  const initialStatus: "CONFIRMED" | "REQUESTED" =
    // ⚠ DNA's require_approval WINS OVER `instant`, AND IT CAN ONLY EVER MOVE ONE WAY. It can turn a
    // confirmation into a request and never a request into a confirmation, so the two settings cannot
    // combine into something weaker than either of them alone.
    dnaForcesRequest ? "REQUESTED"
      : mode === "instant" ? "CONFIRMED"
        : mode === "conditional" ? (facts.value.isNew === false ? "CONFIRMED" : "REQUESTED")
          : "REQUESTED";
  if (mode === "conditional" && facts.value.isNew === null)
    notes.push("This rule confirms existing patients immediately, and this booking is not linked to a patient record, so it was made a request rather than assumed to be somebody you have seen.");

  const why = [
    ...specificityReasons(winScope),
    runnersUp.length > 0
      ? `${runnersUp.length} other rule${runnersUp.length === 1 ? "" : "s"} could have applied; this one is more specific or more important.`
      : "No other rule could have applied to this booking.",
  ];
  if (atTopSpec.length > 1)
    why.push(`${atTopSpec.length} rules were equally specific, and this one has the higher priority (${topPri}).`);

  return {
    ok: true,
    data: {
      allowed: refusals.length === 0,
      ruleId: win.id as string,
      ruleName: (win.name as string | null) ?? null,
      ruleVersion: (win.version as number) ?? 1,
      decidedBy: "rule",
      rung: specificityRung(winScope),
      specificity: topSpec,
      why, runnersUp,
      confirmationMode: mode, initialStatus,
      refusals, capacity, notes,
      intake: intake === null ? null : intakeBlock(intake),
      walkIn, dna, sectionsConfigurable: extended,
    },
  };
}

/** The resolution, flattened for the wire. ⚠ Strings and booleans only -- see the note below. */
function intakeBlock(r: ReturnType<typeof resolveIntake>): NonNullable<RuleDecision["intake"]> {
  return {
    asked: r.asked.map(a => a.condition === undefined
      ? { fieldKey: a.field.field_key, label: a.field.label, level: a.level }
      : { fieldKey: a.field.field_key, label: a.field.label, level: a.level, condition: a.condition }),
    missing: r.missing.map(m => ({ fieldKey: m.field.field_key, label: m.field.label })),
    discarded: r.discarded.map(d => ({ fieldKey: d.field_key, label: d.label })),
    discardNotice: intakeDiscardNotice(r.discarded),
    values: r.values,
  };
}

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// ── BOOKING (s19's Phase 3 exit condition) ──────────────────────────────────────────────────────────

export type InternalBookingArgs = {
  channel: string;
  patientId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  /** ⚠ THE LEGACY SINGLE STRING. Still written until every reader moves off it. */
  appointmentType: string;
  /** CP-BOOKING-TAXONOMY-001's two dimensions. Absent means "use the practice default". */
  visitTypeId?: string | null;
  consultationModeId?: string | null;
  scheduledAt: string;
  durationMinutes?: number | null;
  locationId?: string | null;
  reason?: string | null;
  followUpId?: string | null;
  referred?: boolean;
  allowOverlap?: boolean;
  /** s9's intake. See BookingRequest.intake -- undefined and `{}` are different things. */
  intake?: Record<string, unknown>;
  /** s14, AC-14. A reason is not optional and the record is written before the booking. */
  override?: { reason: string } | null;
  /**
   * ⚠ THE PATIENT'S PROOF, FOR THE patient_self CHANNEL ONLY. The bearer of a live
   * practice_patient_session. Ignored by every other channel, which still take the capability path.
   *
   * ⚠ IT IS A TOKEN, NOT A VERDICT. Nothing about the decision arrives in this argument list -- rule 3
   * of this file's header -- and this is no exception: the token is CHECKED here against the store, it
   * does not assert anything.
   */
  patientSessionToken?: string | null;
  /** The phone or inbox the booking claims. Must be the one that session actually verified. */
  patientContact?: string | null;
  actorId: string;
  correlationId: string;
};

export type InternalBookingResult = {
  appointmentId: string;
  status: string;
  appliedRuleId: string | null;
  appliedRuleVersion: number | null;
  decidedBy: "rule" | "platform_default";
  ruleName: string | null;
  rung: string;
  why: string[];
  overridden: string[];
  notes: string[];
  /**
   * ⚠ THE ANSWERS THAT MAY BE WRITTEN, AFTER THE RULE HAS TAKEN AWAY THE ONES IT DOES NOT ASK.
   *
   * Null when no intake was checked. The caller writes THESE and never what it was handed -- a question
   * set to "do not ask" whose answer is stored anyway is a record that says something nobody was asked,
   * which is the failure registration-condition.ts's own header argues at length.
   */
  intakeValues: Record<string, unknown> | null;
  /** The sentence to show when answers were thrown away. Null when none were. */
  intakeDiscardNotice: string | null;
};

/**
 * s19's PHASE 3 EXIT CONDITION: "INTERNAL PRACTITIONER/STAFF BOOKING FOLLOWS RULES."
 *
 * ⚠ THE RULE IS EVALUATED HERE, NOT SENT HERE. There is no ruleId, no version and no verdict in the
 * argument list, and adding one later would be adding a way to book past a rule by editing a request.
 *
 * ⚠ applied_rule_id AND applied_rule_version ARE WRITTEN IN THE SAME INSERT AS THE APPOINTMENT. Booking
 * first and stamping second would leave a booking that says it was decided by nothing whenever the
 * second statement failed -- and "decided by nothing" is a claim this schema treats as true.
 */
export async function bookUnderRules(
  admin: any, ctx: WorkspaceContext, args: InternalBookingArgs,
): Promise<EngineResult<InternalBookingResult>> {
  const channel = bookingChannel(args.channel);
  if (!channel)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `channel must be one of s7.3's six: ${BOOKING_CHANNEL_CODES.join(", ")}` };

  // ⚠ A CHANNEL WITH NO DOOR IS REFUSED BY NAME, NOT SILENTLY ACCEPTED. AC-06 needs a rule to be
  // WRITEABLE for all six channels; it does not make a patient booking real because a rule mentions one.
  if (!BOOKING_CHANNELS_WITH_A_DOOR.includes(channel.code))
    return {
      ok: false, status: 422, code: "CHANNEL_NOT_BUILT",
      message: `${channel.label.toLowerCase()} is not built. ${channel.phase} owns it, and a rule may already be written for it — but there is no way for such a booking to arrive, so making one here would invent it.${channel.blockedBecause ? ` ${channel.blockedBecause}` : ""}`,
    };

  // ══ WHO IS ALLOWED TO MAKE THIS BOOKING ════════════════════════════════════════════════════════
  //
  // ⚠ FOR patient_self, AND ONLY patient_self, A CAPABILITY TEST IS THE WRONG TEST. A patient is not a
  // member, holds no role and appears in no practice_role_assignment -- migration 254 shapes the session
  // table so they cannot -- so `capabilities.includes("appointment.manage")` can only ever be false for
  // a real patient. Passing it would mean granting patients a practitioner capability, which is the one
  // thing this whole area is built to prevent.
  //
  // So the test is SUBSTITUTED rather than skipped: proof of an unexpired, unrevoked patient session,
  // minted from a consumed challenge, issued for THIS practice, that verified THIS destination. That is
  // a strictly narrower claim than the capability it replaces -- it authorises one booking for one
  // verified contact, not a role.
  //
  // ⚠ A STAFF MEMBER BOOKING FOR A PATIENT IS NOT THIS CHANNEL. They use `staff`, which still takes the
  // capability path below. This branch is only for a booking a patient made themselves.
  if (channel.code === "patient_self") {
    const proof = await checkPatientSession(admin, {
      token: args.patientSessionToken ?? null,
      workspaceId: ctx.workspaceId,
      // The contact the booking claims. checkPatientSession refuses when it is not the verified one.
      destination: args.patientContact ?? null,
    });
    if (!proof.ok)
      return {
        ok: false,
        // An unreadable session store is a 503 and a bad token is a 403: a caller that cannot tell an
        // outage from a refusal retries forever against a database that is down.
        status: proof.code === "PATIENT_SESSION_UNREADABLE" ? 503 : 403,
        code: proof.code,
        // ⚠ ONE MESSAGE FOR EVERY WAY A SESSION IS BAD. Revoked, expired, unknown and wrong-destination
        // are one sentence, so a token being probed cannot be told how close it is. The distinction is
        // kept server-side in proof.reason and deliberately not repeated here.
        message: proof.code === "PATIENT_SESSION_UNREADABLE"
          ? "this booking was not made because your session could not be checked"
          : "your booking session is not valid. Request a new code and start again.",
      };
  } else if (!ctx.capabilities.includes(channel.capability)) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${channel.capability} is required` };
  }

  const decision = await evaluateBooking(admin, ctx, {
    channel: args.channel, appointmentType: args.appointmentType, scheduledAt: args.scheduledAt,
    durationMinutes: args.durationMinutes ?? null, locationId: args.locationId ?? null,
    patientId: args.patientId ?? null, followUpId: args.followUpId ?? null, referred: args.referred === true,
    intake: args.intake,
  });
  // A refusal here is an outage or s11's blocked conflict. Both stop the booking.
  if (!decision.ok) return decision;
  const d = decision.data;

  // ══ s14 AND AC-14: AN OVERRIDE NEEDS A PERMISSION, A REASON, AND A RECORD ══════════════════════
  const overridden: string[] = [];
  if (d.refusals.length > 0) {
    if (!args.override)
      return {
        ok: false, status: 422, code: d.refusals[0].code,
        message: d.refusals.map(r => r.message).join(" "),
      };
    const notOverridable = d.refusals.filter(r => !r.overridable);
    if (notOverridable.length > 0)
      return {
        ok: false, status: 422, code: notOverridable[0].code,
        message: `${notOverridable.map(r => r.message).join(" ")} That is not something an override can lift.`,
      };
    // s14: "Override capacity/window -- account owner: YES WITH REASON. Authorised staff: only if
    // permitted AND WITH REASON."
    if (!ctx.capabilities.includes("practice.settings.manage"))
      return { ok: false, status: 403, code: "OVERRIDE_NOT_PERMITTED", message: "practice.settings.manage is required to override a booking rule" };
    const reason = args.override.reason?.trim() ?? "";
    if (reason.length < 3)
      return {
        ok: false, status: 400, code: "OVERRIDE_REASON_REQUIRED",
        message: "an override has to say why. A booking that broke a rule for a reason nobody wrote down cannot be answered for afterwards.",
      };
    overridden.push(...d.refusals.map(r => r.code));

    // ⚠ WRITTEN BEFORE THE BOOKING AND ITS ERROR IS READ. audit() logs and continues when its insert
    // fails, which is right for a log and wrong for this: AC-14 says the override APPEARS IN THE AUDIT
    // TRAIL, so an override that could not be recorded must not become a booking.
    const { error: overrideErr } = await admin.from("practice_audit_event").insert({
      workspace_id: ctx.workspaceId,
      actor_id: args.actorId,
      event_type: "practice.booking_rule_overridden",
      correlation_id: args.correlationId,
      payload: {
        // s12's OverrideRecord: actor, permission, reason, prior decision, new decision.
        permission: "practice.settings.manage",
        reason: reason.slice(0, 500),
        priorDecision: { allowed: false, refusals: d.refusals },
        newDecision: { allowed: true, by: "override" },
        ruleId: d.ruleId, ruleVersion: d.ruleVersion, ruleName: d.ruleName,
        channel: args.channel, scheduledAt: args.scheduledAt, appointmentType: args.appointmentType,
      },
    });
    if (overrideErr)
      return { ok: false, status: 503, code: "OVERRIDE_NOT_RECORDED", message: `this booking was not made because the override could not be recorded: ${overrideErr.message}` };
  } else if (args.override) {
    return {
      ok: false, status: 422, code: "NOTHING_TO_OVERRIDE",
      message: "nothing refused this booking, so there is no override to record. An override with no refusal behind it is an audit record about nothing.",
    };
  }

  // ── The patient, and the name the diary carries.
  let patientName = args.patientName?.trim() || null;
  if (args.patientId) {
    const { data: patient, error } = await admin.from("practice_patient")
      .select("id, display_name, status").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the patient record could not be read: ${error.message}` };
    if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (patient.status !== "active")
      return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };
    patientName = patient.display_name as string;
  }
  if (!patientName)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "patientName or patientId is required" };

  const duration = args.durationMinutes ?? await defaultAppointmentMinutes(admin, ctx.workspaceId);
  const startMs = Date.parse(args.scheduledAt);
  const endMs = startMs + duration * 60000;

  // Phase 1 and Phase 2's checks still apply: the location must be this practice's and open, nobody can
  // be in two hospitals at once, and a double-book is deliberate or refused. Shared rather than copied,
  // for the reason checkPlacement's own comment gives.
  const placed = await checkPlacement(admin, {
    workspaceId: ctx.workspaceId, startMs, endMs,
    locationId: args.locationId ?? null, appointmentType: args.appointmentType,
    allowOverlap: args.allowOverlap === true,
    // ⚠ THE WINDOW IS ENFORCED TWICE, AND ONLY THIS ENGINE KNOWS WHAT AN OVERRIDE IS. checkPlacement
    // resolves its own rule through resolveBookingRule, which reads the legacy `active` flag -- and
    // since migration 245 let this engine set that flag honestly, the row it resolves is usually the
    // very row this engine just decided with. Told nothing, it would refuse the booking a second time
    // on the ground s14 has already lifted, leaving an audit record of an override that produced no
    // booking. It is told the codes and NOTHING ELSE: the double-book, the travel conflict, the closed
    // location and the double-booking check all still run, and all still stop the booking.
    //
    // ⚠ TWO LISTS RATHER THAN ONE, AND THAT IS THE WHOLE POINT OF THE EMERGENCY OVERRIDE. This argument
    // used to carry every lifted code and checkPlacement filtered it to the two window ones. Now that a
    // walk-in refusal is overridable too, one list would mean the FILTER decides which override applies
    // to which check -- and a filter is a thing somebody widens. Splitting them makes it structural: a
    // lifted LEAD_TIME can never reach the walk-in limit, and a lifted WALK_IN_LIMIT can never reach the
    // booking window, because they arrive on different arguments.
    windowOverridden: overridden.filter(c => !WALK_IN_OVERRIDABLE_CODES.includes(c as never)),
    walkInOverridden: overridden.filter(c => WALK_IN_OVERRIDABLE_CODES.includes(c as never)),
    // ⚠ THE CHANNEL, SO s4.3's booking_mode CAN BE HONOURED WHERE IT IS ENFORCED RATHER THAN WHERE IT IS
    // DISPLAYED. checkPlacement refuses a `patient_self` booking into a session the practitioner marked
    // internal-only, and leaves every other channel exactly as it was -- a practice books into its own
    // internal sessions constantly. Passing the channel is the whole of what this engine contributes:
    // the rule itself belongs in the one function all four booking paths come through.
    channel: args.channel,
  });
  if (!placed.ok) return placed;

  // ⚠ THE SELF-BOOKABLE FILTER IS APPLIED ONLY WHEN THE PATIENT IS CHOOSING. This engine also serves
  // in-house callers (args.channel), and a practice booking on a patient's behalf may legitimately pick
  // Urgent review or Procedure -- the restriction exists to keep those off the PUBLIC form, not to stop
  // the practice using them. Same distinction the DNA rule already makes a few lines above.
  const patientChoosing = args.channel === "patient_self";
  const taxonomy = await loadTaxonomy(admin, { workspaceId: ctx.workspaceId }, { selfBookableOnly: patientChoosing });
  const taxonomyResult = validateChoice(taxonomy, {
    visitTypeId: args.visitTypeId ?? taxonomy.defaultVisitTypeId,
    consultationModeId: args.consultationModeId ?? taxonomy.defaultModeId,
    durationMinutes: duration,
  });
  if (!taxonomyResult.ok)
    return { ok: false, status: 422, code: taxonomyResult.code, message: taxonomyResult.message };
  const taxonomyChoice = taxonomyResult.value;

  const { data: appt, error } = await admin.from("practice_appointment").insert({
    workspace_id: ctx.workspaceId,
    location_id: args.locationId ?? null,
    patient_id: args.patientId ?? null,
    patient_name: patientName,
    patient_phone: args.patientPhone?.trim() || null,
    appointment_type: args.appointmentType,
    scheduled_at: new Date(startMs).toISOString(),
    duration_minutes: duration,
    status: d.initialStatus,
    // ══ THE TAXONOMY, on the patient-facing path (CP-BOOKING-TAXONOMY-001) ═════════════════════════
    // ⚠ SELF-BOOKABLE ONLY. Section 7: "self-booking disabled -- do not expose item on public flow", and
    // section 9 repeats it. Urgent review and Procedure are deliberately NOT self-bookable, so a patient
    // who posted one of those ids gets the same refusal as one who posted a deactivated item -- the
    // filter lives on the SERVER because the ids are visible in the page source.
    visit_type_id: taxonomyChoice.visitTypeId,
    consultation_mode_id: taxonomyChoice.consultationModeId,
    // A booking arriving through this engine IS self-booking. Nothing a form posts can change that.
    booking_source: deriveBookingSource({ channel: "patient_facing" }),
    reason: args.reason ?? null,
    // Migration 255's exclusion constraint carries `and not overlap_acknowledged`, so a deliberate
    // double-book must say so in the row or Postgres refuses it. Taken from the same value passed to
    // checkPlacement above, for the same reason the s14 override codes are: one decision, one source.
    // NOTE this is NOT the s14 window override -- windowOverridden lifts lead time and horizon only, and
    // was deliberately kept clear of the double-book check. An override of the notice period must never
    // become an override of somebody else's appointment.
    overlap_acknowledged: args.allowOverlap === true,
    // ══ AC-13. THE PAIR, IN THIS STATEMENT, OR NEITHER. ═══════════════════════════════════════════
    applied_rule_id: d.ruleId,
    applied_rule_version: d.ruleVersion,
    created_by: args.actorId,
  }).select("id, status").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!appt) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the booking was not made" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_made_under_rule",
    payload: {
      appointmentId: appt.id, channel: args.channel,
      appliedRuleId: d.ruleId, appliedRuleVersion: d.ruleVersion, decidedBy: d.decidedBy,
      rung: d.rung, why: d.why, overridden, status: d.initialStatus,
    },
    correlationId: args.correlationId,
  });

  // CPR-GROWTH-001 s2. Count-based, so it is right however often it runs and whatever ran before it,
  // and non-blocking: a commercial metric that could not be written must never cost a booking.
  await onAppointmentCreated(admin, ctx.workspaceId, args.actorId);

  return {
    ok: true,
    data: {
      appointmentId: appt.id as string,
      status: appt.status as string,
      appliedRuleId: d.ruleId,
      appliedRuleVersion: d.ruleVersion,
      decidedBy: d.decidedBy,
      ruleName: d.ruleName,
      rung: d.rung,
      why: d.why,
      overridden,
      notes: d.notes,
      intakeValues: d.intake?.values ?? null,
      intakeDiscardNotice: d.intake?.discardNotice ?? null,
    },
  };
}

// ── READING A DECISION BACK, MONTHS LATER (AC-13's whole point) ─────────────────────────────────────

export type AppliedRuleExplanation = {
  appointmentId: string;
  scheduledAt: string;
  /** ⚠ FALSE IS A REAL ANSWER, AND THE SCREEN MUST SAY IT RATHER THAN LEAVE A BLANK. */
  decidedByARule: boolean;
  ruleId: string | null;
  ruleVersion: number | null;
  ruleName: string | null;
  /** The rule AS IT WAS at that version -- not as it is now, which is a different rule with the same id. */
  ruleAsApplied: Record<string, any> | null;
  /** True when the rule has been edited since; the live shape would answer the question wrongly. */
  editedSince: boolean;
  liveVersion: number | null;
  statement: string;
};

export async function explainAppointment(
  admin: any, ctx: WorkspaceContext, appointmentId: string,
): Promise<Reading<AppliedRuleExplanation>> {
  const { data: appt, error } = await admin.from("practice_appointment")
    .select("id, scheduled_at, applied_rule_id, applied_rule_version")
    .eq("id", appointmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { state: "unreadable", reason: `the appointment could not be read: ${error.message}` };
  if (!appt) return { state: "unreadable", reason: "that appointment is not in this practice" };

  const ruleId = (appt.applied_rule_id as string | null) ?? null;
  const version = (appt.applied_rule_version as number | null) ?? null;

  if (ruleId === null || version === null) {
    return {
      state: "ok",
      value: {
        appointmentId: appt.id as string, scheduledAt: appt.scheduled_at as string,
        decidedByARule: false, ruleId: null, ruleVersion: null, ruleName: null,
        ruleAsApplied: null, editedSince: false, liveVersion: null,
        // ⚠ NOT A BLANK WHERE A RULE NAME GOES. Null means this booking was not decided by a rule --
        // which is TRUE of every appointment made before the rules engine existed.
        statement: "This booking was not decided by a booking rule. It was made before the rules engine, or through a door that does not consult one.",
      },
    };
  }

  const extended = await bookingRuleExtensionPresent(admin) === true;
  const { data: live, error: liveErr } = await admin.from("practice_booking_rule")
    .select(ruleColumns(extended)).eq("id", ruleId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (liveErr) return { state: "unreadable", reason: `the rule behind this booking could not be read: ${liveErr.message}` };

  const liveVersion = live ? (live.version as number) : null;
  let asApplied: Record<string, any> | null = null;

  if (live && liveVersion === version) {
    asApplied = {};
    for (const f of versionedFields(extended)) asApplied[f] = (live as any)[f] ?? null;
  } else {
    const { data: snap, error: snapErr } = await admin.from("practice_booking_rule_version")
      .select("payload").eq("rule_id", ruleId).eq("version", version)
      .eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (snapErr) return { state: "unreadable", reason: `the version of the rule that decided this booking could not be read: ${snapErr.message}` };
    asApplied = snap ? ((snap.payload ?? {}) as Record<string, any>) : null;
  }

  const nameThen = (asApplied?.name as string | null) ?? (live?.name as string | null) ?? null;
  return {
    state: "ok",
    value: {
      appointmentId: appt.id as string, scheduledAt: appt.scheduled_at as string,
      decidedByARule: true, ruleId, ruleVersion: version, ruleName: nameThen,
      ruleAsApplied: asApplied, editedSince: liveVersion !== null && liveVersion !== version, liveVersion,
      statement: asApplied === null
        ? `This booking was decided by version ${version} of a rule whose record of that version is missing, so what it said cannot be shown.`
        : liveVersion !== null && liveVersion !== version
          ? `This booking was decided by "${nameThen ?? "an unnamed rule"}" as it stood at version ${version}. That rule has been edited since and is now at version ${liveVersion}; what is shown here is what it said at the time.`
          : `This booking was decided by "${nameThen ?? "an unnamed rule"}" at version ${version}, which is still what the rule says.`,
    },
  };
}

// ── WHAT LAYER 3 DRAWS ──────────────────────────────────────────────────────────────────────────────

export type BookingRulesWorkspace = {
  timezone: string;
  today: string;
  rules: Reading<BookingRuleCard[]>;
  conflicts: Reading<RuleConflict[]>;
  locations: { id: string; name: string; active: boolean }[];
  sessions: {
    id: string; name: string; weekday: number; startsMinute: number; endsMinute: number;
    bookingMode: string; locationId: string | null;
    /**
     * `capacity` on practice_availability_template, carried so the publish-readiness screen can
     * judge s2's fourth invariant. It read `sess.capacity` off this object for a while and got
     * undefined every time, because the field was never on it -- an invariant that cannot fail is
     * not an invariant. Null means the derived ceiling stands (migration 241), NOT unconfigured.
     */
    capacity: number | null;
  }[];
  /** Sessions anybody may book that no in-force rule covers. */
  uncovered: Reading<{ id: string; name: string }[]>;
  /** AC-13, counted: bookings carrying a rule, and bookings honestly carrying none. */
  decided: Reading<{ withRule: number; withoutRule: number }>;
  mayAuthor: boolean;
  mayBook: boolean;
  readFailures: string[];
};

/**
 * What an UNNAMED availability template is called on screen.
 *
 * ⚠ IT USED TO BE `Session on day ${weekday}`, AND THAT IS NOT A NAME -- IT IS A COLLISION.
 * Every template in this estate has a null session_name, and three of them fall on the same weekday, so
 * the publish blocker read "Session on day 3, Session on day 3 are covered by no rule in force." Two
 * different sessions, one label, and the person being asked to fix them cannot tell which is which from
 * the sentence asking. A message that names the thing to fix has to name it distinguishably or it has
 * not named it at all.
 *
 * Weekday NAME rather than number (nobody reads "day 3" as Wednesday), the start time because that is
 * what separates two sessions on one day, and the location when the caller knows it -- because the real
 * collisions here are across hospitals.
 */
export function availabilitySessionLabel(
  s: { session_name?: string | null; weekday: number; starts_minute?: number | null; location_id?: string | null },
  locationNames?: Map<string, string>,
): string {
  const given = (s.session_name ?? "").trim();
  if (given) return given;
  const day = WEEKDAY_NAME[s.weekday] ?? `day ${s.weekday}`;
  const mins = typeof s.starts_minute === "number" ? s.starts_minute : null;
  const at = mins === null
    ? ""
    : ` ${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const where = s.location_id && locationNames?.get(s.location_id)
    ? ` at ${locationNames.get(s.location_id)}`
    : "";
  return `Unnamed ${day}${at} session${where}`;
}

export async function bookingRulesWorkspace(admin: any, ctx: WorkspaceContext): Promise<BookingRulesWorkspace> {
  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = (ws?.timezone as string) || "UTC";
  const today = practiceToday(timezone);

  const [rules, locs, sess, appts] = await Promise.all([
    listBookingRules(admin, ctx),
    admin.from("practice_location").select("id, name, active").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_availability_template")
      .select("id, session_name, weekday, starts_minute, ends_minute, booking_mode, location_id, status, capacity")
      .eq("workspace_id", ctx.workspaceId).eq("status", "active").order("weekday").order("starts_minute"),
    admin.from("practice_appointment")
      .select("id, applied_rule_id, applied_rule_version").eq("workspace_id", ctx.workspaceId),
  ]);

  const sessions = ((sess.data ?? []) as any[]).map(s => ({
    id: s.id as string,
    name: availabilitySessionLabel(s, new Map(((locs.data ?? []) as any[]).map(l => [l.id as string, l.name as string]))),
    weekday: s.weekday as number,
    startsMinute: s.starts_minute as number,
    endsMinute: s.ends_minute as number,
    bookingMode: (s.booking_mode as string) ?? "none",
    locationId: (s.location_id as string | null) ?? null,
    capacity: (s.capacity as number | null) ?? null,
  }));

  const conflicts: Reading<RuleConflict[]> = rules.state === "ok"
    ? {
      state: "ok",
      value: (() => {
        const byId = new Map(rules.value.map(r => [r.id, r]));
        const seen = new Set<string>();
        const out: RuleConflict[] = [];
        for (const r of rules.value)
          for (const otherId of r.conflictsWith) {
            const key = [r.id, otherId].sort().join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            const o = byId.get(otherId);
            out.push({
              a: { id: r.id, name: r.name }, b: { id: otherId, name: o?.name ?? null },
              specificity: r.specificity, priority: r.priority, rung: r.rung,
              resolution: "Give one of them a higher priority, narrow one of their scopes, or pause one.",
            });
          }
        return out;
      })(),
    }
    : { state: "unreadable", reason: rules.reason };

  const uncovered: Reading<{ id: string; name: string }[]> = rules.state !== "ok"
    ? { state: "unreadable", reason: rules.reason }
    : sess.error
      ? { state: "unreadable", reason: `your sessions could not be read: ${sess.error.message}` }
      : {
        state: "ok",
        value: sessions.filter(s => s.bookingMode !== "none").filter(s => !rules.value.some(r =>
          r.status === "active"
          && (r.sessionTemplateId === null || r.sessionTemplateId === s.id)
          && (r.locationId === null || r.locationId === s.locationId))).map(s => ({ id: s.id, name: s.name })),
      };

  // ⚠ TWO FIGURES, NOT ONE WITH A GAP. "Carries a rule" and "honestly carries none" are both true
  // statements about a diary, and the second is what every appointment made before Phase 3 is.
  const decided: Reading<{ withRule: number; withoutRule: number }> = appts.error
    ? { state: "unreadable", reason: `your appointments could not be read: ${appts.error.message}` }
    : {
      state: "ok",
      value: {
        withRule: ((appts.data ?? []) as any[]).filter(a => a.applied_rule_id !== null).length,
        withoutRule: ((appts.data ?? []) as any[]).filter(a => a.applied_rule_id === null).length,
      },
    };

  return {
    timezone, today,
    rules, conflicts,
    locations: ((locs.data ?? []) as any[]).map(l => ({ id: l.id as string, name: l.name as string, active: l.active === true })),
    sessions,
    uncovered, decided,
    mayAuthor: ctx.capabilities.includes("practice.settings.manage"),
    mayBook: ctx.capabilities.includes("appointment.manage"),
    readFailures: [rules, uncovered, decided]
      .filter(r => r.state === "unreadable").map(r => (r as { reason: string }).reason),
  };
}

/** Re-exported so a screen and the engine agree on the six channels without a second list. */
export { BOOKING_CHANNELS, scopeDimensions };
