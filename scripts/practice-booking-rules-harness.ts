/**
 * CPR-V5-007 PHASE 3 -- the booking rules engine. Migration 244.
 *
 * WHAT IT PROVES:
 *   1. s11's SPECIFICITY LADDER, over a fixture where FOUR rules match ONE booking at four different
 *      rungs. The winner is asserted BY NAME at every rung, and the ladder is walked down by archiving
 *      the winner and asserting the next one takes over -- a fixture with one matching rule could not
 *      test the ladder at all, and a count assertion is true of a dozen wrong implementations.
 *   2. s11's CONFLICT: at equal specificity AND equal priority, activation is BLOCKED. Both directions
 *      (authoring refuses, and evaluation refuses if two tied rules are in force anyway), each with a
 *      control -- including two rules that are equally specific and equally important and are NOT a
 *      conflict because their scopes can never meet.
 *   3. AC-13: every booking stores the rule id AND THE VERSION. Proven by making a booking, EDITING the
 *      rule, and showing the booking still names version 1 -- and that reading it back returns what the
 *      rule SAID THEN, not what it says now. The edit changes the confirmation mode, so the two
 *      versions produce visibly different bookings.
 *   4. AC-07 CAPACITY, PER SESSION: total, per-type, urgent reserve and overbooking, with a control
 *      proving the morning session filling up does not close the afternoon one.
 *   5. s7.4's reserve-cannot-exceed-total refused by the ENGINE and by the DATABASE, each with a control.
 *   6. AC-08's follow-up due window, and AC-14's override: a reason is required, the record is written
 *      before the booking, a second override appends rather than replacing, and a conflict cannot be
 *      overridden at all.
 *   7. AC-06's six channels: distinct rules per channel decide distinct bookings BY NAME, and a channel
 *      with no door refuses the booking with the phase named while the rule is still storable.
 *   8. A FAILED READ IS NEVER A ZERO -- five different unreadable tables, five refusals, five controls.
 *   9. EVALUATION IS SERVER-SIDE: a request that names a rule is not believed.
 *  10. Permission (s14) and cross-practice isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-booking-rules-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { zonedDayRange, dueDateFrom, practiceToday } from "../src/lib/practice/practice-time";
import { saveSession } from "../src/lib/practice/practice-sessions";
import {
  listBookingRules, saveBookingRule, setRuleStatus, ruleVersionHistory,
  evaluateBooking, bookUnderRules, explainAppointment, bookingRulesWorkspace,
  type BookingRuleCard,
} from "../src/lib/practice/booking-rules";
import { specificityOf, specificityRung } from "../src/lib/practice/booking-rule-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000eb001";
const OTHER = "00000000-0000-4000-8000-0000000eb002";
const TZ = "Africa/Kampala";
const CORR = "harness-rules";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-rules-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_affected_booking_action").delete().eq("workspace_id", w.id);
      await admin.from("practice_follow_up").delete().eq("workspace_id", w.id);
      await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
      await admin.from("practice_arrival").delete().eq("workspace_id", w.id);
      await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
      await admin.from("practice_patient").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_exception").delete().eq("workspace_id", w.id);
      await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
      await admin.from("practice_booking_rule_version").delete().eq("workspace_id", w.id);
      await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
      await admin.from("practice_workspace").delete().eq("id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

/**
 * An admin client on which one table cannot be read.
 *
 * ⚠ THE ONLY WAY TO TEST "A FAILED READ IS NEVER A ZERO". It is a claim about what happens when a query
 * FAILS, and a working database never produces one -- so an assertion that only ever sees a healthy
 * table asserts nothing about the branch it is aimed at.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function adminWithUnreadable(real: any, table: string) {
  const failing = (): any => {
    const p: any = new Proxy({} as any, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: any) => resolve({ data: null, error: { message: "simulated read failure" }, count: null });
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

const ACT = { actorId: OWNER, correlationId: CORR };
/** An instant, expressed as a minute of a given date IN THE PRACTICE'S OWN CLOCK. */
const at = (date: string, minute: number) =>
  new Date(Date.parse(zonedDayRange(date, TZ).startIso) + minute * 60000).toISOString();
const weekdayOf = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const nextWeekday = (from: string, weekday: number, minDays: number) => {
  for (let d = minDays; d < minDays + 14; d++) {
    const date = dueDateFrom(from, d);
    if (weekdayOf(date) === weekday) return date;
  }
  throw new Error(`no weekday ${weekday} found`);
};

async function main() {
  console.log("\n=== CPR-V5-007 PHASE 3: THE BOOKING RULES ENGINE (migration 244) ===\n");

  // ---- 0. MIGRATION GATE -------------------------------------------------------------------------
  //
  // ⚠ PROBES COLUMNS MIGRATION 244 ADDS AND KEEPS. A gate in this area recently probed a column a LATER
  // migration dropped and then reported the wrong migration missing; the fix is to probe the
  // load-bearing shape -- the version, the version table, and the pair on an appointment.
  const probeRule = await admin.from("practice_booking_rule")
    .select("id, name, status, priority, version, session_template_id, channel, capacity_total, capacity_urgent_reserve, patient_eligibility, confirmation_mode, follow_up_early_days").limit(1);
  const probeVersions = await admin.from("practice_booking_rule_version")
    .select("id, rule_id, version, payload, reason").limit(1);
  const probeAppt = await admin.from("practice_appointment")
    .select("id, applied_rule_id, applied_rule_version").limit(1);
  if (probeRule.error || probeVersions.error || probeAppt.error) {
    console.error("\n  run 244\n");
    console.error(`  (${probeRule.error?.message ?? probeVersions.error?.message ?? probeAppt.error?.message})`);
    process.exit(1);
  }
  console.log("  migration 244 is applied.\n");

  await cleanup();

  const wsA = await provision(OWNER, "Dr Rules A", "a");
  const wsB = await provision(OTHER, "Dr Rules B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");
  const A: WorkspaceContext = ctxA.ctx;
  const B: WorkspaceContext = ctxB.ctx;

  ok("0a the provisioned owner holds BOTH capabilities s14 separates -- writing a rule and making a booking",
    A.capabilities.includes("practice.settings.manage") && A.capabilities.includes("appointment.manage"),
    JSON.stringify(A.capabilities));

  const { data: locRows, error: locErr } = await admin.from("practice_location").insert([
    { workspace_id: wsA, name: "TMR International Hospital", type: "hospital", active: true },
    { workspace_id: wsA, name: "Kololo Consulting Rooms", type: "clinic", active: true },
    { workspace_id: wsA, name: "Ntinda Capacity Clinic", type: "clinic", active: true },
    { workspace_id: wsA, name: "Bugolobi Annexe", type: "clinic", active: true },
    { workspace_id: wsA, name: "Muyenga Rooms", type: "clinic", active: true },
  ]).select("id, name");
  if (locErr || !locRows) throw new Error(`location fixture failed: ${locErr?.message}`);
  const L = (prefix: string) => locRows.find(l => l.name.startsWith(prefix))!.id as string;
  const LOC_MAIN = L("TMR"), LOC_OTHER = L("Kololo"), LOC_CAP = L("Ntinda"),
    LOC_ELIG = L("Bugolobi"), LOC_NE = L("Muyenga");

  const today = practiceToday(TZ);
  const FRI_A = nextWeekday(today, 5, 21);
  const THU_C = nextWeekday(today, 4, 45);
  const DUE = dueDateFrom(today, 90);
  const D_CH = dueDateFrom(today, 120);
  const D_EL = dueDateFrom(today, 150);
  const D_NE = dueDateFrom(today, 180);

  // ── SESSIONS. s11's second rung needs a real recurring session to name.
  const friSession = await saveSession(admin, A, {
    weekday: 5, startsMinute: 9 * 60, endsMinute: 13 * 60, locationId: LOC_MAIN,
    sessionName: "Friday Specialist Clinic", activityType: "outpatient_clinic", ...ACT,
  });
  if (!friSession.ok) throw new Error(`friday session fixture failed: ${friSession.message}`);
  const SESSION_FRI = friSession.data.id;

  const capMorning = await saveSession(admin, A, {
    weekday: 4, startsMinute: 9 * 60, endsMinute: 13 * 60, locationId: LOC_CAP,
    sessionName: "Thursday Morning Clinic", activityType: "outpatient_clinic", ...ACT,
  });
  const capAfternoon = await saveSession(admin, A, {
    weekday: 4, startsMinute: 14 * 60, endsMinute: 17 * 60, locationId: LOC_CAP,
    sessionName: "Thursday Afternoon Clinic", activityType: "outpatient_clinic", ...ACT,
  });
  if (!capMorning.ok || !capAfternoon.ok) throw new Error("capacity session fixture failed");

  // ── PATIENTS. The eligibility rungs turn on facts that are READ, so the facts must be real.
  const { data: patRows, error: patErr } = await admin.from("practice_patient").insert([
    { workspace_id: wsA, display_name: "Aisha Nakato", birth_date: dueDateFrom(today, -365 * 41) },
    { workspace_id: wsA, display_name: "Junior Okello", birth_date: dueDateFrom(today, -365 * 7) },
    { workspace_id: wsA, display_name: "Nameless Undated" },
    { workspace_id: wsA, display_name: "Returning Mukasa", birth_date: dueDateFrom(today, -365 * 55) },
  ]).select("id, display_name");
  if (patErr || !patRows) throw new Error(`patient fixture failed: ${patErr?.message}`);
  const P = (n: string) => patRows.find(p => p.display_name.startsWith(n))!.id as string;
  const PAT_ADULT = P("Aisha"), PAT_CHILD = P("Junior"), PAT_UNDATED = P("Nameless"), PAT_RETURNING = P("Returning");

  // "Returning Mukasa" has been seen before. Written straight in, because a COMPLETED appointment is a
  // fact about the past and booking one through the engine would be a fiction.
  await admin.from("practice_appointment").insert({
    workspace_id: wsA, location_id: LOC_NE, patient_id: PAT_RETURNING, patient_name: "Returning Mukasa",
    appointment_type: "new_consultation", scheduled_at: at(dueDateFrom(today, -30), 10 * 60),
    duration_minutes: 20, status: "COMPLETED",
  });

  const mk = async (args: Record<string, any>) =>
    saveBookingRule(admin, A, { status: "active", ...args, ...ACT } as any);

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 1. s7.1's CARD, AND s14's PERMISSION
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const noName = await mk({ locationId: LOC_MAIN });
  ok("1a a new rule without a name is refused -- the card model exists so four rules can be told apart",
    !noName.ok && noName.code === "VALIDATION_ERROR", noName.ok ? "created" : noName.code);

  const noSettings: WorkspaceContext = { ...A, capabilities: A.capabilities.filter(c => c !== "practice.settings.manage") };
  const refusedAuthor = await saveBookingRule(admin, noSettings, {
    name: "Should not exist", locationId: LOC_MAIN, status: "active", ...ACT,
  });
  ok("1b s14: writing a rule needs practice.settings.manage, which no role holds by default except the owner",
    !refusedAuthor.ok && refusedAuthor.code === "FORBIDDEN", refusedAuthor.ok ? "created" : refusedAuthor.code);
  const stillBook = noSettings.capabilities.includes("appointment.manage");
  ok("1c CONTROL: that same account still holds appointment.manage, so 1b is the authoring permission and not a locked-out account",
    stillBook);

  // ── THE LADDER FIXTURE. FOUR RULES THAT ALL MATCH ONE BOOKING, AT FOUR DIFFERENT RUNGS.
  const rPractice = await mk({ name: "Whole practice default", confirmationMode: "instant" });
  const rLocation = await mk({ name: "TMR house rule", locationId: LOC_MAIN });
  const rLocType = await mk({
    name: "TMR new consultations", locationId: LOC_MAIN, appointmentType: "new_consultation",
    confirmationMode: "instant",
  });
  const rSession = await mk({
    name: "TMR Friday Specialist Clinic", sessionTemplateId: SESSION_FRI, appointmentType: "new_consultation",
  });
  for (const [label, r] of [["practice-wide", rPractice], ["location", rLocation], ["location+type", rLocType], ["session+type", rSession]] as const)
    if (!r.ok) throw new Error(`${label} rule fixture failed: ${r.code} ${r.message}`);
  const R_PRACTICE = (rPractice as any).data.id as string;
  const R_LOCATION = (rLocation as any).data.id as string;
  const R_LOCTYPE = (rLocType as any).data.id as string;
  const R_SESSION = (rSession as any).data.id as string;

  ok("1d every new rule starts at version 1",
    [rPractice, rLocation, rLocType, rSession].every(r => r.ok && r.data.version === 1 && r.data.created));

  {
    const cards = await listBookingRules(admin, A);
    const byId = new Map((cards.state === "ok" ? cards.value : []).map(c => [c.id, c]));
    const c = byId.get(R_LOCTYPE);
    ok("1e AC-05: a card carries scope, window, capacity, channel and confirmation WITHOUT being opened",
      cards.state === "ok" && !!c
      && /TMR International Hospital/.test(c.scopeLine) && /new consultation/.test(c.scopeLine)
      && c.windowLine.length > 0 && c.capacityLine.length > 0
      && c.channelLabel === "Every channel" && c.confirmationMode === "instant",
      JSON.stringify(c));
    ok("1f and it carries s11's rung and score, so the ladder is legible before anything is refused",
      !!c && c.specificity === 12 && c.rung === "Location and appointment type rule",
      JSON.stringify([c?.specificity, c?.rung]));
    ok("1g the four rules sit on four DIFFERENT rungs, which is what makes the next section a ladder test",
      new Set([R_PRACTICE, R_LOCATION, R_LOCTYPE, R_SESSION].map(id => byId.get(id)?.specificity)).size === 4,
      JSON.stringify([R_PRACTICE, R_LOCATION, R_LOCTYPE, R_SESSION].map(id => [byId.get(id)?.name, byId.get(id)?.specificity])));
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 2. s11's LADDER -- ASSERTED BY NAME, WALKED DOWN RUNG BY RUNG
  //
  // ⚠ FOUR RULES MATCH THIS ONE BOOKING. A fixture where only one matched could not test a ladder at
  // all, and "the decision named a rule" is true of every wrong implementation. So the winner is
  // asserted BY NAME, and then the winner is archived and the NEXT one must take over -- which is the
  // only arrangement in which picking the wrong rung fails.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const REQ = {
    channel: "practitioner", appointmentType: "new_consultation",
    scheduledAt: at(FRI_A, 10 * 60), locationId: LOC_MAIN, patientId: PAT_ADULT,
  };

  const d1 = await evaluateBooking(admin, A, REQ);
  ok("2a with four matching rules the SESSION rule wins, by name",
    d1.ok && d1.data.ruleId === R_SESSION && d1.data.ruleName === "TMR Friday Specialist Clinic",
    d1.ok ? `${d1.data.ruleName}` : `${d1.code} ${d1.message}`);
  ok("2b and the decision names the three rules that lost, so s11's 'see why a rule won' is answerable",
    d1.ok && d1.data.runnersUp.length === 3
    && d1.data.runnersUp.map(r => r.id).sort().join() === [R_PRACTICE, R_LOCATION, R_LOCTYPE].sort().join(),
    d1.ok ? JSON.stringify(d1.data.runnersUp.map(r => r.name)) : "");
  ok("2c and it says WHY in words rather than in a score",
    d1.ok && d1.data.why.some(w => /names the session/i.test(w)) && d1.data.rung === "Session and appointment type rule",
    d1.ok ? JSON.stringify(d1.data.why) : "");

  await setRuleStatus(admin, A, { ruleId: R_SESSION, status: "archived", ...ACT });
  const d2 = await evaluateBooking(admin, A, REQ);
  ok("2d archive the session rule and the LOCATION+TYPE rule takes over, by name",
    d2.ok && d2.data.ruleId === R_LOCTYPE && d2.data.ruleName === "TMR new consultations",
    d2.ok ? `${d2.data.ruleName}` : `${d2.code} ${d2.message}`);

  await setRuleStatus(admin, A, { ruleId: R_LOCTYPE, status: "paused", ...ACT });
  const d3 = await evaluateBooking(admin, A, REQ);
  ok("2e pause that and the LOCATION-WIDE rule takes over, by name -- so `paused` really is out of force",
    d3.ok && d3.data.ruleId === R_LOCATION && d3.data.ruleName === "TMR house rule",
    d3.ok ? `${d3.data.ruleName}` : `${d3.code} ${d3.message}`);

  await setRuleStatus(admin, A, { ruleId: R_LOCATION, status: "archived", ...ACT });
  const d4 = await evaluateBooking(admin, A, REQ);
  ok("2f archive that and the WHOLE-PRACTICE rule takes over, by name",
    d4.ok && d4.data.ruleId === R_PRACTICE && d4.data.ruleName === "Whole practice default",
    d4.ok ? `${d4.data.ruleName}` : `${d4.code} ${d4.message}`);

  await setRuleStatus(admin, A, { ruleId: R_PRACTICE, status: "archived", ...ACT });
  const d5 = await evaluateBooking(admin, A, REQ);
  ok("2g with nothing left, s11's SIXTH rung: the platform-safe default, with a null rule id and a sentence saying so",
    d5.ok && d5.data.ruleId === null && d5.data.ruleVersion === null
    && d5.data.decidedBy === "platform_default"
    && d5.data.notes.some(n => /not decided by a rule/i.test(n)),
    d5.ok ? JSON.stringify(d5.data) : `${d5.code}`);

  // Put the ladder back, most specific last so nothing ties on the way up.
  for (const id of [R_PRACTICE, R_LOCATION, R_LOCTYPE, R_SESSION])
    await setRuleStatus(admin, A, { ruleId: id, status: "active", ...ACT });
  const d6 = await evaluateBooking(admin, A, REQ);
  ok("2h CONTROL: reactivating all four restores the session rule as the winner, so 2d-2g are the ladder and not four one-way doors",
    d6.ok && d6.data.ruleId === R_SESSION, d6.ok ? String(d6.data.ruleName) : `${d6.code} ${d6.message}`);

  // SCOPE REALLY SCOPES. The same booking at a different place is decided by the practice-wide rule.
  const dElsewhere = await evaluateBooking(admin, A, { ...REQ, locationId: LOC_OTHER, scheduledAt: at(FRI_A, 10 * 60) });
  ok("2i the same booking at ANOTHER location is decided by the whole-practice rule, by name -- the TMR rules do not reach it",
    dElsewhere.ok && dElsewhere.data.ruleId === R_PRACTICE,
    dElsewhere.ok ? String(dElsewhere.data.ruleName) : `${dElsewhere.code}`);
  // And the session rule does not reach a Friday booking OUTSIDE the session's hours.
  const dOutside = await evaluateBooking(admin, A, { ...REQ, scheduledAt: at(FRI_A, 15 * 60) });
  ok("2j nor does the session rule reach 15:00, which is outside the session it names",
    dOutside.ok && dOutside.data.ruleId === R_LOCTYPE,
    dOutside.ok ? String(dOutside.data.ruleName) : `${dOutside.code}`);

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 3. s11's CONFLICT -- BLOCKED, NOT GUESSED
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const tieDraft = await saveBookingRule(admin, A, {
    name: "TMR new consultations, second opinion", locationId: LOC_MAIN,
    appointmentType: "new_consultation", status: "draft", ...ACT,
  });
  ok("3a a rule that WOULD tie may still be saved as a draft -- refusing to save it would hide the conflict",
    tieDraft.ok, tieDraft.ok ? "" : `${tieDraft.code} ${tieDraft.message}`);
  const R_TIE = tieDraft.ok ? tieDraft.data.id : "";

  const activateTie = await setRuleStatus(admin, A, { ruleId: R_TIE, status: "active", ...ACT });
  ok("3b s11: activating it is BLOCKED -- equal specificity AND equal priority is not a coin toss",
    !activateTie.ok && activateTie.code === "RULE_CONFLICT",
    activateTie.ok ? "activated" : activateTie.code);
  ok("3c and the refusal NAMES the other rule and says what to do about it",
    !activateTie.ok && /TMR new consultations/.test(activateTie.message) && /higher priority/.test(activateTie.message),
    activateTie.ok ? "" : activateTie.message);
  {
    const { data: row } = await admin.from("practice_booking_rule").select("status").eq("id", R_TIE).maybeSingle();
    ok("3d and the refusal wrote nothing -- the rule is still a draft", row?.status === "draft", JSON.stringify(row));
  }

  const resolvedTie = await saveBookingRule(admin, A, {
    ruleId: R_TIE, status: "active", priority: 10, reason: "The second-opinion rule takes precedence", ...ACT,
  });
  ok("3e CONTROL: the same rule with a HIGHER priority activates, so 3b is the tie and not the rule",
    resolvedTie.ok, resolvedTie.ok ? "" : `${resolvedTie.code} ${resolvedTie.message}`);
  const dTie = await evaluateBooking(admin, A, { ...REQ, scheduledAt: at(FRI_A, 15 * 60) });
  ok("3f and at equal specificity the higher priority now WINS, by name",
    dTie.ok && dTie.data.ruleId === R_TIE && dTie.data.ruleName === "TMR new consultations, second opinion",
    dTie.ok ? String(dTie.data.ruleName) : `${dTie.code}`);
  ok("3g and the decision says the tie was broken by priority",
    dTie.ok && dTie.data.why.some(w => /higher priority \(10\)/.test(w)),
    dTie.ok ? JSON.stringify(dTie.data.why) : "");
  await setRuleStatus(admin, A, { ruleId: R_TIE, status: "archived", ...ACT });

  // ⚠ TWO TIED RULES WRITTEN STRAIGHT INTO THE TABLE, which the engine cannot prevent. Evaluation must
  // refuse rather than choose, or s11's guarantee only holds for rules created through one door.
  const { data: smuggled, error: smuggleErr } = await admin.from("practice_booking_rule").insert([
    {
      workspace_id: wsA, name: "Smuggled A", status: "active", priority: 3, active: false,
      location_id: LOC_ELIG, appointment_type: "teleconsultation", version: 1,
    },
    {
      workspace_id: wsA, name: "Smuggled B", status: "active", priority: 3, active: false,
      location_id: LOC_ELIG, appointment_type: "teleconsultation", version: 1,
    },
  ]).select("id, name");
  if (smuggleErr || !smuggled) throw new Error(`smuggled rule fixture failed: ${smuggleErr?.message}`);
  const SMUGGLED_A = smuggled.find(r => r.name === "Smuggled A")!.id as string;

  const dConflict = await evaluateBooking(admin, A, {
    channel: "practitioner", appointmentType: "teleconsultation",
    scheduledAt: at(D_EL, 10 * 60), locationId: LOC_ELIG, patientId: PAT_ADULT,
  });
  ok("3h two tied rules already in force make EVALUATION refuse, rather than the engine picking one quietly",
    !dConflict.ok && dConflict.code === "RULE_CONFLICT",
    dConflict.ok ? `chose ${dConflict.data.ruleName}` : dConflict.code);
  ok("3i and it names BOTH of them",
    !dConflict.ok && /Smuggled A/.test(dConflict.message) && /Smuggled B/.test(dConflict.message),
    dConflict.ok ? "" : dConflict.message);
  const bookConflict = await bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: "teleconsultation", scheduledAt: at(D_EL, 10 * 60),
    locationId: LOC_ELIG, patientId: PAT_ADULT, ...ACT,
  });
  ok("3j and the BOOKING refuses too -- a blocked conflict is not merely a warning on a screen",
    !bookConflict.ok && bookConflict.code === "RULE_CONFLICT",
    bookConflict.ok ? "booked" : bookConflict.code);
  const overrideConflict = await bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: "teleconsultation", scheduledAt: at(D_EL, 10 * 60),
    locationId: LOC_ELIG, patientId: PAT_ADULT, override: { reason: "I know better" }, ...ACT,
  });
  ok("3k and an override with a reason does NOT lift it -- s11 says resolve the conflict, not book past it",
    !overrideConflict.ok && overrideConflict.code === "RULE_CONFLICT",
    overrideConflict.ok ? "booked" : overrideConflict.code);

  await admin.from("practice_booking_rule").update({ priority: 9 }).eq("id", SMUGGLED_A);
  const dResolved = await evaluateBooking(admin, A, {
    channel: "practitioner", appointmentType: "teleconsultation",
    scheduledAt: at(D_EL, 10 * 60), locationId: LOC_ELIG, patientId: PAT_ADULT,
  });
  ok("3l CONTROL: giving one of them a higher priority resolves it and names the winner, so 3h is the tie",
    dResolved.ok && dResolved.data.ruleId === SMUGGLED_A,
    dResolved.ok ? String(dResolved.data.ruleName) : `${dResolved.code} ${dResolved.message}`);
  await admin.from("practice_booking_rule").delete().in("id", smuggled.map(r => r.id));

  // ⚠ EQUAL SPECIFICITY AND EQUAL PRIORITY IS NOT ENOUGH. Two rules that can never decide the same
  // booking are not a conflict, and reporting them as one would stop a practitioner having two rooms.
  const farA = await mk({ name: "Kololo staff bookings", locationId: LOC_OTHER, channel: "staff" });
  const farB = await mk({ name: "Kololo practitioner bookings", locationId: LOC_OTHER, channel: "practitioner" });
  ok("3m CONTROL: two equally specific, equally important rules whose CHANNELS differ are not a conflict",
    farA.ok && farB.ok, [farA, farB].map(r => r.ok ? "ok" : `${r.code} ${r.message}`).join(" / "));
  const R_STAFF = farA.ok ? farA.data.id : "";
  const R_PRAC = farB.ok ? farB.data.id : "";

  const newOnly = await mk({ name: "New patients at Muyenga", locationId: LOC_NE, patientEligibility: "new_only" });
  const existingOnly = await mk({ name: "Returning patients at Muyenga", locationId: LOC_NE, patientEligibility: "existing_only" });
  ok("3n CONTROL: nor two whose eligibility can never describe one patient -- new-only and existing-only",
    newOnly.ok && existingOnly.ok, [newOnly, existingOnly].map(r => r.ok ? "ok" : `${r.code} ${r.message}`).join(" / "));
  const R_NEWONLY = newOnly.ok ? newOnly.data.id : "";
  const R_EXISTING = existingOnly.ok ? existingOnly.data.id : "";

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 4. AC-13 -- EVERY BOOKING STORES THE RULE ID AND THE VERSION THAT DECIDED IT
  //
  // ⚠ THE TEST IS THE EDIT. Storing an id and a version is easy to get right by accident; keeping the
  // OLD version on an OLD booking after the rule changes is the thing AC-13 is actually about, and the
  // edit here changes the confirmation mode so the two versions produce visibly different bookings.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  await setRuleStatus(admin, A, { ruleId: R_SESSION, status: "archived", ...ACT });  // so LOCTYPE decides

  // ⚠ THE VERSION IS READ, NOT ASSUMED TO BE 1. Every status change in section 2 was an edit to what the
  // row says and correctly took the version with it, so hard-coding a number here would be asserting
  // that pausing a rule is invisible -- which is the opposite of what a version is for.
  const versionOf = async (ruleId: string) => {
    const { data } = await admin.from("practice_booking_rule").select("version").eq("id", ruleId).maybeSingle();
    return (data?.version as number) ?? -1;
  };
  const V_BEFORE = await versionOf(R_LOCTYPE);
  ok("4-setup pausing and reactivating a rule in section 2 moved its version, because status is part of what a rule says",
    V_BEFORE > 1, String(V_BEFORE));

  const booked1 = await bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(FRI_A, 10 * 60),
    durationMinutes: 20, locationId: LOC_MAIN, patientId: PAT_ADULT, ...ACT,
  });
  ok("4a a booking made under a rule reports the rule and the version IN FORCE AT THE TIME",
    booked1.ok && booked1.data.appliedRuleId === R_LOCTYPE && booked1.data.appliedRuleVersion === V_BEFORE
    && booked1.data.decidedBy === "rule",
    booked1.ok ? JSON.stringify(booked1.data) : `${booked1.code} ${booked1.message}`);
  if (!booked1.ok) throw new Error("cannot continue without the first booking");
  const APPT_1 = booked1.data.appointmentId;
  ok("4b and s7.2's confirmation mode decided its status: `instant` means CONFIRMED, not requested",
    booked1.data.status === "CONFIRMED", booked1.data.status);
  {
    const { data: row } = await admin.from("practice_appointment")
      .select("applied_rule_id, applied_rule_version, status").eq("id", APPT_1).maybeSingle();
    ok("4c and the PAIR is on the row, written in the same insert as the appointment",
      row?.applied_rule_id === R_LOCTYPE && row?.applied_rule_version === V_BEFORE, JSON.stringify(row));
  }

  // THE EDIT.
  const edited = await saveBookingRule(admin, A, {
    ruleId: R_LOCTYPE, confirmationMode: "practitioner_approval",
    reason: "Too many no-shows on unconfirmed first visits", ...ACT,
  });
  const V_AFTER = V_BEFORE + 1;
  ok("4d editing a decision-bearing field takes the rule to the next version and says which field moved",
    edited.ok && edited.data.version === V_AFTER && edited.data.changed.includes("confirmation_mode"),
    edited.ok ? JSON.stringify(edited.data) : `${edited.code} ${edited.message}`);

  const noop = await saveBookingRule(admin, A, { ruleId: R_LOCTYPE, confirmationMode: "practitioner_approval", ...ACT });
  ok("4e a save that changes nothing does NOT bump the version -- a number that moves for nothing cannot answer 'which rule decided this'",
    noop.ok && noop.data.version === V_AFTER && noop.data.changed.length === 0,
    noop.ok ? JSON.stringify(noop.data) : `${noop.code}`);

  {
    const { data: row } = await admin.from("practice_appointment")
      .select("applied_rule_version").eq("id", APPT_1).maybeSingle();
    ok(`4f ⚠ THE BOOKING STILL SAYS VERSION ${V_BEFORE} after the rule moved to version ${V_AFTER}`,
      row?.applied_rule_version === V_BEFORE, JSON.stringify(row));
  }

  const booked2 = await bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(FRI_A, 11 * 60),
    durationMinutes: 20, locationId: LOC_MAIN, patientId: PAT_ADULT, ...ACT,
  });
  ok("4g the NEXT booking is decided by the new version, and the new version makes it a REQUEST rather than a confirmation",
    booked2.ok && booked2.data.appliedRuleVersion === V_AFTER && booked2.data.status === "REQUESTED",
    booked2.ok ? JSON.stringify(booked2.data) : `${booked2.code} ${booked2.message}`);

  const explained = await explainAppointment(admin, A, APPT_1);
  ok("4h reading the first booking back returns what the rule SAID THEN, not what it says now",
    explained.state === "ok" && explained.value.ruleVersion === V_BEFORE
    && explained.value.ruleAsApplied?.confirmation_mode === "instant"
    && explained.value.editedSince === true && explained.value.liveVersion === V_AFTER,
    JSON.stringify(explained.state === "ok" ? [explained.value.ruleVersion, explained.value.ruleAsApplied?.confirmation_mode, explained.value.liveVersion] : explained));
  ok("4i and it says in a sentence that the rule has changed since",
    explained.state === "ok" && /edited since/.test(explained.value.statement),
    explained.state === "ok" ? explained.value.statement : "");

  const history = await ruleVersionHistory(admin, A, R_LOCTYPE);
  ok("4j the version history holds every prior shape at its own number, and the live one is marked live",
    history.state === "ok" && history.value.length === V_AFTER
    && history.value.map(v => v.version).join() === Array.from({ length: V_AFTER }, (_, i) => i + 1).join()
    && history.value.filter(v => v.live).length === 1
    && history.value[V_BEFORE - 1].payload.confirmation_mode === "instant"
    && history.value[V_AFTER - 1].live === true
    && history.value[V_AFTER - 1].payload.confirmation_mode === "practitioner_approval",
    JSON.stringify(history.state === "ok" ? history.value.map(v => [v.version, v.live, v.payload.confirmation_mode]) : history));
  ok("4k and the snapshot of the version that was replaced records WHY it changed",
    history.state === "ok" && /no-shows/.test(String(history.value[V_BEFORE - 1].reason)),
    JSON.stringify(history.state === "ok" ? history.value.map(v => [v.version, v.reason]) : null));

  const { error: dupVersionErr } = await admin.from("practice_booking_rule_version").insert({
    workspace_id: wsA, rule_id: R_LOCTYPE, version: 1, payload: {},
  });
  ok("4l migration 244's unique index refuses a SECOND record of version 1 -- 'what did version 1 say' has one answer",
    !!dupVersionErr, "the database accepted a duplicate");
  const { error: freshVersionErr } = await admin.from("practice_booking_rule_version").insert({
    workspace_id: wsA, rule_id: R_LOCTYPE, version: 99, payload: {},
  });
  ok("4m CONTROL: a record at a version that has none is accepted, so 4l is the index and not the insert",
    !freshVersionErr, freshVersionErr?.message ?? "");
  await admin.from("practice_booking_rule_version").delete().eq("rule_id", R_LOCTYPE).eq("version", 99);

  // ── A BOOKING NO RULE DECIDED. Null is a real answer and the screen must say it.
  await setRuleStatus(admin, A, { ruleId: R_PRACTICE, status: "paused", ...ACT });
  const bookedNoRule = await bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: "home_visit", scheduledAt: at(D_CH, 8 * 60),
    durationMinutes: 20, patientName: "Unlinked Person", ...ACT,
  });
  ok("4n a booking no rule covers stores NULL for both columns and says it was decided by the platform default",
    bookedNoRule.ok && bookedNoRule.data.appliedRuleId === null
    && bookedNoRule.data.appliedRuleVersion === null && bookedNoRule.data.decidedBy === "platform_default",
    bookedNoRule.ok ? JSON.stringify(bookedNoRule.data) : `${bookedNoRule.code} ${bookedNoRule.message}`);
  const explainedNull = bookedNoRule.ok ? await explainAppointment(admin, A, bookedNoRule.data.appointmentId) : null;
  ok("4o and reading it back says so in a sentence rather than leaving a blank where a rule name goes",
    !!explainedNull && explainedNull.state === "ok" && explainedNull.value.decidedByARule === false
    && /not decided by a booking rule/.test(explainedNull.value.statement),
    explainedNull && explainedNull.state === "ok" ? explainedNull.value.statement : "");
  await setRuleStatus(admin, A, { ruleId: R_PRACTICE, status: "active", ...ACT });

  // ── THE DATABASE ENFORCES THE PAIR.
  const { data: bareAppt } = await admin.from("practice_appointment").insert({
    workspace_id: wsA, patient_name: "Constraint Probe", appointment_type: "new_consultation",
    scheduled_at: at(D_NE, 8 * 60), duration_minutes: 20, status: "REQUESTED",
  }).select("id").single();
  const PROBE = bareAppt!.id as string;
  const { error: idOnlyErr } = await admin.from("practice_appointment")
    .update({ applied_rule_id: R_LOCTYPE, applied_rule_version: null }).eq("id", PROBE);
  ok("4p migration 244's CHECK refuses a rule id with no version -- the pair cannot answer the question alone",
    !!idOnlyErr, "the database accepted it");
  const { error: verOnlyErr } = await admin.from("practice_appointment")
    .update({ applied_rule_id: null, applied_rule_version: 2 }).eq("id", PROBE);
  ok("4q nor a version with no rule id", !!verOnlyErr, "the database accepted it");
  const { error: bothErr } = await admin.from("practice_appointment")
    .update({ applied_rule_id: R_LOCTYPE, applied_rule_version: 2 }).eq("id", PROBE);
  ok("4r CONTROL: the two together are accepted, so 4p and 4q are the constraint and not the update",
    !bothErr, bothErr?.message ?? "");
  await admin.from("practice_appointment").delete().eq("id", PROBE);

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 5. AC-07 -- CAPACITY, PER SESSION
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const capRule = await mk({
    name: "Ntinda capacity rule", locationId: LOC_CAP,
    capacityTotal: 3, capacityNew: 1, capacityUrgentReserve: 1,
  });
  if (!capRule.ok) throw new Error(`capacity rule fixture failed: ${capRule.code} ${capRule.message}`);
  const R_CAP = capRule.data.id;

  const bookCap = (minute: number, type: string, extra: Record<string, any> = {}) => bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: type, scheduledAt: at(THU_C, minute),
    durationMinutes: 20, locationId: LOC_CAP, patientName: `Capacity ${minute}`, ...extra, ...ACT,
  });

  const cap1 = await bookCap(9 * 60, "new_consultation");
  ok("5a the first new consultation fits", cap1.ok, cap1.ok ? "" : `${cap1.code} ${cap1.message}`);
  const cap2 = await bookCap(9 * 60 + 30, "new_consultation");
  ok("5b the SECOND is refused by the per-type limit of one, and the message says which type and how many",
    !cap2.ok && cap2.code === "TYPE_CAPACITY_FULL" && /new consultation/.test(cap2.message),
    cap2.ok ? "booked" : `${cap2.code} ${cap2.message}`);
  const cap3 = await bookCap(9 * 60 + 30, "scheduled_followup");
  ok("5c CONTROL: a follow-up in the same slot still fits, so 5b is the per-type limit and not a full session",
    cap3.ok, cap3.ok ? "" : `${cap3.code} ${cap3.message}`);
  const cap4 = await bookCap(10 * 60, "scheduled_followup");
  ok("5d with two of three taken the next ordinary booking hits the URGENT RESERVE, not the total",
    !cap4.ok && cap4.code === "URGENT_RESERVE" && /held for urgent/.test(cap4.message),
    cap4.ok ? "booked" : `${cap4.code} ${cap4.message}`);
  const cap5 = await bookCap(10 * 60, "emergency");
  ok("5e CONTROL: an emergency takes the reserved place, which is what reserving it was for",
    cap5.ok, cap5.ok ? "" : `${cap5.code} ${cap5.message}`);
  const cap6 = await bookCap(10 * 60 + 30, "emergency");
  ok("5f and with all three gone even an emergency is refused by the total",
    !cap6.ok && cap6.code === "CAPACITY_FULL" && /3 of 3/.test(cap6.message),
    cap6.ok ? "booked" : `${cap6.code} ${cap6.message}`);

  // ⚠ PER SESSION, NOT PER DAY (s7.4). The afternoon session on the SAME DAY is untouched.
  const capAfternoonBooking = await bookCap(14 * 60, "scheduled_followup");
  ok("5g ⚠ s7.4: capacity is per SESSION -- the afternoon clinic on the same day is not closed by the morning being full",
    capAfternoonBooking.ok, capAfternoonBooking.ok ? "" : `${capAfternoonBooking.code} ${capAfternoonBooking.message}`);
  {
    const dAfternoon = await evaluateBooking(admin, A, {
      channel: "practitioner", appointmentType: "scheduled_followup",
      scheduledAt: at(THU_C, 14 * 60 + 30), locationId: LOC_CAP,
    });
    ok("5h and the count it used names the afternoon session, so the window is the session's and not the day's",
      dAfternoon.ok && /Thursday Afternoon Clinic/.test(String(dAfternoon.data.capacity?.windowLabel))
      && dAfternoon.data.capacity?.used === 1,
      dAfternoon.ok ? JSON.stringify(dAfternoon.data.capacity) : `${dAfternoon.code}`);
  }

  const overbook = await saveBookingRule(admin, A, {
    ruleId: R_CAP, overbookingAllowed: 1, reason: "One extra on Thursdays", ...ACT,
  });
  ok("5i allowing one overbooking is an edit like any other, and takes the rule to version 2",
    overbook.ok && overbook.data.version === 2, overbook.ok ? "" : `${overbook.code} ${overbook.message}`);
  const cap7 = await bookCap(10 * 60 + 30, "emergency");
  ok("5j CONTROL: the booking 5f refused now fits, so 5f was the ceiling and the ceiling moved by exactly one",
    cap7.ok, cap7.ok ? "" : `${cap7.code} ${cap7.message}`);
  const cap8 = await bookCap(11 * 60, "emergency");
  ok("5k and the next one is refused again, against the raised ceiling",
    !cap8.ok && cap8.code === "CAPACITY_FULL" && /4 of 4/.test(cap8.message),
    cap8.ok ? "booked" : `${cap8.code} ${cap8.message}`);

  // ── s7.4's FIRST RULE, IN BOTH PLACES.
  const badReserve = await mk({
    name: "Impossible reserve", locationId: LOC_ELIG, capacityTotal: 2, capacityUrgentReserve: 3,
  });
  ok("5l the ENGINE refuses a reserve larger than the session total, in a sentence rather than a constraint name",
    !badReserve.ok && badReserve.code === "RESERVE_EXCEEDS_TOTAL" && /could never be satisfied/.test(badReserve.message),
    badReserve.ok ? "created" : `${badReserve.code} ${badReserve.message}`);
  const { error: dbReserveErr } = await admin.from("practice_booking_rule").insert({
    workspace_id: wsA, name: "Impossible reserve, smuggled", status: "draft", active: false,
    location_id: LOC_ELIG, capacity_total: 2, capacity_urgent_reserve: 3, version: 1,
  });
  ok("5m and so does the DATABASE, for a row written straight past the engine",
    !!dbReserveErr, "the database accepted a reserve larger than the total");
  const { data: okReserve, error: dbOkErr } = await admin.from("practice_booking_rule").insert({
    workspace_id: wsA, name: "Possible reserve, smuggled", status: "draft", active: false,
    location_id: LOC_ELIG, capacity_total: 5, capacity_urgent_reserve: 3, version: 1,
  }).select("id");
  ok("5n CONTROL: a reserve within the total is accepted, so 5m is the CHECK and not the insert",
    !dbOkErr, dbOkErr?.message ?? "");
  if (okReserve) await admin.from("practice_booking_rule").delete().in("id", okReserve.map(r => r.id));

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 6. AC-08 -- THE FOLLOW-UP DUE WINDOW, AND AC-14's OVERRIDE
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const fuRule = await mk({
    name: "Kololo follow-up window", locationId: LOC_OTHER, channel: "follow_up",
    followUpEarlyDays: 3, followUpLateDays: 7,
  });
  if (!fuRule.ok) throw new Error(`follow-up rule fixture failed: ${fuRule.code} ${fuRule.message}`);
  const R_FU = fuRule.data.id;

  const { data: fupRow, error: fupErr } = await admin.from("practice_follow_up").insert({
    workspace_id: wsA, patient_id: PAT_ADULT, kind: "review", reason: "Blood pressure review",
    due_on: DUE, status: "OPEN",
  }).select("id").single();
  if (fupErr || !fupRow) throw new Error(`follow-up fixture failed: ${fupErr?.message}`);
  const FUP = fupRow.id as string;

  const bookFu = (date: string, extra: Record<string, any> = {}) => bookUnderRules(admin, A, {
    channel: "follow_up", appointmentType: "scheduled_followup", scheduledAt: at(date, 10 * 60),
    durationMinutes: 20, locationId: LOC_OTHER, patientId: PAT_ADULT, followUpId: FUP, ...extra, ...ACT,
  });

  const tooEarly = await bookFu(dueDateFrom(DUE, -5));
  ok("6a AC-08: a follow-up booked five days before a three-day early window is refused, with both dates in the message",
    !tooEarly.ok && tooEarly.code === "FOLLOW_UP_TOO_EARLY" && tooEarly.message.includes(DUE),
    tooEarly.ok ? "booked" : `${tooEarly.code} ${tooEarly.message}`);
  const tooLate = await bookFu(dueDateFrom(DUE, 10));
  ok("6b and ten days after a seven-day late window",
    !tooLate.ok && tooLate.code === "FOLLOW_UP_TOO_LATE",
    tooLate.ok ? "booked" : `${tooLate.code} ${tooLate.message}`);
  const inWindow = await bookFu(dueDateFrom(DUE, -1));
  ok("6c CONTROL: one day early is inside the window and books, so 6a and 6b are the window and not the channel",
    inWindow.ok, inWindow.ok ? "" : `${inWindow.code} ${inWindow.message}`);
  ok("6d and the follow-up rule is the one that decided it, by name",
    inWindow.ok && inWindow.data.appliedRuleId === R_FU,
    inWindow.ok ? String(inWindow.data.ruleName) : "");

  const noPlan = await bookUnderRules(admin, A, {
    channel: "follow_up", appointmentType: "scheduled_followup", scheduledAt: at(dueDateFrom(DUE, 1), 10 * 60),
    durationMinutes: 20, locationId: LOC_OTHER, patientId: PAT_ADULT, ...ACT,
  });
  ok("6e a follow-up booking with no plan behind it is refused -- there is no due date to book it against",
    !noPlan.ok && noPlan.code === "FOLLOW_UP_PLAN_REQUIRED",
    noPlan.ok ? "booked" : noPlan.code);

  // ── AC-14: THE OVERRIDE.
  const noReason = await bookFu(dueDateFrom(DUE, -5), { override: { reason: "" } });
  ok("6f AC-14: an override with no reason is refused",
    !noReason.ok && noReason.code === "OVERRIDE_REASON_REQUIRED",
    noReason.ok ? "booked" : noReason.code);
  const noPermission = await bookUnderRules(admin, noSettings, {
    channel: "follow_up", appointmentType: "scheduled_followup", scheduledAt: at(dueDateFrom(DUE, -5), 10 * 60),
    durationMinutes: 20, locationId: LOC_OTHER, patientId: PAT_ADULT, followUpId: FUP,
    override: { reason: "The patient is travelling" }, ...ACT,
  });
  ok("6g s14: and one from an account without the settings permission, even with a reason",
    !noPermission.ok && noPermission.code === "OVERRIDE_NOT_PERMITTED",
    noPermission.ok ? "booked" : noPermission.code);

  const { count: auditBefore } = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", wsA).eq("event_type", "practice.booking_rule_overridden");
  const overridden = await bookFu(dueDateFrom(DUE, -5), { override: { reason: "The patient is travelling on the due date" } });
  ok("6h CONTROL: with the permission and a reason the override books, so 6f and 6g are the reason and the permission",
    overridden.ok && overridden.data.overridden.includes("FOLLOW_UP_TOO_EARLY"),
    overridden.ok ? JSON.stringify(overridden.data.overridden) : `${overridden.code} ${overridden.message}`);
  {
    const { data: records } = await admin.from("practice_audit_event")
      .select("id, payload, occurred_at").eq("workspace_id", wsA)
      .eq("event_type", "practice.booking_rule_overridden").order("occurred_at");
    const list = (records ?? []) as any[];
    ok("6i and s12's OverrideRecord is in the audit trail: actor, permission, reason, prior decision and new decision",
      (auditBefore ?? 0) === 0 && list.length === 1
      && list[0].payload.reason === "The patient is travelling on the due date"
      && list[0].payload.permission === "practice.settings.manage"
      && list[0].payload.priorDecision?.allowed === false
      && list[0].payload.newDecision?.allowed === true,
      JSON.stringify(list.map(r => r.payload)));
  }
  const overridden2 = await bookFu(dueDateFrom(DUE, 12), { override: { reason: "Patient was in hospital" } });
  ok("6j a second override is accepted", overridden2.ok, overridden2.ok ? "" : `${overridden2.code} ${overridden2.message}`);
  {
    const { data: records } = await admin.from("practice_audit_event")
      .select("id, payload").eq("workspace_id", wsA)
      .eq("event_type", "practice.booking_rule_overridden").order("occurred_at");
    const list = (records ?? []) as any[];
    ok("6k ⚠ and it APPENDS rather than replacing -- the first record still says exactly what it said",
      list.length === 2
      && list[0].payload.reason === "The patient is travelling on the due date"
      && list[1].payload.reason === "Patient was in hospital",
      JSON.stringify(list.map(r => r.payload.reason)));
  }
  const nothingToOverride = await bookFu(dueDateFrom(DUE, 2), { override: { reason: "Belt and braces" } });
  ok("6l an override with no refusal behind it is refused -- an audit record about nothing is worse than none",
    !nothingToOverride.ok && nothingToOverride.code === "NOTHING_TO_OVERRIDE",
    nothingToOverride.ok ? "booked" : nothingToOverride.code);

  // ── s7.2's BOOKING WINDOW, and the same override lifting it.
  const windowRule = await mk({
    name: "Ntinda teleconsultation window", locationId: LOC_CAP, appointmentType: "teleconsultation",
    leadTimeMinutes: 1440, bookingHorizonDays: 30,
  });
  if (!windowRule.ok) throw new Error(`window rule fixture failed: ${windowRule.code} ${windowRule.message}`);
  const bookTele = (whenMs: number, extra: Record<string, any> = {}) => bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: "teleconsultation",
    scheduledAt: new Date(whenMs).toISOString(), durationMinutes: 20,
    locationId: LOC_CAP, patientName: "Tele Person", ...extra, ...ACT,
  });
  const tooSoon = await bookTele(Date.now() + 2 * 3600_000);
  ok("6m a booking inside the rule's notice period is refused, with the notice in the message",
    !tooSoon.ok && tooSoon.code === "LEAD_TIME" && /1440 minutes/.test(tooSoon.message),
    tooSoon.ok ? "booked" : `${tooSoon.code} ${tooSoon.message}`);
  const tooFar = await bookTele(Date.now() + 60 * 86400_000);
  ok("6n and one beyond the horizon",
    !tooFar.ok && tooFar.code === "BEYOND_HORIZON" && /30 days ahead/.test(tooFar.message),
    tooFar.ok ? "booked" : `${tooFar.code} ${tooFar.message}`);
  const inRange = await bookTele(Date.now() + 10 * 86400_000);
  ok("6o CONTROL: ten days out is inside both, so 6m and 6n are the window",
    inRange.ok, inRange.ok ? "" : `${inRange.code} ${inRange.message}`);
  const overrideWindow = await bookTele(Date.now() + 3 * 3600_000, { override: { reason: "Urgent review requested by the ward" } });
  ok("6p s14: an override with a reason lifts a window refusal",
    overrideWindow.ok && overrideWindow.data.overridden.includes("LEAD_TIME"),
    overrideWindow.ok ? "" : `${overrideWindow.code} ${overrideWindow.message}`);

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 7. AC-06 -- SIX CHANNELS
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const wide = await mk({ name: "Kololo, anybody booking", locationId: LOC_OTHER });
  ok("7a-setup a channel-less rule exists at the same location as the two channel rules",
    wide.ok, wide.ok ? "" : `${wide.code} ${wide.message}`);
  const R_WIDE = wide.ok ? wide.data.id : "";

  const chReq = { appointmentType: "hospital_consultation", scheduledAt: at(D_CH, 10 * 60), locationId: LOC_OTHER };
  const dStaff = await evaluateBooking(admin, A, { ...chReq, channel: "staff" });
  const dPrac = await evaluateBooking(admin, A, { ...chReq, channel: "practitioner" });
  const dNone = await evaluateBooking(admin, A, { ...chReq, channel: "patient_self" });
  ok("7b AC-06: a STAFF booking is decided by the staff rule, by name",
    dStaff.ok && dStaff.data.ruleId === R_STAFF, dStaff.ok ? String(dStaff.data.ruleName) : `${dStaff.code}`);
  ok("7c and a PRACTITIONER booking by the practitioner rule, by name -- the same place, the same time, a different rule",
    dPrac.ok && dPrac.data.ruleId === R_PRAC, dPrac.ok ? String(dPrac.data.ruleName) : `${dPrac.code}`);
  ok("7d CONTROL: a channel neither of them names falls to the channel-less rule, so 7b and 7c are the channel",
    dNone.ok && dNone.data.ruleId === R_WIDE, dNone.ok ? String(dNone.data.ruleName) : `${dNone.code}`);

  const patientRule = await mk({ name: "Patient self-booking, when it exists", locationId: LOC_ELIG, channel: "patient_self" });
  ok("7e AC-06: a rule for a channel with no door is still WRITEABLE and storable",
    patientRule.ok, patientRule.ok ? "" : `${patientRule.code} ${patientRule.message}`);
  const patientBooking = await bookUnderRules(admin, A, {
    channel: "patient_self", appointmentType: "new_consultation", scheduledAt: at(D_CH, 11 * 60),
    durationMinutes: 20, locationId: LOC_ELIG, patientName: "Should Not Happen", ...ACT,
  });
  ok("7f but BOOKING through it is refused with the phase named, rather than inventing a patient booking",
    !patientBooking.ok && patientBooking.code === "CHANNEL_NOT_BUILT" && /Phase 4/.test(patientBooking.message),
    patientBooking.ok ? "booked" : `${patientBooking.code} ${patientBooking.message}`);
  const walkInBooking = await bookUnderRules(admin, A, {
    channel: "walk_in", appointmentType: "walk_in", scheduledAt: at(D_CH, 11 * 60),
    durationMinutes: 20, locationId: LOC_ELIG, patientName: "Should Not Happen", ...ACT,
  });
  ok("7g and the walk-in channel names Phase 5, which is the phase that owns queue rules",
    !walkInBooking.ok && walkInBooking.code === "CHANNEL_NOT_BUILT" && /Phase 5/.test(walkInBooking.message),
    walkInBooking.ok ? "booked" : `${walkInBooking.code} ${walkInBooking.message}`);

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 8. s7.6 -- ELIGIBILITY DECIDES WHOSE RULE IT IS, NOT WHETHER TO REFUSE
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const childRule = await mk({ name: "Bugolobi children's clinic", locationId: LOC_ELIG, patientEligibility: "paediatric" });
  // ⚠ NO APPOINTMENT TYPE ON THIS ONE. Naming one would make it MORE specific than the children's rule
  // (a type is worth more than an eligibility criterion), and 8a would then be testing the wrong thing
  // while looking like it tested the right one.
  const anyRule = await mk({ name: "Bugolobi, everybody", locationId: LOC_ELIG, priority: 0 });
  if (!childRule.ok || !anyRule.ok) throw new Error("eligibility fixture failed");
  const R_CHILD = childRule.data.id, R_ANY = anyRule.data.id;

  const elReq = { channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(D_EL, 10 * 60), locationId: LOC_ELIG };
  const dChild = await evaluateBooking(admin, A, { ...elReq, patientId: PAT_CHILD });
  const dAdult = await evaluateBooking(admin, A, { ...elReq, patientId: PAT_ADULT });
  ok("8a a child's booking is decided by the children's rule, by name",
    dChild.ok && dChild.data.ruleId === R_CHILD, dChild.ok ? String(dChild.data.ruleName) : `${dChild.code}`);
  ok("8b CONTROL: an adult's identical booking is decided by the other rule -- eligibility says whose rule it is, it does not refuse",
    dAdult.ok && dAdult.data.ruleId === R_ANY && dAdult.data.allowed === true,
    dAdult.ok ? String(dAdult.data.ruleName) : `${dAdult.code}`);
  const dUndated = await evaluateBooking(admin, A, { ...elReq, patientId: PAT_UNDATED });
  ok("8c a patient with no date of birth cannot be matched to an age rule, and the decision SAYS so rather than guessing",
    dUndated.ok && dUndated.data.ruleId === R_ANY
    && dUndated.data.notes.some(n => /no date of birth is recorded/.test(n)),
    dUndated.ok ? JSON.stringify(dUndated.data.notes) : `${dUndated.code}`);

  const neReq = { channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(D_NE, 10 * 60), locationId: LOC_NE };
  const dNew = await evaluateBooking(admin, A, { ...neReq, patientId: PAT_CHILD });
  const dReturning = await evaluateBooking(admin, A, { ...neReq, patientId: PAT_RETURNING });
  ok("8d a patient with no appointment history is decided by the new-patients rule, by name",
    dNew.ok && dNew.data.ruleId === R_NEWONLY, dNew.ok ? String(dNew.data.ruleName) : `${dNew.code}`);
  ok("8e CONTROL: a patient who has been seen before is decided by the returning-patients rule, by name",
    dReturning.ok && dReturning.data.ruleId === R_EXISTING,
    dReturning.ok ? String(dReturning.data.ruleName) : `${dReturning.code}`);

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 9. A FAILED READ IS NEVER A ZERO
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const blindRules = adminWithUnreadable(admin, "practice_booking_rule");
  const evalBlind = await evaluateBooking(blindRules, A, REQ);
  ok("9a an unreadable rule table makes the evaluation REFUSE, not fall through to 'no rule applies'",
    !evalBlind.ok && evalBlind.code === "RULES_UNREADABLE",
    evalBlind.ok ? `decided ${evalBlind.data.ruleName}` : evalBlind.code);
  ok("9b and it says an unread rule is not an absent one",
    !evalBlind.ok && /unread rule is not an absent one/.test(evalBlind.message),
    evalBlind.ok ? "" : evalBlind.message);

  const { count: apptBefore } = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  const bookBlind = await bookUnderRules(blindRules, A, {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(FRI_A, 12 * 60),
    durationMinutes: 20, locationId: LOC_MAIN, patientId: PAT_ADULT, ...ACT,
  });
  ok("9c and the BOOKING refuses", !bookBlind.ok && bookBlind.code === "RULES_UNREADABLE",
    bookBlind.ok ? "booked" : bookBlind.code);
  const { count: apptAfter } = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("9d and NOTHING was written", (apptBefore ?? 0) === (apptAfter ?? -1), `${apptBefore} -> ${apptAfter}`);
  const bookControl = await bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(FRI_A, 12 * 60),
    durationMinutes: 20, locationId: LOC_MAIN, patientId: PAT_ADULT, ...ACT,
  });
  ok("9e CONTROL: the identical booking against a working table succeeds, so 9c is the outage",
    bookControl.ok, bookControl.ok ? "" : `${bookControl.code} ${bookControl.message}`);

  const blindPatients = await evaluateBooking(adminWithUnreadable(admin, "practice_patient"), A, REQ);
  ok("9f an unreadable patient record refuses too -- eligibility cannot be decided on a fact nobody read",
    !blindPatients.ok && blindPatients.code === "PATIENT_FACTS_UNREADABLE",
    blindPatients.ok ? "decided" : blindPatients.code);

  const blindSessions = await evaluateBooking(adminWithUnreadable(admin, "practice_availability_template"), A, REQ);
  ok("9g and an unreadable session list, because a session rule cannot be matched without it",
    !blindSessions.ok && blindSessions.code === "SESSIONS_UNREADABLE",
    blindSessions.ok ? "decided" : blindSessions.code);

  const blindCapacity = await evaluateBooking(adminWithUnreadable(admin, "practice_appointment"), A, {
    channel: "practitioner", appointmentType: "scheduled_followup",
    scheduledAt: at(THU_C, 15 * 60), locationId: LOC_CAP,
  });
  ok("9h a capacity count that FAILED is not a count of nought -- the booking is refused rather than overfilling a clinic",
    !blindCapacity.ok && blindCapacity.code === "CAPACITY_UNREADABLE",
    blindCapacity.ok ? "decided" : blindCapacity.code);
  const capacityControl = await evaluateBooking(admin, A, {
    channel: "practitioner", appointmentType: "scheduled_followup",
    scheduledAt: at(THU_C, 15 * 60), locationId: LOC_CAP,
  });
  ok("9i CONTROL: the same count against a working table returns a figure, so 9h is the outage",
    capacityControl.ok && capacityControl.data.capacity !== null,
    capacityControl.ok ? JSON.stringify(capacityControl.data.capacity) : `${capacityControl.code}`);

  const blindFollowUp = await bookUnderRules(adminWithUnreadable(admin, "practice_follow_up"), A, {
    channel: "follow_up", appointmentType: "scheduled_followup", scheduledAt: at(dueDateFrom(DUE, 1), 12 * 60),
    durationMinutes: 20, locationId: LOC_OTHER, patientName: "Unlinked Follow-up", followUpId: FUP, ...ACT,
  });
  ok("9j and an unreadable follow-up plan, because a due window cannot be checked against a due date nobody read",
    !blindFollowUp.ok && blindFollowUp.code === "FOLLOW_UP_UNREADABLE",
    blindFollowUp.ok ? "booked" : blindFollowUp.code);

  const blindList = await listBookingRules(blindRules, A);
  ok("9k the rule list reports UNREADABLE rather than an empty list of rules",
    blindList.state === "unreadable", JSON.stringify(blindList).slice(0, 120));
  const blindWorkspace = await bookingRulesWorkspace(blindRules, A);
  ok("9l and Layer 3's whole read says which part is missing rather than drawing nought rules",
    blindWorkspace.rules.state === "unreadable" && blindWorkspace.readFailures.length > 0,
    JSON.stringify(blindWorkspace.readFailures));
  const liveWorkspace = await bookingRulesWorkspace(admin, A);
  ok("9m CONTROL: the same read against a working table lists the rules, so 9l is the outage",
    liveWorkspace.rules.state === "ok"
    && (liveWorkspace.rules.state === "ok" ? liveWorkspace.rules.value : []).some((r: BookingRuleCard) => r.id === R_LOCTYPE),
    JSON.stringify(liveWorkspace.rules.state));
  ok("9n and AC-13 is countable from it: bookings that carry a rule, and bookings that honestly carry none",
    liveWorkspace.decided.state === "ok"
    && liveWorkspace.decided.value.withRule > 0 && liveWorkspace.decided.value.withoutRule > 0,
    JSON.stringify(liveWorkspace.decided));

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 10. EVALUATION IS SERVER-SIDE
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const V_NOW = await versionOf(R_LOCTYPE);
  const smuggledDecision = await bookUnderRules(admin, A, {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(FRI_A, 12 * 60 + 30),
    durationMinutes: 20, locationId: LOC_MAIN, patientId: PAT_ADULT,
    // A request that tries to name its own rule, its own version and its own verdict.
    appliedRuleId: R_PRACTICE, applied_rule_id: R_PRACTICE, appliedRuleVersion: 99,
    ruleId: R_PRACTICE, allowed: true, decision: { allowed: true, ruleId: R_PRACTICE },
    ...ACT,
  } as any);
  ok("10a a request that names its own rule and version is not believed: the engine's own winner is recorded",
    smuggledDecision.ok && smuggledDecision.data.appliedRuleId === R_LOCTYPE
    && smuggledDecision.data.appliedRuleVersion === V_NOW && V_NOW !== 99,
    smuggledDecision.ok ? JSON.stringify(smuggledDecision.data) : `${smuggledDecision.code} ${smuggledDecision.message}`);
  {
    const { data: row } = await admin.from("practice_appointment")
      .select("applied_rule_id, applied_rule_version")
      .eq("id", smuggledDecision.ok ? smuggledDecision.data.appointmentId : "").maybeSingle();
    ok("10b and the row agrees with the engine rather than with the request",
      row?.applied_rule_id === R_LOCTYPE && row?.applied_rule_version === V_NOW, JSON.stringify(row));
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 11. PERMISSION AND ISOLATION
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const noAppt: WorkspaceContext = { ...A, capabilities: A.capabilities.filter(c => c !== "appointment.manage") };
  const refusedBooking = await bookUnderRules(admin, noAppt, {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: at(FRI_A, 12 * 60 + 30),
    durationMinutes: 20, locationId: LOC_MAIN, patientName: "No Permission", ...ACT,
  });
  ok("11a s14: making a booking needs appointment.manage",
    !refusedBooking.ok && refusedBooking.code === "FORBIDDEN",
    refusedBooking.ok ? "booked" : refusedBooking.code);
  ok("11b CONTROL: the same account still holds practice.settings.manage, so 11a is the booking permission",
    noAppt.capabilities.includes("practice.settings.manage"));

  const crossEdit = await saveBookingRule(admin, B, { ruleId: R_LOCTYPE, name: "Stolen", ...ACT });
  ok("11c practice B cannot edit practice A's rule by id",
    !crossEdit.ok && crossEdit.code === "NOT_FOUND", crossEdit.ok ? "edited" : crossEdit.code);
  const crossScope = await saveBookingRule(admin, B, { name: "Pointing at A's location", locationId: LOC_MAIN, ...ACT });
  ok("11d nor write a rule scoped to practice A's location",
    !crossScope.ok && crossScope.code === "NOT_FOUND", crossScope.ok ? "created" : crossScope.code);
  const bList = await listBookingRules(admin, B);
  ok("11e and practice B's rule list is empty",
    bList.state === "ok" && bList.value.length === 0,
    JSON.stringify(bList.state === "ok" ? bList.value.length : bList));
  const aList = await listBookingRules(admin, A);
  ok("11f CONTROL: practice A's is not, so 11e is isolation and not an empty feature",
    aList.state === "ok" && aList.value.length > 5,
    JSON.stringify(aList.state === "ok" ? aList.value.length : aList));
  const crossExplain = await explainAppointment(admin, B, APPT_1);
  ok("11g and practice B cannot read what decided practice A's booking",
    crossExplain.state === "unreadable", JSON.stringify(crossExplain).slice(0, 120));

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 12. A RULE FROM BEFORE THE CARD MODEL IS DRAWN AS WHAT IT IS
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const { data: legacyRow, error: legacyErr } = await admin.from("practice_booking_rule").insert({
    workspace_id: wsA, location_id: LOC_NE, appointment_type: "teleconsultation",
    lead_time_minutes: 120, booking_horizon_days: 60, active: true,
  }).select("id").single();
  if (legacyErr || !legacyRow) throw new Error(`legacy rule fixture failed: ${legacyErr?.message}`);
  const R_LEGACY = legacyRow.id as string;
  {
    const cards = await listBookingRules(admin, A);
    const c = (cards.state === "ok" ? cards.value : []).find(x => x.id === R_LEGACY);
    ok("12a a row written before the card model appears on the list, marked as having no name of its own",
      !!c && c.name === null && c.legacy === true && c.version === 1, JSON.stringify(c));
    ok("12b and it still carries a scope line and a window in plain language, so it can be read at a glance",
      !!c && /Muyenga Rooms/.test(c.scopeLine) && /close 2 hours before/.test(c.windowLine),
      JSON.stringify([c?.scopeLine, c?.windowLine]));
  }
  const dLegacy = await evaluateBooking(admin, A, {
    channel: "practitioner", appointmentType: "teleconsultation",
    scheduledAt: at(D_NE, 10 * 60), locationId: LOC_NE,
  });
  ok("12c and the new engine honours it -- a rule from before Phase 3 still refuses what it always refused",
    dLegacy.ok && dLegacy.data.ruleId === R_LEGACY && dLegacy.data.ruleName === null,
    dLegacy.ok ? JSON.stringify([dLegacy.data.ruleId, dLegacy.data.ruleName]) : `${dLegacy.code}`);

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // 13. THE ARITHMETIC OF s11, PROVED AGAINST s11's OWN ORDER
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const rung = (o: Record<string, any>) => specificityOf({
    effectiveFrom: null, effectiveTo: null, sessionTemplateId: null, locationId: null,
    appointmentType: null, channel: null, patientEligibility: "any", minAgeYears: null, maxAgeYears: null,
    ...o,
  });
  const datedSession = rung({ effectiveFrom: "2026-01-01", effectiveTo: "2026-01-14", sessionTemplateId: "s" });
  const sessionType = rung({ sessionTemplateId: "s", appointmentType: "t" });
  const locType = rung({ locationId: "l", appointmentType: "t" });
  const locWide = rung({ locationId: "l" });
  const practice = rung({});
  ok("13a s11's six rungs come out in s11's order",
    datedSession > sessionType && sessionType > locType && locType > locWide && locWide > practice,
    JSON.stringify([datedSession, sessionType, locType, locWide, practice]));
  ok("13b channel and eligibility together can never lift a rule past the smallest rung s11 lists",
    rung({ channel: "staff", patientEligibility: "adult" }) < rung({ appointmentType: "t" }),
    JSON.stringify([rung({ channel: "staff", patientEligibility: "adult" }), rung({ appointmentType: "t" })]));
  ok("13c a rule bounded at ONE end only is not a dated rule -- a start date is not a temporary exception",
    rung({ effectiveFrom: "2026-01-01" }) === 0 && rung({ effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01" }) === 32,
    JSON.stringify([rung({ effectiveFrom: "2026-01-01" }), rung({ effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01" })]));
  ok("13d and each rung has s11's own name on it",
    specificityRung({
      effectiveFrom: null, effectiveTo: null, sessionTemplateId: "s", locationId: null,
      appointmentType: "t", channel: null, patientEligibility: "any", minAgeYears: null, maxAgeYears: null,
    }) === "Session and appointment type rule");

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
