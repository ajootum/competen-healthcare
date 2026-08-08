/**
 * CPR-V5-007 s7.2 -- THE FOUR BUILDER SECTIONS THAT WERE CAPTIONED "NOT BUILT". Migrations 268 and 269.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WHAT THIS HARNESS CAN AND CANNOT PROVE TODAY, STATED FIRST SO NOTHING HERE READS AS MORE THAN IT IS
 *
 * Migrations 268 and 269 are applied BY HAND, once, and had not been applied when this was written.
 * PostgREST refuses a select naming a column that does not exist, so the end-to-end assertions below
 * CANNOT run until the files land -- and a harness that skipped them silently would be a green tick over
 * nothing, which is the exact failure mode this codebase spent a day removing.
 *
 * So the assertions are in TWO GROUPS and the split is deliberate:
 *
 *   A. PURE (sections 1-4). The decision logic, exercised over rule shapes built IN MEMORY. These are
 *      not "unit tests instead of the real thing" -- resolveIntake, the cutoff arithmetic and the
 *      cancellation gate ARE the functions the server calls, called with the same arguments the server
 *      calls them with. They run today, and every one has been broken deliberately and watched go red.
 *
 *   B. END TO END (sections 5-8). Real workspaces, real rows, real refusals through bookUnderRules and
 *      checkPlacement. These PROBE for the migration first. If it is absent they print a loud block
 *      naming the file and THIS SCRIPT EXITS NON-ZERO -- absence is reported as an unproven claim, never
 *      as a pass.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT PROVES:
 *   1. THE LABEL CORRECTION. `walk_ins` no longer claims to be unbuilt, every section that is built and
 *      was once said not to be carries the correction, and the correction names where the control is.
 *   2. REQUIRED INFORMATION. A required question that is blank refuses; the same question left at the
 *      default does not; a question set to "do not ask" has its answer THROWN AWAY rather than stored;
 *      an always-required question cannot be switched off; a condition withdraws a question.
 *   3. THE WALK-IN CUTOFF refuses a late walk-in and does not refuse an early one.
 *   4. THE CANCELLATION NOTICE refuses a patient cancelling inside it and never refuses the practice.
 *   5. END TO END: a required booking field is enforced SERVER-SIDE, through bookUnderRules, when the
 *      form is bypassed entirely.
 *   6. END TO END: the cutoff refuses a real walk-in through checkPlacement, and the emergency override
 *      lifts it -- and lifting it does NOT lift the booking window.
 *   7. END TO END: the waiting list stores, offers and closes, and an offer delivers nothing.
 *   8. A FAILED READ IS NEVER A ZERO, over the three new reads.
 *
 *   npx --yes tsx scripts/practice-booking-sections-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { practiceToday, zonedDayRange } from "../src/lib/practice/practice-time";
import { saveSession } from "../src/lib/practice/practice-sessions";
import {
  saveBookingRule, evaluateBooking, bookUnderRules, listBookingRules,
  bookingRuleExtensionPresent, forgetBookingRuleExtension,
  BOOKING_RULE_MIGRATION_268,
} from "../src/lib/practice/booking-rules";
import {
  BUILDER_SECTIONS, BOOKING_CHANNELS, BOOKING_INTAKE_FIELDS, INTAKE_FIELDS_ALWAYS_REQUIRED,
  requiredInformationOf, resolveIntake, levelFor, intakeRefusalMessage, intakeDiscardNotice,
  plainWalkIn, plainCancellation, plainRequiredInformation,
  WALK_IN_OVERRIDABLE_CODES, WAITING_LIST_CONTACT_NOTE, walkInCutoff,
  WAITING_LIST_NO_SCREEN_NOTE, QUEUE_PRIORITY_NO_SCREEN_NOTE, minuteOfDayAsClock,
} from "../src/lib/practice/booking-rule-constants";
import {
  addToWaitingList, offerWaitingListEntry, closeWaitingListEntry, listWaitingList,
  cancelBooking, recordNoShow, waitingListStorePresent, forgetWaitingListStore,
} from "../src/lib/practice/booking-cancellation";
import { WALK_IN_NOW_CONFIGURABLE } from "../src/lib/practice/recall-constants";
import { hhmm } from "../src/lib/practice/availability-config";
import { checkPlacement } from "../src/lib/practice/scheduling";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ec001";
const TZ = "Africa/Kampala";
const CORR = "harness-sections";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/* eslint-disable @typescript-eslint/no-explicit-any */

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// GROUP A -- PURE. Runs whether or not the migrations are applied.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ THE SOURCE IS READ WITH ITS COMMENTS STRIPPED BEFORE ANY NEGATIVE SCAN.
 *
 * The commonest cause of a vacuous assertion in this codebase is scanning raw source for a phrase that
 * also appears inside the scanner's own explanatory comment -- the file then always matches and the
 * assertion can never fail. Every scan below goes through this.
 */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map(line => {
      const i = line.indexOf("//");
      // Crude, and correct for this purpose: these files carry no `//` inside a string literal on a
      // line that also carries code we scan for. Block comments are handled after.
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function sectionOne() {
  console.log("\n1. THE LABEL CORRECTION -- what was said not built, and what actually was");

  const walkIns = BUILDER_SECTIONS.find(s => s.key === "walk_ins")!;
  ok("walk_ins no longer claims to be unbuilt", walkIns.built === true && walkIns.phase === null,
    `built=${walkIns.built} phase=${walkIns.phase}`);
  ok("walk_ins says what was ALREADY configurable, and names migration 240",
    (walkIns.alreadyBuilt ?? "").includes("240"), walkIns.alreadyBuilt ?? "null");
  ok("walk_ins says WHERE that control is -- on the session, not on this card",
    /session/i.test(walkIns.alreadyBuilt ?? "") && /Regular Practice/i.test(walkIns.alreadyBuilt ?? ""));

  // ⚠ THE OLD SENTENCE IS GONE FROM THE SOURCE, not merely contradicted elsewhere in it.
  const constantsSrc = codeOf("src/lib/practice/booking-rule-constants.ts");
  ok("the old walk-in sentence is gone from the declaration",
    !constantsSrc.includes("There is no per-session walk-in limit, cutoff or queue rule on this table"));
  ok("the old cancellation sentence is gone from the declaration",
    !constantsSrc.includes("never used to refuse a cancellation"));

  for (const key of ["required_information", "cancellations"]) {
    const s = BUILDER_SECTIONS.find(x => x.key === key)!;
    ok(`${key} is built and carries a correction`,
      s.built === true && (s.alreadyBuilt ?? "").length > 40, `built=${s.built}`);
  }

  // ⚠ NOTIFICATIONS IS UNCHANGED, AND THAT IS ASSERTED RATHER THAN ASSUMED. It was explicitly excluded
  // from this build. A later edit that quietly softened its sentence, added a "coming soon" or gave it
  // a control would be caught here.
  const notif = BUILDER_SECTIONS.find(s => s.key === "notifications")!;
  ok("notifications is STILL not built, on Phase 6, with its sentence untouched",
    notif.built === false && notif.phase === "Phase 6" && notif.alreadyBuilt === null
    && notif.note === "Nothing in this product sends a message to a patient. Offering triggers here would promise a notification nobody would receive.",
    notif.note);
  ok("no notification trigger vocabulary was added anywhere",
    !/NOTIFICATION_TRIGGER|notificationTrigger|notification_triggers/.test(constantsSrc));

  const walkInChannel = BOOKING_CHANNELS.find(c => c.code === "walk_in")!;
  ok("the walk-in CHANNEL has a door now", walkInChannel.door === true && walkInChannel.phase === null);

  ok("the three walk-in items once listed as not configurable now say where they are",
    WALK_IN_NOW_CONFIGURABLE.length === 3
    && WALK_IN_NOW_CONFIGURABLE.every(n => n.where.length > 20 && n.note.length > 20));
}

function sectionTwo() {
  console.log("\n2. REQUIRED INFORMATION -- pure resolution");

  const today = "2026-08-10";
  const full = {
    given_name: "Amina", family_name: "Nakato", birth_date: "1990-04-02",
    contact_phone: "+256772555401", reason_for_visit: "Cough for three weeks",
  };

  // ── An empty rule demands nothing, and this is the behaviour before the column existed.
  const none = resolveIntake(requiredInformationOf(null), full, today);
  ok("a rule that configures nothing demands nothing beyond the name", none.missing.length === 0);
  ok("...and throws nothing away", none.discarded.length === 0);
  ok("...and every answer survives to be written",
    none.values.reason_for_visit === "Cough for three weeks");

  // ── An unknown level falls back to optional rather than to required.
  const junk = requiredInformationOf({ fields: { birth_date: "MANDATORY", not_a_field: "required" } });
  ok("an unrecognised level reads as optional, never as required",
    levelFor(junk, "birth_date") === "optional");
  ok("a key that is not a booking question is dropped rather than stored",
    junk.fields.not_a_field === undefined);

  // ── REQUIRED AND BLANK REFUSES.
  const req = requiredInformationOf({ fields: { birth_date: "required", contact_phone: "required" } });
  const missing = resolveIntake(req, { given_name: "A", family_name: "B" }, today);
  ok("a required question left blank is reported missing", missing.missing.length === 2,
    missing.missing.map(m => m.field.field_key).join(","));
  ok("the refusal names the questions in the practitioner's words",
    intakeRefusalMessage(missing.missing).includes("Date of birth")
    && intakeRefusalMessage(missing.missing).includes("Phone number"));
  const supplied = resolveIntake(req, full, today);
  ok("CONTROL: the same rule with the answers supplied refuses nothing", supplied.missing.length === 0);

  // ⚠ A REQUIRED ANSWER OF SPACES IS NOT AN ANSWER. Migration 257's correction, as a function.
  const spaces = resolveIntake(req, { ...full, contact_phone: "   " }, today);
  ok("a required answer of spaces reads as blank", spaces.missing.length === 1);

  // ── OFF THROWS THE ANSWER AWAY.
  const off = requiredInformationOf({ fields: { reason_for_visit: "off" } });
  const dropped = resolveIntake(off, full, today);
  ok("a question set to 'do not ask' has its answer removed from what is written",
    dropped.values.reason_for_visit === undefined);
  ok("...and the removal is REPORTED rather than silent",
    dropped.discarded.length === 1 && dropped.discarded[0].field_key === "reason_for_visit");
  ok("...in a sentence naming the question",
    (intakeDiscardNotice(dropped.discarded) ?? "").includes("Reason for the visit"));
  const notSent = resolveIntake(off, { given_name: "A", family_name: "B" }, today);
  ok("CONTROL: an answer nobody gave to a withdrawn question is not reported as discarded",
    notSent.discarded.length === 0);

  // ── THE ALWAYS-REQUIRED TWO CANNOT BE SWITCHED OFF, whatever a stored map says.
  const sneak = requiredInformationOf({ fields: { given_name: "off", family_name: "optional" } });
  ok("a name cannot be switched off by a stored level",
    levelFor(sneak, "given_name") === "required" && levelFor(sneak, "family_name") === "required");
  const noName = resolveIntake(sneak, { family_name: "B" }, today);
  ok("...and a booking with no first name is still refused", noName.missing.length === 1);

  // ── A CONDITION WITHDRAWS A QUESTION, through the SHARED evaluator.
  const guardian = requiredInformationOf({
    fields: { representative_name: { level: "required", condition: { when: "_is_child", equals: true } } },
  });
  const child = resolveIntake(guardian, { given_name: "A", family_name: "B", birth_date: "2020-01-01" }, today);
  ok("a guardian is required for a child", child.missing.some(m => m.field.field_key === "representative_name"));
  const adult = resolveIntake(guardian, { given_name: "A", family_name: "B", birth_date: "1980-01-01" }, today);
  ok("CONTROL: the same rule asks an adult for no guardian",
    adult.missing.length === 0 && !adult.asked.some(a => a.field.field_key === "representative_name"));
  const unknownAge = resolveIntake(guardian, { given_name: "A", family_name: "B" }, today);
  ok("CONTROL: somebody whose age nobody asked for is not assumed to be an adult",
    unknownAge.asked.some(a => a.field.field_key === "representative_name"));

  // ── EVERY FIELD LANDS IN A REAL COLUMN. This is what stops a question being invented.
  ok("every booking question names a column on the booking record",
    BOOKING_INTAKE_FIELDS.every(f => typeof f.column === "string" && f.column.length > 0));
  ok("exactly two questions are always required",
    INTAKE_FIELDS_ALWAYS_REQUIRED.length === 2);
  ok("no question offers a document upload",
    !BOOKING_INTAKE_FIELDS.some(f => /document|upload|attach|referral letter/i.test(f.label)));

  ok("the card line names the questions rather than counting them",
    plainRequiredInformation(req).includes("Date of birth"));
}

function sectionThree() {
  console.log("\n3. THE WALK-IN CUTOFF AND THE QUEUE -- pure");

  // ⚠ THE ENGINE'S OWN FUNCTION, NOT A RESTATEMENT OF IT. The first draft of this section defined the
  // arithmetic here as a local lambda -- which asserted the harness's copy of the rule and would have
  // stayed green through any change to the engine's. That is the vacuity class this file's header is
  // about, and it was caught by asking "what would I break to make this fail?".
  const bites = (endsMinute: number, cutoff: number, minute: number) =>
    walkInCutoff({ sessionEndsMinute: endsMinute, cutoffMinutes: cutoff, minuteOfDay: minute }).bites;
  ok("a walk-in inside the cutoff window is refused", bites(720, 60, 665) === true);
  ok("a walk-in exactly at the cutoff is refused", bites(720, 60, 660) === true);
  ok("CONTROL: a walk-in one minute before the cutoff is not", bites(720, 60, 659) === false);
  ok("CONTROL: a walk-in early in the session is not", bites(720, 60, 485) === false);
  ok("CONTROL: no cutoff set applies to nothing",
    walkInCutoff({ sessionEndsMinute: 720, cutoffMinutes: null, minuteOfDay: 719 }).applies === false);
  ok("CONTROL: a time no session covers has nothing to measure a cutoff from",
    walkInCutoff({ sessionEndsMinute: null, cutoffMinutes: 60, minuteOfDay: 719 }).bites === false);
  ok("the last time a walk-in is taken is computed, so a refusal can name it",
    walkInCutoff({ sessionEndsMinute: 720, cutoffMinutes: 90, minuteOfDay: 700 }).lastWalkInMinute === 630);

  // ⚠ AND BOTH ENGINES CALL IT. A shared function that only one caller uses is not shared.
  const rulesSrc = codeOf("src/lib/practice/booking-rules.ts");
  ok("checkPlacement and evaluateBooking both decide the cutoff with the same function",
    codeOf("src/lib/practice/scheduling.ts").includes("walkInCutoff({")
    && rulesSrc.includes("walkInCutoff({"));

  ok("the card line states the cutoff in the practitioner's words",
    plainWalkIn({ dailyLimit: 6, cutoffMinutes: 60, queuePolicy: "first_come" })
      .includes("none in the last 1 hour of a session"));
  ok("...and states which order the waiting room is in",
    plainWalkIn({ dailyLimit: null, cutoffMinutes: null, queuePolicy: "priority_then_first_come" })
      .includes("priority, then arrival"));
  ok("CONTROL: no cutoff prints no cutoff clause",
    !plainWalkIn({ dailyLimit: 6, cutoffMinutes: null, queuePolicy: "first_come" }).includes("last"));

  // ⚠ THE OVERRIDE LISTS ARE DISJOINT BY CONSTRUCTION. A lifted walk-in code must not reach the window.
  const WINDOW = ["LEAD_TIME", "BEYOND_HORIZON"];
  ok("no walk-in override code is also a window override code",
    !WALK_IN_OVERRIDABLE_CODES.some(c => WINDOW.includes(c)));
  const schedulingSrc = codeOf("src/lib/practice/scheduling.ts");
  ok("checkPlacement takes the two override lists as SEPARATE arguments",
    schedulingSrc.includes("walkInOverridden?: string[]") && schedulingSrc.includes("windowOverridden?: string[]"));
  ok("the walk-in list never reaches the double-booking check",
    !/walkInLifted[\s\S]{0,400}DOUBLE_BOOKED/.test(schedulingSrc));
}

function sectionFour() {
  console.log("\n4. THE CANCELLATION NOTICE -- who it refuses, and who it never refuses");

  const line = plainCancellation({
    noticeMinutes: 1440, rescheduleNoticeMinutes: null,
    selfCancelAllowed: true, selfRescheduleAllowed: true,
    dnaThreshold: 3, dnaAction: "block_self_booking", waitingListEnabled: true,
  });
  // ⚠ THE EXACT SENTENCE, INCLUDING THE APOSTROPHE. This assertion found "1 day' notice" in the first
  // run -- a possessive built from the wrong count. A looser check on "day" would have passed it.
  ok("the card says patients may cancel up to the notice, in correct English",
    line.includes("up to 1 day's notice before it"), line);
  ok("the card says moving follows the same notice when none is set separately",
    line.includes("same notice"));
  // ⚠ THE SENTENCE A PRACTITIONER NEEDS MOST, and the one the old caption got wrong.
  ok("the card states plainly that the practice is never refused by it",
    line.includes("You are never refused by any of this"));
  ok("the card states the DNA consequence", line.includes("must ring you"));
  ok("the card states the waiting list", line.includes("waiting list"));

  const separate = plainCancellation({
    noticeMinutes: 60, rescheduleNoticeMinutes: 240,
    selfCancelAllowed: true, selfRescheduleAllowed: true,
    dnaThreshold: null, dnaAction: "none", waitingListEnabled: false,
  });
  ok("a separate reschedule notice is stated separately", separate.includes("4 hours' notice before it"));
  const shut = plainCancellation({
    noticeMinutes: 0, rescheduleNoticeMinutes: null,
    selfCancelAllowed: false, selfRescheduleAllowed: false,
    dnaThreshold: null, dnaAction: "none", waitingListEnabled: false,
  });
  ok("self-service switched off says so", shut.includes("cannot cancel or move"));

  // ⚠ THE PRACTICE-SIDE ENGINE HAS NO NOTICE REFUSAL IN IT AT ALL. Asserted over the source with its
  // comments stripped, because the reasoning FOR not having one is written in those comments and would
  // otherwise match.
  const cancelSrc = codeOf("src/lib/practice/booking-cancellation.ts");
  ok("cancelBooking contains no notice-period refusal",
    !/CANCELLATION_NOTICE|NOTICE_PASSED|cannot be cancelled.*notice/i.test(cancelSrc));
  ok("...and it does record whether the cancellation was inside the notice",
    cancelSrc.includes("cancelled_within_notice"));

  // The waiting list's promise, in one place.
  ok("the waiting-list note says nothing is sent",
    /nothing in this product sends a message/i.test(WAITING_LIST_CONTACT_NOTE)
    && /ring them/i.test(WAITING_LIST_CONTACT_NOTE));

  // ⚠ THE TWO SETTINGS WHOSE OPERATIONAL SCREEN DOES NOT EXIST SAY SO, AND THE SENTENCE IS BESIDE THE
  // SWITCH. Both are stored and enforced and reachable over the API; neither has a board or a control
  // for day-to-day use. A switch that silently gives a practitioner nothing to press is the same defect
  // as a caption that says NOT BUILT over a working control, in the other direction.
  ok("the waiting-list switch says there is no board for it yet",
    /no waiting-list board yet/i.test(WAITING_LIST_NO_SCREEN_NOTE)
    && /not something this screen can do today/i.test(WAITING_LIST_NO_SCREEN_NOTE));
  ok("the queue-priority setting says the waiting room still shows arrival order",
    /no control in the waiting room/i.test(QUEUE_PRIORITY_NO_SCREEN_NOTE)
    && /arrival order/i.test(QUEUE_PRIORITY_NO_SCREEN_NOTE));
  // ⚠ THE JSX INTERPOLATION, NOT THE BARE NAME. The first version of this assertion scanned for the
  // constant's NAME, which the import line satisfies -- so deleting the sentence from the screen left it
  // green. Caught by breaking it. A negative scan has to be aimed at the thing that would actually go.
  const workspaceSrc = codeOf("src/app/practice/(shell)/setup/availability-booking/RuleWorkspace.tsx")
    .replace(/^import[\s\S]*?from "[^"]+";$/gm, "");
  ok("...and both sentences are actually drawn beside their switches",
    workspaceSrc.includes("{WAITING_LIST_NO_SCREEN_NOTE}")
    && workspaceSrc.includes("{QUEUE_PRIORITY_NO_SCREEN_NOTE}"));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// GROUP B -- END TO END. Needs migrations 268 and 269.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-sections-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: OWNER, correlation_id: CORR, workspace_id: null }, payload("Sections Harness"));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_waiting_list_entry").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_request").delete().eq("workspace_id", w.id);
    await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
    await admin.from("practice_arrival").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
    await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_rule_version").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  await admin.from("practice_audit_event").delete().eq("actor_id", OWNER);
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

/** An admin client on which ONE table cannot be read. The only way to test "a failed read is not zero". */
function adminWithUnreadable(real: any, table: string) {
  const failing = (): any => {
    const p: any = new Proxy({} as any, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: any) => resolve({ data: null, error: { message: "simulated read failure", code: "XX000" }, count: null });
        return () => p;
      },
    });
    return p;
  };
  return new Proxy(real, {
    get(t: any, prop: string) {
      if (prop === "from") return (name: string) => (name === table ? failing() : t.from(name));
      const v = t[prop];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** Minutes-of-day to an ISO instant in the practice's own day. */
const at = (date: string, minute: number) =>
  new Date(Date.parse(zonedDayRange(date, TZ).startIso) + minute * 60000).toISOString();

/** The next occurrence of a weekday, so a session fixture is never on today's already-passed hours. */
function nextWeekday(from: string, weekday: number): string {
  let d = Date.parse(`${from}T12:00:00Z`);
  for (let i = 0; i < 8; i++) {
    const wd = ((new Date(d).getUTCDay() + 6) % 7) + 1;
    if (wd === weekday && i > 0) return new Date(d).toISOString().slice(0, 10);
    d += 86400000;
  }
  return from;
}

async function endToEnd(): Promise<void> {
  const workspaceId = await provision();
  const resolved = await resolveWorkspaceContext(admin, OWNER, workspaceId);
  if (!resolved.ok) throw new Error(`no workspace context: ${resolved.reason}`);
  const ctx: WorkspaceContext = resolved.ctx;

  const today = practiceToday(TZ);
  const date = nextWeekday(today, 3); // a Wednesday, always in the future
  const weekday = 3;

  const session = await saveSession(admin, ctx, {
    weekday, startsMinute: 480, endsMinute: 720,
    sessionName: "Wednesday walk-in clinic", slotKind: "clinic",
    walkInsAllowed: true, walkInLimit: 10,
    actorId: OWNER, correlationId: CORR,
  } as any);
  ok("a session that takes walk-ins was created", session.ok === true,
    session.ok ? "" : (session as any).message);

  // ══ 5. A REQUIRED BOOKING FIELD IS ENFORCED SERVER-SIDE ═══════════════════════════════════════
  console.log("\n5. END TO END -- a required booking field, enforced past the form");

  const rule = await saveBookingRule(admin, ctx, {
    name: "Walk-in clinic rule", status: "active", priority: 10,
    walkInDailyLimit: 20,
    walkInCutoffMinutes: 60,
    requiredInformation: { fields: { birth_date: { level: "required" }, reason_for_visit: { level: "off" } } },
    cancellationNoticeMinutes: 1440,
    dnaThreshold: 2, dnaAction: "require_approval",
    waitingListEnabled: true,
    actorId: OWNER, correlationId: CORR,
  });
  ok("a rule carrying all four new sections was saved", rule.ok === true,
    rule.ok ? "" : (rule as any).message);
  if (!rule.ok) return;

  // ⚠ THE VERSION SNAPSHOT MUST CARRY THEM, which is why required_information is a column.
  const edited = await saveBookingRule(admin, ctx, {
    ruleId: rule.data.id, walkInCutoffMinutes: 90, reason: "clinic runs late",
    actorId: OWNER, correlationId: CORR,
  });
  ok("editing a new-section field bumps the version", edited.ok === true && edited.data.version === 2);
  const { data: snap } = await admin.from("practice_booking_rule_version")
    .select("payload").eq("rule_id", rule.data.id).eq("version", 1).maybeSingle();
  ok("the version snapshot photographed the required-information map",
    !!(snap?.payload as any)?.required_information?.fields?.birth_date,
    JSON.stringify((snap?.payload as any)?.required_information ?? null));

  // The refusal, through the ENGINE, with the form bypassed entirely.
  const noDob = await evaluateBooking(admin, ctx, {
    channel: "patient_self", appointmentType: "new_consultation",
    scheduledAt: at(date, 540),
    intake: { given_name: "Amina", family_name: "Nakato", reason_for_visit: "cough" },
  });
  ok("a patient booking with no date of birth is refused by the server",
    noDob.ok && noDob.data.refusals.some(r => r.code === "INTAKE_INCOMPLETE"),
    noDob.ok ? JSON.stringify(noDob.data.refusals) : (noDob as any).message);
  ok("...and that refusal is NOT overridable",
    noDob.ok === true && noDob.data.refusals.find(r => r.code === "INTAKE_INCOMPLETE")?.overridable === false);
  ok("...and the answer to the withdrawn question was thrown away",
    noDob.ok === true && noDob.data.intake?.values.reason_for_visit === undefined);
  ok("...and the discard is reported in a sentence",
    noDob.ok === true && (noDob.data.intake?.discardNotice ?? "").includes("Reason for the visit"));

  const withDob = await evaluateBooking(admin, ctx, {
    channel: "patient_self", appointmentType: "new_consultation",
    scheduledAt: at(date, 540),
    intake: { given_name: "Amina", family_name: "Nakato", birth_date: "1990-04-02" },
  });
  ok("CONTROL: the same booking with a date of birth is not refused for the intake",
    withDob.ok === true && !withDob.data.refusals.some(r => r.code === "INTAKE_INCOMPLETE"));

  // ⚠ AND A PRACTITIONER IS NOT HELD TO IT. The section is about what a PATIENT is asked.
  const practitioner = await evaluateBooking(admin, ctx, {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(date, 540),
  });
  ok("CONTROL: a practitioner's own booking is not refused for a blank patient question",
    practitioner.ok === true && !practitioner.data.refusals.some(r => r.code === "INTAKE_INCOMPLETE")
    && practitioner.data.intake === null);

  // ══ 6. THE CUTOFF, AND THE EMERGENCY OVERRIDE ════════════════════════════════════════════════
  console.log("\n6. END TO END -- the walk-in cutoff, and lifting it");

  // The rule now closes walk-ins 90 minutes before the session's 12:00 end, so 10:30 onwards is shut.
  const lateWalkIn = await bookUnderRules(admin, ctx, {
    channel: "walk_in", patientName: "Late Arrival", appointmentType: "walk_in",
    scheduledAt: at(date, 660), actorId: OWNER, correlationId: CORR,
  });
  ok("a walk-in inside the cutoff is refused", lateWalkIn.ok === false
    && (lateWalkIn as any).code === "WALK_IN_CUTOFF", JSON.stringify(lateWalkIn));
  // ⚠ THE TIME, NOT A DISTANCE. "Inside that window by 30 minutes" makes a practitioner do arithmetic
  // to learn when they COULD have booked. This assertion is what found that the two engines spelled
  // this refusal differently and that the useful spelling was the one no caller ever reached.
  ok("...and the refusal names the last time a walk-in is taken",
    lateWalkIn.ok === false && /10:30/.test((lateWalkIn as any).message), (lateWalkIn as any).message);

  // ⚠ AND THE OTHER ENGINE'S MESSAGE SAYS THE SAME TIME. checkPlacement refuses on the same ground when
  // a caller reaches it without the rules engine -- bookAppointment has taken walk-ins since Phase 1 --
  // so a harness that only exercised bookUnderRules would leave that path free to drift.
  const direct = await checkPlacement(admin, {
    workspaceId, startMs: Date.parse(at(date, 660)), endMs: Date.parse(at(date, 680)),
    locationId: null, appointmentType: "walk_in", allowOverlap: false,
  });
  ok("checkPlacement refuses the same walk-in on the same ground",
    direct.ok === false && (direct as any).code === "WALK_IN_CUTOFF", JSON.stringify(direct));
  ok("...and names the same time as the rules engine does",
    direct.ok === false && /10:30/.test((direct as any).message), (direct as any).message);

  // ⚠ THE TWO CLOCK FORMATTERS MUST AGREE ABOUT EVERY MINUTE OF A DAY. booking-rule-constants.ts keeps
  // its own because it may not import a module that touches the database; that is a real reason and it
  // is also a real chance to drift, so the equivalence is checked rather than trusted.
  let clocksAgree = true;
  for (let m = 0; m < 1440; m++) if (minuteOfDayAsClock(m) !== hhmm(m)) { clocksAgree = false; break; }
  ok("the pure clock formatter and availability-config's agree on all 1440 minutes", clocksAgree);

  const earlyWalkIn = await bookUnderRules(admin, ctx, {
    channel: "walk_in", patientName: "Early Arrival", appointmentType: "walk_in",
    scheduledAt: at(date, 500), actorId: OWNER, correlationId: CORR,
  });
  ok("CONTROL: a walk-in well before the cutoff is booked", earlyWalkIn.ok === true,
    earlyWalkIn.ok ? "" : (earlyWalkIn as any).message);

  const overridden = await bookUnderRules(admin, ctx, {
    channel: "walk_in", patientName: "Emergency Arrival", appointmentType: "walk_in",
    scheduledAt: at(date, 665), override: { reason: "collapsed at reception" },
    actorId: OWNER, correlationId: CORR,
  });
  ok("an authorised override with a reason lifts the cutoff", overridden.ok === true,
    overridden.ok ? "" : (overridden as any).message);
  ok("...and records exactly which refusal it lifted",
    overridden.ok === true && overridden.data.overridden.includes("WALK_IN_CUTOFF"));

  const { data: overrideRows } = await admin.from("practice_audit_event")
    .select("id, payload").eq("workspace_id", workspaceId)
    .eq("event_type", "practice.booking_rule_overridden");
  ok("...and the override is in the audit trail with its reason",
    ((overrideRows ?? []) as any[]).some(r => String(r.payload?.reason ?? "").includes("collapsed")));

  const noReason = await bookUnderRules(admin, ctx, {
    channel: "walk_in", patientName: "No Reason", appointmentType: "walk_in",
    scheduledAt: at(date, 668), override: { reason: "x" },
    actorId: OWNER, correlationId: CORR,
  });
  ok("CONTROL: an override with no real reason is refused", noReason.ok === false
    && (noReason as any).code === "OVERRIDE_REASON_REQUIRED");

  // ══ 7. THE WAITING LIST ══════════════════════════════════════════════════════════════════════
  console.log("\n7. END TO END -- the waiting list stores, offers and delivers nothing");

  const added = await addToWaitingList(admin, ctx, {
    patientName: "Grace Auma", appointmentType: "new_consultation",
    earliestDate: date, note: "any morning",
    actorId: OWNER, correlationId: CORR,
  });
  ok("somebody can be put on the waiting list", added.ok === true,
    added.ok ? "" : (added as any).message);
  if (!added.ok) return;
  ok("...and adding says plainly that nothing tells them",
    added.data.contactNote === WAITING_LIST_CONTACT_NOTE);

  const blank = await addToWaitingList(admin, ctx, {
    patientName: "   ", appointmentType: "new_consultation", actorId: OWNER, correlationId: CORR,
  });
  ok("CONTROL: a name of spaces is not a name", blank.ok === false);

  const offered = await offerWaitingListEntry(admin, ctx, {
    entryId: added.data.id, offeredStart: at(date, 540), actorId: OWNER, correlationId: CORR,
  });
  ok("a freed time can be offered", offered.ok === true, offered.ok ? "" : (offered as any).message);
  ok("...and the offer says nothing was sent",
    offered.ok === true && offered.data.contactNote === WAITING_LIST_CONTACT_NOTE);

  const { data: offerAudit } = await admin.from("practice_audit_event")
    .select("payload").eq("workspace_id", workspaceId).eq("event_type", "practice.waiting_list_offered");
  ok("...and the audit record says delivered: false",
    ((offerAudit ?? []) as any[]).every(r => r.payload?.delivered === false));

  const twice = await offerWaitingListEntry(admin, ctx, {
    entryId: added.data.id, offeredStart: at(date, 560), actorId: OWNER, correlationId: CORR,
  });
  ok("CONTROL: the same entry cannot be offered twice", twice.ok === false
    && (twice as any).code === "NOT_WAITING");

  const closedBad = await closeWaitingListEntry(admin, ctx, {
    entryId: added.data.id, status: "booked", actorId: OWNER, correlationId: CORR,
  });
  ok("CONTROL: an entry marked booked must name the appointment", closedBad.ok === false);

  const closed = await closeWaitingListEntry(admin, ctx, {
    entryId: added.data.id, status: "withdrawn", actorId: OWNER, correlationId: CORR,
  });
  ok("an entry can be closed", closed.ok === true, closed.ok ? "" : (closed as any).message);

  const live = await listWaitingList(admin, ctx);
  ok("a closed entry leaves the live list",
    live.state === "ok" && !live.value.some(e => e.id === added.data.id));

  // ══ 8. A FAILED READ IS NEVER A ZERO ═════════════════════════════════════════════════════════
  console.log("\n8. END TO END -- a failed read is never a zero");

  forgetWaitingListStore();
  const blindList = await listWaitingList(adminWithUnreadable(admin, "practice_waiting_list_entry"), ctx);
  ok("an unreadable waiting list is unreadable, never empty", blindList.state === "unreadable",
    JSON.stringify(blindList));
  forgetWaitingListStore();
  ok("CONTROL: the readable list is readable", (await listWaitingList(admin, ctx)).state === "ok");

  const blindWalkIn = await evaluateBooking(
    adminWithUnreadable(admin, "practice_availability_template"), ctx,
    { channel: "walk_in", appointmentType: "walk_in", scheduledAt: at(date, 500) });
  ok("an unreadable session is a refusal, not a free place", blindWalkIn.ok === false,
    JSON.stringify(blindWalkIn));

  // ══ 9. DNA, AND WHAT A CANCELLATION RECORDS ══════════════════════════════════════════════════
  console.log("\n9. END TO END -- missed appointments, and what a cancellation records");

  const { data: patient } = await admin.from("practice_patient").insert({
    workspace_id: workspaceId, display_name: "Repeat Misser", status: "active",
  }).select("id").maybeSingle();

  // ⚠ THE FIXTURE HAS TO CREATE THE LATE CANCELLATION, NOT MERELY ASSERT ONE.
  //
  // The first version of this block booked into the session fixture -- the NEXT Wednesday, up to eight
  // days out -- and then asserted `withinNotice === true` against a 24-hour notice period. The engine
  // correctly answered false, because a cancellation 80 hours before an appointment is not a late one.
  // The assertion was wrong and the engine was right, and relaxing the assertion to `=== false` would
  // have made it agree with the behaviour while testing nothing about the notice period at all.
  //
  // So there are now TWO cancellations, and the pair is what makes either of them mean anything: one
  // genuinely inside the notice window and one genuinely outside it.
  const soonMs = Date.now() + 2 * 3600000;
  const late = await bookUnderRules(admin, ctx, {
    channel: "practitioner", patientId: patient?.id, appointmentType: "new_consultation",
    scheduledAt: new Date(soonMs).toISOString(), actorId: OWNER, correlationId: CORR,
  });
  ok("a booking two hours from now was made", late.ok === true,
    late.ok ? "" : (late as any).message);
  if (!late.ok) return;

  const cancelled = await cancelBooking(admin, ctx, {
    appointmentId: late.data.appointmentId, reason: "clinician called to theatre",
    actorId: OWNER, correlationId: CORR,
  });
  ok("the practice can cancel its own booking two hours before it", cancelled.ok === true,
    cancelled.ok ? "" : (cancelled as any).message);
  // ⚠ THE POINT OF THE PAIR: it IS inside the 24-hour notice, it is recorded as inside it, and the
  // practice is not refused. A notice period is a promise to patients, not a rule against the practice.
  ok("...and it is recorded as inside the practice's own 24-hour notice",
    cancelled.ok === true && cancelled.data.withinNotice === true,
    cancelled.ok ? `withinNotice=${cancelled.data.withinNotice} notice=${cancelled.data.noticeMinutes}` : "");
  ok("...and the reason is stored on the appointment",
    cancelled.ok === true && cancelled.data.reasonStored === true,
    cancelled.ok ? (cancelled.data.reasonNote ?? "") : "");
  const { data: cancelledRow } = await admin.from("practice_appointment")
    .select("cancellation_reason, cancelled_by_kind, cancelled_within_notice, cancelled_at")
    .eq("id", late.data.appointmentId).maybeSingle();
  ok("...in a column a report can group by",
    cancelledRow?.cancellation_reason === "clinician called to theatre"
    && cancelledRow?.cancelled_by_kind === "practice"
    && cancelledRow?.cancelled_within_notice === true
    && !!cancelledRow?.cancelled_at, JSON.stringify(cancelledRow));

  // ⚠ THE CONTROL, AND WITHOUT IT THE ASSERTION ABOVE IS SATISFIED BY A COLUMN HARD-WIRED TO TRUE.
  const early = await bookUnderRules(admin, ctx, {
    channel: "practitioner", patientId: patient?.id, appointmentType: "new_consultation",
    scheduledAt: at(date, 520), actorId: OWNER, correlationId: CORR,
  });
  ok("a booking several days out was made", early.ok === true,
    early.ok ? "" : (early as any).message);
  if (early.ok) {
    const cancelledEarly = await cancelBooking(admin, ctx, {
      appointmentId: early.data.appointmentId, reason: "patient asked to move it",
      actorId: OWNER, correlationId: CORR,
    });
    ok("CONTROL: cancelling days ahead is recorded as OUTSIDE the notice",
      cancelledEarly.ok === true && cancelledEarly.data.withinNotice === false,
      cancelledEarly.ok ? String(cancelledEarly.data.withinNotice) : "");
    const { data: earlyRow } = await admin.from("practice_appointment")
      .select("cancelled_within_notice").eq("id", early.data.appointmentId).maybeSingle();
    ok("CONTROL: ...and the column says so too",
      earlyRow?.cancelled_within_notice === false, JSON.stringify(earlyRow));
  }

  // Two misses, and the rule's threshold is two.
  for (const minute of [530, 535]) {
    const booked = await bookUnderRules(admin, ctx, {
      channel: "practitioner", patientId: patient?.id, appointmentType: "new_consultation",
      scheduledAt: at(date, minute), allowOverlap: true, actorId: OWNER, correlationId: CORR,
    });
    if (!booked.ok) { ok(`a booking at minute ${minute} was made`, false, (booked as any).message); continue; }
    await admin.from("practice_appointment").update({ status: "CONFIRMED" }).eq("id", booked.data.appointmentId);
    const missed = await recordNoShow(admin, ctx, {
      appointmentId: booked.data.appointmentId, actorId: OWNER, correlationId: CORR,
    });
    ok(`a missed appointment at minute ${minute} is recorded`, missed.ok === true,
      missed.ok ? "" : (missed as any).message);
  }

  const afterMisses = await evaluateBooking(admin, ctx, {
    channel: "practitioner", appointmentType: "new_consultation",
    scheduledAt: at(date, 600), patientId: patient?.id,
  });
  ok("a patient over the missed-appointment threshold books as a request",
    afterMisses.ok === true && afterMisses.data.initialStatus === "REQUESTED",
    afterMisses.ok ? JSON.stringify(afterMisses.data.dna) : "");
  ok("...and the reason is said in words",
    afterMisses.ok === true && afterMisses.data.notes.some(n => /missed/.test(n)));

  const { data: fresh } = await admin.from("practice_patient").insert({
    workspace_id: workspaceId, display_name: "Never Missed", status: "active",
  }).select("id").maybeSingle();
  const cleanPatient = await evaluateBooking(admin, ctx, {
    channel: "practitioner", appointmentType: "new_consultation",
    scheduledAt: at(date, 610), patientId: fresh?.id,
  });
  ok("CONTROL: a patient who has missed nothing is confirmed as usual",
    cleanPatient.ok === true && cleanPatient.data.initialStatus === "CONFIRMED");

  // The card is what a practitioner reads. It must carry all of it.
  const cards = await listBookingRules(admin, ctx);
  ok("the rule card reports the sections as configurable",
    cards.state === "ok" && cards.value.every(c => c.sectionsConfigurable === true));
  ok("...and carries the walk-in, required-information and cancellation lines",
    cards.state === "ok" && cards.value.some(c =>
      c.walkInLine.includes("90 minutes") && c.requiredInformationLine.includes("Date of birth")
      && c.cancellationLine.includes("You are never refused")));

  // ⚠ NOTHING ON THE CARD IS A FUNCTION. A method type-checks, passes eslint, passes every harness, and
  // kills the page at runtime when it crosses to a client component. This walks the payload.
  const walk = (v: any, path: string): string[] => {
    if (typeof v === "function") return [path];
    if (Array.isArray(v)) return v.flatMap((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => walk(x, `${path}.${k}`));
    return [];
  };
  const fns = cards.state === "ok" ? walk(cards.value, "cards") : [];
  ok("no field of a rule card is a function", fns.length === 0, fns.join(", "));
}

async function main() {
  console.log("CPR-V5-007 s7.2 -- required information, walk-ins, cancellations. Migrations 268/269.\n");
  console.log("GROUP A -- PURE. These run whether or not the migrations are applied.");

  sectionOne();
  sectionTwo();
  sectionThree();
  sectionFour();

  console.log("\nGROUP B -- END TO END. Probing for the migrations.");
  forgetBookingRuleExtension();
  forgetWaitingListStore();
  const has268 = await bookingRuleExtensionPresent(admin);
  const has269 = await waitingListStorePresent(admin);
  console.log(`  migration 268 (booking rule sections): ${has268 === true ? "APPLIED" : has268 === false ? "NOT APPLIED" : "COULD NOT BE CHECKED"}`);
  console.log(`  migration 269 (waiting list, queue, cancellation record): ${has269 === true ? "APPLIED" : has269 === false ? "NOT APPLIED" : "COULD NOT BE CHECKED"}`);

  if (has268 !== true || has269 !== true) {
    console.log("");
    console.log("  ==================================================================================");
    console.log("  GROUP B DID NOT RUN, AND THAT IS NOT A PASS.");
    console.log("");
    console.log(`    Apply "${BOOKING_RULE_MIGRATION_268}"`);
    console.log("    and the waiting-list migration alongside it, then run this script again.");
    console.log("");
    console.log("  Everything the code does END TO END -- the server-side refusal for a missing");
    console.log("  required field, the walk-in cutoff, the emergency override, the waiting list and");
    console.log("  what a cancellation records -- is UNPROVEN until those files are applied. The pure");
    console.log("  assertions above prove the decision logic and nothing about the round trip.");
    console.log("  ==================================================================================");
    console.log("");
    console.log(`GROUP A: ${pass} passed, ${fails.length} failed.`);
    for (const f of fails) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }

  try {
    await cleanup();
    await endToEnd();
  } finally {
    await cleanup();
  }

  console.log(`\n${pass} passed, ${fails.length} failed.`);
  for (const f of fails) console.log(`  FAILED: ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(async e => {
  console.error(e);
  try { await cleanup(); } catch { /* the failure above is the one worth reporting */ }
  process.exit(1);
});
