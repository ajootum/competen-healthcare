/**
 * Practice Intelligence -- CPR-PIE-001 EXTENSIONS. NO MIGRATION.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR, AND WHAT IT IS NOT FOR.
 *
 * CPR-PIE-001 is a one-page outline and more than half of it was already built. This harness covers ONLY
 * the three things that were added: referral trends over a store nothing read, the parameter alert
 * surface over a store nothing read, and the list of modules that have no store at all.
 *
 * The 95 assertions in practice-intelligence-harness.ts and practice-intelligence-suite-harness.ts still
 * own everything that was already there and are NOT restated here. A second harness re-asserting the
 * first one's claims is how two harnesses come to disagree.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * EVERY ASSERTION BELOW WAS PROVEN ABLE TO FAIL. The traps this file is written against, by name:
 *
 *   THE ASSERTION THAT PASSES ON AN EMPTY TABLE. "No rate in the referral payload" and "the alert
 *   distribution is correct" both pass trivially over a practice with no referrals and no alerts. Every
 *   claim below is paired with a fixture that makes the WRONG answer and the RIGHT answer different
 *   numbers, and with a control proving the same call returns something when the data is there.
 *
 *   THE NULL THAT QUIETLY BECAME A LEVEL. "A not-classified alert is counted" is vacuous if every alert
 *   in the fixture is unclassified. The fixture writes one of each of the four levels AND one NULL, so
 *   an implementation that folded NULL into `informational` gives 2 there and 0 in not_classified, and
 *   one that let it fall into `unrecorded` gives 0 in both.
 *
 *   THE FILTER THAT IS NOT A FILTER. "Vital-sign alerts are counted" passes if the code counts every
 *   alert. The fixture puts an alert on an ANTHROPOMETRIC parameter too, so counting everything gives 2
 *   where the answer is 1.
 *
 *   THE DESTINATION LIST THAT SILENTLY TIDIED ITSELF. "Destinations are counted as typed" is vacuous
 *   unless two spellings of one hospital are in the fixture. They are, and they must stay two rows.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   npx --yes tsx scripts/practice-intelligence-pie-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, hasCapability, type WorkspaceContext } from "../src/lib/practice/access";
import {
  intelligenceSuite, referralIntelligence, parameterAlertIntelligence,
  intelRange, suiteGroundingFigures, MIN_OBSERVATIONS_FOR_COMPARISON,
} from "../src/lib/practice/intelligence";
import {
  findRates, ALERT_SEVERITIES, ALERT_SEVERITY_LEVELS, SEVERITY_NOT_CLASSIFIED, PIE_NOT_BUILDABLE,
} from "../src/lib/practice/intelligence-constants";
import { practiceToday, dueDateFrom } from "../src/lib/practice/practice-time";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e29f1";
const OTHER = "00000000-0000-4000-8000-0000000e29f2";
const TZ = "Africa/Kampala";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pie-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-pie",
  }).select("id").single();
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: user, correlation_id: "harness-pie", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

const base = { actorId: OWNER, correlationId: "harness-pie" };

async function withoutCapability(workspaceId: string, userId: string, capabilities: string[]): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  const ids = ((mine ?? []) as any[]).map(m => m.id);
  for (const c of capabilities) {
    await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
      .in("membership_id", ids).eq("capability_code", c).is("effective_to", null);
  }
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

/**
 * Put a capability back.
 *
 * ⚠ THIS EXISTS BECAUSE withoutCapability IS CUMULATIVE AND THAT PRODUCED A VACUOUS ASSERTION IN THE
 * FIRST DRAFT OF THIS FILE. Ending a role assignment is a WRITE to practice_role_assignment; it persists
 * for the rest of the run. So by the time the de-identification test removed patient.view, the context it
 * built had already lost encounter.list and parameter.view from two earlier tests, both modules came back
 * `available: false`, and "no patient name reached either module" passed because neither module had
 * produced anything at all. It is the exact failure this harness's header is written against, and it was
 * caught by the CONTROL beside it rather than by review.
 *
 * Every blindness test below therefore restores what it took, and the restore is ASSERTED.
 */
async function restoreCapabilities(workspaceId: string, userId: string, capabilities: string[]): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  const ids = ((mine ?? []) as any[]).map(m => m.id);
  for (const c of capabilities) {
    await admin.from("practice_role_assignment").update({ effective_to: null })
      .in("membership_id", ids).eq("capability_code", c).not("effective_to", "is", null);
  }
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

/** An admin whose every read fails. The only way to prove "a failed read is never a zero". */
const brokenAdmin = () => {
  const q: any = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      if (prop === "limit") return async () => ({ data: null, error: { message: "boom: table is gone" } });
      return () => q;
    },
  });
  return { from: () => q } as any;
};

/**
 * Does a table exist?
 *
 * ⚠ `.select("id").limit(1)` AND THE ERROR, NOT A head+count. A head+count over a missing table returns
 * a NULL count and this codebase has already shipped one bug from reading that as a zero. An absent
 * relation is an ERROR from PostgREST, and the error is the only reliable signal.
 */
async function tableExists(name: string): Promise<boolean> {
  const probe = await admin.from(name).select("id").limit(1);
  return !probe.error;
}

/** Walk a payload and collect every object carrying a `formula`, with its path. */
function figuresWithFormula(value: unknown, path = "$", out: { path: string; o: any }[] = []) {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) { value.forEach((x, i) => figuresWithFormula(x, `${path}[${i}]`, out)); return out; }
  const o = value as Record<string, unknown>;
  if (typeof o.formula === "string") out.push({ path, o });
  for (const [k, v] of Object.entries(o)) figuresWithFormula(v, `${path}.${k}`, out);
  return out;
}

async function main() {
  console.log("\nPractice Intelligence -- CPR-PIE-001 extensions (no migration)\n");
  await cleanup();

  // ══ A. THE ALERT TAXONOMY, AGAINST THE DATABASE THAT DEFINES IT ═══════════════════════════════════
  //
  // ⚠ THE CONSTANT AND THE CHECK CONSTRAINT ARE TWO PLACES ONE FACT LIVES, AND THIS IS THE ONLY TEST
  // THAT CAN CATCH THEM DISAGREEING. A fifth level invented in TypeScript compiles perfectly and simply
  // never matches a row -- it renders as an eternally empty bar, which looks exactly like a quiet week.
  console.log("── PIE §7's four levels, and the fifth thing that is not a level ──");
  ok("PIE §7's four levels are declared in PIE §7's order",
    ALERT_SEVERITY_LEVELS.join(",") === "informational,advisory,action_required,critical",
    ALERT_SEVERITY_LEVELS.join(","));
  ok("`not_classified` is present as a bucket and is explicitly NOT one of the levels",
    ALERT_SEVERITIES.length === 5 &&
    ALERT_SEVERITIES.find(s => s.key === SEVERITY_NOT_CLASSIFIED)?.isLevel === false &&
    !ALERT_SEVERITY_LEVELS.includes(SEVERITY_NOT_CLASSIFIED as never),
    ALERT_SEVERITIES.map(s => `${s.key}:${s.isLevel}`).join(","));
  ok("and it says in its own text that it is never rendered as low and never as a blank",
    /never as a low|not a low/i.test(ALERT_SEVERITIES.find(s => s.key === SEVERITY_NOT_CLASSIFIED)!.meaning) &&
    /blank/i.test(ALERT_SEVERITIES.find(s => s.key === SEVERITY_NOT_CLASSIFIED)!.meaning),
    ALERT_SEVERITIES.find(s => s.key === SEVERITY_NOT_CLASSIFIED)!.meaning.slice(0, 80));
  // ⚠ COMPARED AS STRINGS, AND THE `String()` IS LOAD-BEARING RATHER THAN NOISE.
  //
  // AlertSeverityKey is a five-member union that does not contain "significant", so `s.key ===
  // "significant"` is a TYPE ERROR -- tsc is already making this claim, more strongly than a harness can.
  // The obvious response is to delete the assertion, and that is the wrong one: the union is a line of
  // TypeScript somebody can widen, and the day MED §5's wording is added back to it this assertion is the
  // thing that objects. So it is KEPT and made type-safe by comparing the runtime strings, which is the
  // claim actually worth making -- that no row of ALERT_SEVERITIES carries the rejected word.
  ok("MED §5's rejected third level is NOT in the taxonomy -- one taxonomy everywhere, and it is PIE's",
    !ALERT_SEVERITIES.map(s => String(s.key)).includes("significant"),
    ALERT_SEVERITIES.map(s => s.key).join(","));
  ok("CONTROL: the same check finds a level that IS there, so it is not passing because the comparison is dead",
    ALERT_SEVERITIES.map(s => String(s.key)).includes("action_required"));

  // ══ B. WHAT HAS A STORE AND WHAT DOES NOT, PROBED RATHER THAN REMEMBERED ══════════════════════════
  console.log("\n── PIE §3/§4/§5: the modules with no store, and the one that had a store and no reader ──");
  const referralTable = await tableExists("practice_referral");
  const alertTable = await tableExists("practice_parameter_alert");
  const medicationTable = await tableExists("practice_medication");
  const medicationEventTable = await tableExists("practice_medication_event");

  ok("CONTROL: the probe discriminates -- practice_referral and practice_parameter_alert both EXIST",
    referralTable && alertTable, JSON.stringify({ referralTable, alertTable }));
  ok("CPR-MED-001 IS NOT BUILT: neither practice_medication nor practice_medication_event exists, so every medication module PIE asks for is correctly refused",
    !medicationTable && !medicationEventTable,
    JSON.stringify({ medicationTable, medicationEventTable }));
  ok("and the three medication refusals are IN THE LIST rather than omitted",
    ["medication_review", "medication_utilisation", "medication_monitoring_due"]
      .every(k => PIE_NOT_BUILDABLE.some(u => u.key === k)),
    PIE_NOT_BUILDABLE.map(u => u.key).join(","));
  ok("each refusal names the section of PIE that asks for it, why it cannot be built, and what would make it real",
    PIE_NOT_BUILDABLE.length === 6 &&
    PIE_NOT_BUILDABLE.every(u => /PIE §\d/.test(u.from) && u.why.length > 150 && u.wouldRequire.length > 60),
    PIE_NOT_BUILDABLE.map(u => `${u.key}:${u.why.length}/${u.wouldRequire.length}`).join(" "));
  ok("the medication refusal names the tables that were looked for, so the next person does not repeat the search",
    /practice_medication\b/.test(PIE_NOT_BUILDABLE.find(u => u.key === "medication_review")!.why),
    PIE_NOT_BUILDABLE.find(u => u.key === "medication_review")!.why.slice(0, 100));
  // ⚠ THE NAME COLLISION THE SURVEY FLAGGED, ASSERTED SO IT CANNOT BE QUIETLY MERGED LATER.
  ok("the growth refusal warns that the built `practice_growth` module is BUSINESS growth, not a child's growth chart",
    /BUSINESS growth/.test(PIE_NOT_BUILDABLE.find(u => u.key === "growth_percentiles")!.why),
    PIE_NOT_BUILDABLE.find(u => u.key === "growth_percentiles")!.why.slice(-160));
  ok("NOT ONE PERCENTAGE AND NOT ONE RATE-SHAPED FIELD in the refusal list or the taxonomy",
    findRates({ notBuildable: PIE_NOT_BUILDABLE, taxonomy: ALERT_SEVERITIES }).length === 0,
    JSON.stringify(findRates({ notBuildable: PIE_NOT_BUILDABLE, taxonomy: ALERT_SEVERITIES }).slice(0, 4)));
  // ⚠ THE DISCRIMINATING CONTROL: the refusals talk ABOUT percentages, and the detector must not fire on
  // the word. If it did, the engine would have to stop explaining the rule the detector enforces.
  ok("CONTROL: the detector still fires on a real percentage placed in the same shape, so the test above is not a word blocklist",
    findRates({ notBuildable: [{ ...PIE_NOT_BUILDABLE[0], why: "utilisation rose 15% this month" }] }).length > 0);

  // ══ C. THE FIXTURE ════════════════════════════════════════════════════════════════════════════════
  const wsA = await provision(OWNER, "HARNESS PIE A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS PIE B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  ok("FIXTURE: the provisioned owner really holds encounter.list, patient.view and parameter.view, so no test below passes because a capability was silently absent",
    hasCapability(a.ctx, "encounter.list") && hasCapability(a.ctx, "patient.view") &&
    hasCapability(a.ctx, "parameter.view"),
    JSON.stringify(["encounter.list", "patient.view", "parameter.view"].map(c => [c, hasCapability(a.ctx, c)])));

  const today = practiceToday(TZ);
  const patient = async (name: string) => {
    const r = await registerPatient(admin, {
      workspaceId: wsA, displayName: name, sex: "female", birthDate: "1985-05-05",
      phone: `0772 ${Math.floor(100000 + Math.random() * 899999)}`, ...base,
    });
    if (!r.ok) throw new Error(`register ${name}: ${r.message}`);
    return r.data.id;
  };
  const p1 = await patient("Referred Twice");
  const p2 = await patient("Referred Once");
  const p3 = await patient("Alerted Patient");

  // ── THE REFERRALS ─────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ THE SHAPE OF THIS FIXTURE IS THE WHOLE TEST. Two spellings of one hospital, so a list that tidied
  // itself gives 1 destination where the answer is 2. One destination with two referrals to the SAME
  // patient, so a `patients` field that counted rows gives 2 where the answer is 1. And one referral
  // OUTSIDE the window that is still `made`, so a windowed "awaiting news" gives 3 where the answer is 4
  // and an unwindowed "made in this period" gives 5 where the answer is 4.
  const refRows = [
    { patient_id: p1, referred_to: "Mulago Hospital", reason: "Neurosurgical opinion", status: "made", referred_on: dueDateFrom(today, -3) },
    { patient_id: p1, referred_to: "Mulago Hospital", reason: "Neurosurgical review", status: "accepted", referred_on: dueDateFrom(today, -5) },
    { patient_id: p2, referred_to: "mulago hospital", reason: "Second opinion", status: "made", referred_on: dueDateFrom(today, -7) },
    { patient_id: p2, referred_to: "Kampala Eye Clinic", reason: "Cataract", status: "declined", referred_on: dueDateFrom(today, -9) },
    // OUTSIDE the 30-day window, and still `made`.
    { patient_id: p3, referred_to: "Far Away Clinic", reason: "Old referral", status: "made", referred_on: dueDateFrom(today, -200) },
  ].map(r => ({ ...r, workspace_id: wsA, created_by: OWNER, updated_by: OWNER }));

  const { error: refError, data: refWritten } = await admin.from("practice_referral").insert(refRows).select("id");
  ok("FIXTURE: five referrals were really written -- four inside the window and one two hundred days old",
    !refError && ((refWritten ?? []) as any[]).length === 5,
    refError?.message ?? String(((refWritten ?? []) as any[]).length));

  // ── THE PARAMETER DEFINITIONS AND ALERTS ──────────────────────────────────────────────────────────
  const { data: defs, error: defError } = await admin.from("practice_parameter_definition").insert([
    { workspace_id: wsA, code: "harness_bp_systolic", display_name: "Systolic blood pressure", category: "vital_sign", data_type: "integer", status: "active" },
    { workspace_id: wsA, code: "harness_weight", display_name: "Weight", category: "anthropometric", data_type: "decimal", status: "active" },
  ]).select("id, category");
  const vitalDef = ((defs ?? []) as any[]).find(d => d.category === "vital_sign")?.id;
  const anthroDef = ((defs ?? []) as any[]).find(d => d.category === "anthropometric")?.id;
  ok("FIXTURE: one vital-sign parameter and one anthropometric parameter were really defined",
    !defError && !!vitalDef && !!anthroDef, defError?.message ?? JSON.stringify(defs));

  // ⚠ ONE OF EACH OF THE FOUR LEVELS, ONE NULL, AND ONE ALREADY ANSWERED. Every one of those five rows
  // is doing work in an assertion below; none of them is scenery.
  const alertRow = (over: Record<string, unknown>) => ({
    workspace_id: wsA, patient_id: p3, definition_id: vitalDef,
    alert_type: "reference_range", rationale: "Harness fixture row", status: "open",
    raised_at: new Date(Date.parse(`${dueDateFrom(today, -2)}T09:00:00.000Z`)).toISOString(),
    ...over,
  });
  const alertRows = [
    alertRow({ severity: "critical" }),
    alertRow({ severity: "action_required" }),
    alertRow({ severity: "advisory", alert_type: "missing_overdue" }),
    alertRow({ severity: "informational", alert_type: "trend_deviation" }),
    // ⚠ THE NULL. Written as an explicit null so a default cannot rescue it.
    alertRow({ severity: null, alert_type: "patient_target" }),
    // The anthropometric one: proves the vital-sign lens is a filter and not a count of everything.
    alertRow({ severity: "critical", definition_id: anthroDef }),
    // Already answered, and OUTSIDE the reporting window, still open? No -- acknowledged, inside it.
    alertRow({ severity: "advisory", status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by: OWNER }),
    // Raised 200 days ago and STILL OPEN. Proves `open` is a live state and `raised` is windowed.
    alertRow({ severity: "advisory", raised_at: new Date(Date.parse(`${dueDateFrom(today, -200)}T09:00:00.000Z`)).toISOString() }),
  ];
  const { error: alertError, data: alertWritten } = await admin.from("practice_parameter_alert").insert(alertRows).select("id");
  ok("FIXTURE: eight alerts were really written, including one with an explicitly NULL severity",
    !alertError && ((alertWritten ?? []) as any[]).length === 8,
    alertError?.message ?? String(((alertWritten ?? []) as any[]).length));

  // ⚠ THE CONSTRAINT ITSELF. This is what stops the TypeScript constant and the CHECK drifting apart.
  const { error: bogus } = await admin.from("practice_parameter_alert")
    .insert(alertRow({ severity: "significant" })).select("id");
  ok("THE DATABASE REFUSES A LEVEL THE TAXONOMY DOES NOT NAME -- MED §5's \"significant\" is rejected by the CHECK constraint",
    !!bogus, bogus?.message ?? "the insert SUCCEEDED, so the constraint and the constant disagree");
  ok("CONTROL: and it accepts every one of PIE §7's four, so the refusal above is the constraint working rather than the table being unwritable",
    !alertError, alertError?.message ?? "");

  // ══ D. REFERRAL TRENDS ════════════════════════════════════════════════════════════════════════════
  console.log("\n── PIE §5: referral trends, over a store nothing had ever read ──");
  const range = await intelRange(admin, wsA, { days: 30 });
  const refs = await referralIntelligence(admin, a.ctx, range);
  const rd = refs.data!;

  ok("REFERRALS RECORDED IN THE PERIOD COUNTS THE FOUR IN THE WINDOW AND NOT THE TWO-HUNDRED-DAY-OLD ONE",
    rd.made.status === "ok" && rd.made.count === 4,
    JSON.stringify({ status: rd.made.status, count: rd.made.count }));

  // ⚠ THE DISCRIMINATOR. `awaitingNews` is a live state and must NOT be windowed: the old referral is
  // still at `made` and must appear. A windowed implementation gives 2.
  ok("REFERRALS WITH NO NEWS IS A LIVE STATE, NOT A WINDOW: the two-hundred-day-old `made` referral IS counted",
    rd.awaitingNews.status === "ok" && rd.awaitingNews.count === 3,
    JSON.stringify({ count: rd.awaitingNews.count, sample: rd.awaitingNews.sample.map(s => s.label) }));
  ok("and the two are DIFFERENT answers, so neither is a copy of the other",
    rd.made.count !== rd.awaitingNews.count &&
    rd.made.fromDay !== null && rd.awaitingNews.fromDay === null,
    JSON.stringify({ made: [rd.made.count, rd.made.fromDay], awaiting: [rd.awaitingNews.count, rd.awaitingNews.fromDay] }));

  // ⚠ COUNTED AS TYPED. Two spellings of Mulago are TWO destinations. A list that lowercased and merged
  // them would give 2 destinations where the answer is 3, and would invent a facility register.
  const dest = (label: string) => rd.destinations.find(x => x.label === label);
  ok("DESTINATIONS ARE COUNTED EXACTLY AS TYPED: \"Mulago Hospital\" and \"mulago hospital\" stay two rows",
    rd.distinctDestinations === 3 &&
    dest("Mulago Hospital")?.total === 2 && dest("mulago hospital")?.total === 1,
    JSON.stringify(rd.destinations));
  // ⚠ AND THE PATIENT COUNT IS A UNION, NOT A ROW COUNT. Two referrals to Mulago for ONE patient.
  ok("A DESTINATION'S PATIENT COUNT IS PEOPLE, NOT REFERRALS: two referrals for one patient is 2 and 1",
    dest("Mulago Hospital")?.total === 2 && dest("Mulago Hospital")?.patients === 1,
    JSON.stringify(dest("Mulago Hospital")));

  ok("THE STATUS BREAKDOWN EMITS ALL FOUR OF MIGRATION 238's STATES EVEN AT ZERO",
    rd.byStatus.status === "ok" && rd.byStatus.slices.length === 4 &&
    rd.byStatus.slices.map(s => s.key).join(",") === "made,accepted,declined,withdrawn" &&
    rd.byStatus.slices.find(s => s.key === "withdrawn")?.total === 0 &&
    rd.byStatus.slices.find(s => s.key === "made")?.total === 2,
    JSON.stringify(rd.byStatus.slices.map(s => [s.key, s.total])));

  ok("THE PANEL SAYS RECORDED, NOT SENT -- the claim this schema structurally cannot support",
    /no channel and no sent_at|written down/.test(rd.limitation) && rd.limitation.length > 150,
    rd.limitation.slice(0, 100));

  ok("EVERY REFERRAL FIGURE IS A LIST THAT OPENS, with a row-level route per sample",
    [rd.made, rd.awaitingNews].every(o => o.href.startsWith("/practice/")) &&
    rd.made.sample.length > 0 && rd.made.sample.every(s => s.href?.startsWith("/practice/patients/")),
    JSON.stringify(rd.made.sample.map(s => s.href)));

  ok("A BRAND-NEW PRACTICE GETS NO REFERRAL COMPARISON, and the reason names its own start date",
    rd.change.status === "unknowable" && rd.change.prior === null && rd.change.change === null &&
    /began keeping records|no recorded start date/.test(rd.change.reason ?? ""),
    JSON.stringify({ status: rd.change.status, reason: rd.change.reason }));

  // ── FAILED READS AND PERMISSIONS ──────────────────────────────────────────────────────────────────
  const refsBroken = await referralIntelligence(brokenAdmin(), a.ctx, range);
  ok("A DEAD REFERRAL TABLE PRODUCES `unreadable` AND A NULL, never a plausible nought",
    refsBroken.data?.made.status === "unreadable" && refsBroken.data?.made.count === null &&
    /boom/.test(refsBroken.data?.made.reason ?? ""),
    JSON.stringify([refsBroken.data?.made.status, refsBroken.data?.made.count]));
  ok("CONTROL: the same call over the real database returns four, so the test above is not passing on an empty practice",
    rd.made.count === 4);
  ok("and a dead table refuses the DESTINATION LIST too rather than drawing an empty one",
    refsBroken.data?.destinations.length === 0 && refsBroken.data?.distinctDestinations === null,
    JSON.stringify(refsBroken.data?.distinctDestinations));

  const noEncounters = await withoutCapability(wsA, OWNER, ["encounter.list"]);
  const refsBlind = await referralIntelligence(admin, noEncounters, range);
  ok("WITHOUT encounter.list THE MODULE IS UNAVAILABLE WITH A REASON -- a permissions answer, not an empty referral list",
    refsBlind.available === false && refsBlind.data === null &&
    /encounter\.list/.test(refsBlind.unavailableReason ?? ""),
    refsBlind.unavailableReason ?? "");
  const restoredEncounters = await restoreCapabilities(wsA, OWNER, ["encounter.list"]);
  ok("CONTROL: encounter.list was really put back, so the tests after this one are not running against a blinded practice",
    hasCapability(restoredEncounters, "encounter.list") &&
    (await referralIntelligence(admin, restoredEncounters, range)).data?.made.count === 4,
    String(hasCapability(restoredEncounters, "encounter.list")));

  // ══ E. THE PARAMETER ALERT SURFACE ════════════════════════════════════════════════════════════════
  console.log("\n── PIE §7: the alert framework, and the NULL that is not a level ──");
  const alerts = await parameterAlertIntelligence(admin, a.ctx, range);
  const ad = alerts.data!;
  const sev = (k: string) => ad.bySeverity.slices.find(s => s.key === k)?.total;

  // ⚠ THE CENTRAL ASSERTION OF THIS FILE. Seven open alerts: critical×2, action_required, advisory×2,
  // informational, and ONE NULL. An implementation folding NULL into informational gives informational 2
  // and not_classified 0; one leaving it as NULL gives unrecorded 1 and not_classified 0.
  ok("A NULL SEVERITY LANDS IN A NAMED `not_classified` SLICE -- not in `informational`, and not in the unclassifiable bucket",
    ad.bySeverity.status === "ok" &&
    sev(SEVERITY_NOT_CLASSIFIED) === 1 && sev("informational") === 1 && ad.bySeverity.unrecorded === 0,
    JSON.stringify({ slices: ad.bySeverity.slices.map(s => [s.key, s.total]), unrecorded: ad.bySeverity.unrecorded }));
  ok("CONTROL: the four real levels are each counted from their own rows, so the test above is not passing because everything is unclassified",
    sev("critical") === 2 && sev("action_required") === 1 && sev("advisory") === 2,
    JSON.stringify(ad.bySeverity.slices.map(s => [s.key, s.total])));
  ok("the not-classified count is ALSO a figure of its own, openable, rather than only a bar",
    ad.notClassified.status === "ok" && ad.notClassified.count === 1 &&
    ad.notClassified.href.startsWith("/practice/"),
    JSON.stringify([ad.notClassified.status, ad.notClassified.count]));
  ok("and its definition says the words: an absence of a classification, not a low one",
    /absence of a classification, not a low one/.test(ad.notClassified.definition),
    ad.notClassified.definition);

  ok("OPEN COUNTS EVERY OPEN ALERT AND EXCLUDES THE ACKNOWLEDGED ONE",
    ad.open.status === "ok" && ad.open.count === 7,
    JSON.stringify({ count: ad.open.count }));
  // ⚠ THE OTHER DISCRIMINATOR ON `open`: it is a LIVE STATE. The two-hundred-day-old open alert counts.
  ok("OPEN IS NOT WINDOWED: an alert raised two hundred days ago and never acknowledged is still open now",
    ad.open.count === 7 && ad.open.fromDay === null && ad.open.toDay === null,
    JSON.stringify({ count: ad.open.count, fromDay: ad.open.fromDay }));

  const actionable = Object.fromEntries(ad.actionable.map(x => [x.key, x]));
  ok("CRITICAL AND ACTION-REQUIRED ARE COUNTED SEPARATELY, each from its own rows",
    actionable.alerts_critical?.count === 2 && actionable.alerts_action_required?.count === 1,
    JSON.stringify(ad.actionable.map(x => [x.key, x.count])));
  ok("CONTROL: and they disagree with each other and with the whole, so neither is a copy of `open`",
    actionable.alerts_critical?.count !== actionable.alerts_action_required?.count &&
    actionable.alerts_critical?.count !== ad.open.count);

  // ⚠ THE FILTER THAT IS NOT A FILTER. Two critical alerts exist; only one is on a vital sign.
  ok("THE VITAL-SIGN LENS IS A FILTER: the alert on the ANTHROPOMETRIC parameter is excluded",
    ad.vitalSigns.status === "ok" && ad.vitalSigns.count === 6,
    JSON.stringify({ vitalSigns: ad.vitalSigns.count, open: ad.open.count }));
  ok("CONTROL: and it is smaller than the whole, so it is not counting everything and calling it vital signs",
    (ad.vitalSigns.count ?? 0) < (ad.open.count ?? 0),
    JSON.stringify({ vitalSigns: ad.vitalSigns.count, open: ad.open.count }));

  ok("THE RULE THAT FIRED IS BROKEN OUT OVER ALL SEVEN OF MIGRATION 246's TYPES, every one emitted",
    ad.byType.status === "ok" && ad.byType.slices.length === 7 &&
    ad.byType.slices.find(s => s.key === "reference_range")?.total === 4 &&
    ad.byType.slices.find(s => s.key === "change_from_baseline")?.total === 0,
    JSON.stringify(ad.byType.slices.map(s => [s.key, s.total])));

  ok("EVERY ALERT SAMPLE CARRIES ITS RATIONALE, which is why migration 246 made rationale NOT NULL",
    ad.open.sample.length > 0 && ad.open.sample.every(s => (s.note ?? "").length > 0),
    JSON.stringify(ad.open.sample.slice(0, 2)));

  // ⚠ A NUMERATOR AND A DENOMINATOR. There is no rate field on IntelProportion and there is no way to
  // add one without the detector in section G firing.
  ok("ANSWERED ALERTS ARE A NUMERATOR AND A DENOMINATOR, with the censoring disclosed",
    ad.acknowledged.status === "ok" && ad.acknowledged.numerator === 1 && ad.acknowledged.denominator === 7 &&
    (ad.acknowledged.caveat ?? "").length > 80,
    JSON.stringify({ n: ad.acknowledged.numerator, d: ad.acknowledged.denominator }));
  ok("CONTROL: the denominator is the alerts RAISED IN THE PERIOD, so the two-hundred-day-old one is not in it",
    ad.acknowledged.denominator === 7 && (ad.open.count ?? 0) === 7 &&
    ad.acknowledged.denominator !== alertRows.length,
    JSON.stringify({ denominator: ad.acknowledged.denominator, written: alertRows.length }));

  ok("THE TAXONOMY TRAVELS IN THE PAYLOAD, four levels plus the absence, so no client invents a fifth",
    ad.taxonomy.length === 5 && ad.taxonomy.filter(t => t.isLevel).length === 4 &&
    ad.taxonomy.every(t => t.meaning.length > 40),
    ad.taxonomy.map(t => t.key).join(","));

  const alertsBroken = await parameterAlertIntelligence(brokenAdmin(), a.ctx, range);
  ok("A DEAD ALERT TABLE PRODUCES `unreadable` AND NULLS ACROSS EVERY FIGURE, never a calm zero",
    [alertsBroken.data?.open, alertsBroken.data?.notClassified, alertsBroken.data?.vitalSigns,
      ...(alertsBroken.data?.actionable ?? [])]
      .every(o => o?.status === "unreadable" && o?.count === null) &&
    alertsBroken.data?.bySeverity.status === "unreadable",
    JSON.stringify([alertsBroken.data?.open.status, alertsBroken.data?.open.count]));
  ok("CONTROL: the same call over the real database returns seven, so the test above is not passing on a practice with no alerts",
    ad.open.count === 7);

  const noParameters = await withoutCapability(wsA, OWNER, ["parameter.view"]);
  const alertsBlind = await parameterAlertIntelligence(admin, noParameters, range);
  ok("WITHOUT parameter.view THE MODULE IS UNAVAILABLE and the reason names the capability and who migration 246 withheld it from",
    alertsBlind.available === false && alertsBlind.data === null &&
    /parameter\.view/.test(alertsBlind.unavailableReason ?? "") &&
    /practice_owner|practice owner/.test(alertsBlind.unavailableReason ?? ""),
    alertsBlind.unavailableReason ?? "");
  ok("`unreadable` and `not available` are DIFFERENT answers about the same module",
    alertsBroken.available === true && alertsBlind.available === false,
    JSON.stringify([alertsBroken.available, alertsBlind.available]));
  const restoredParameters = await restoreCapabilities(wsA, OWNER, ["parameter.view"]);
  ok("CONTROL: parameter.view was really put back, so the de-identification test below is not passing against an unavailable module",
    hasCapability(restoredParameters, "parameter.view") &&
    (await parameterAlertIntelligence(admin, restoredParameters, range)).data?.open.count === 7,
    String(hasCapability(restoredParameters, "parameter.view")));

  // ══ F. DE-IDENTIFICATION ══════════════════════════════════════════════════════════════════════════
  //
  // ⚠ THE ASSERTION THAT MATTERS HERE IS THE SECOND ONE, NOT THE FIRST. "No name leaked" is true of a
  // module that returned nothing at all, which is how this pair read before the restores above were
  // added. The count must still be COMPLETE for the claim to be de-identification rather than absence.
  console.log("\n── §11: counts without names is a real state, not a degraded one ──");
  const noNames = await withoutCapability(wsA, OWNER, ["patient.view"]);
  const refsNoNames = await referralIntelligence(admin, noNames, range);
  const alertsNoNames = await parameterAlertIntelligence(admin, noNames, range);
  ok("WITHOUT patient.view NO PATIENT NAME REACHES EITHER NEW MODULE",
    !JSON.stringify(refsNoNames.data).includes("Referred Twice") &&
    !JSON.stringify(alertsNoNames.data).includes("Alerted Patient"),
    "a name leaked");
  ok("CONTROL: and both counts are still complete, so it is de-identification rather than a blanked panel",
    refsNoNames.data?.made.count === 4 && alertsNoNames.data?.open.count === 7,
    JSON.stringify([refsNoNames.data?.made.count, alertsNoNames.data?.open.count]));
  ok("CONTROL: and the names ARE there for a caller who holds patient.view, so the leak test is not vacuous",
    JSON.stringify(rd.made.sample).includes("Referred") &&
    JSON.stringify(ad.open.sample).includes("Alerted Patient"),
    JSON.stringify(rd.made.sample.slice(0, 1)));
  const restoredNames = await restoreCapabilities(wsA, OWNER, ["patient.view"]);
  ok("CONTROL: patient.view was really put back for the suite assertions that follow",
    hasCapability(restoredNames, "patient.view"), String(hasCapability(restoredNames, "patient.view")));

  // ══ G. THE ASSEMBLED SUITE: STILL NO RATE, AND THE SERIES STILL NOT MERGED ════════════════════════
  console.log("\n── The suite, with both new modules in it ──");
  const suite = await intelligenceSuite(admin, a.ctx, { days: 30 });
  const serialised = JSON.parse(JSON.stringify(suite));

  ok("BOTH NEW MODULES ARE IN THE SUITE AND BOTH HOLD DATA",
    suite.referrals.data !== null && suite.alerts.data !== null &&
    suite.referrals.data!.made.count === 4 && suite.alerts.data!.open.count === 7,
    JSON.stringify([suite.referrals.data?.made.count, suite.alerts.data?.open.count]));

  ok("NO RATE-SHAPED FIELD AND NO PERCENTAGE LITERAL ANYWHERE IN THE SERIALISED SUITE, referrals and alerts included",
    findRates(serialised).length === 0,
    JSON.stringify(findRates(serialised).slice(0, 6)));
  ok("CONTROL: the suite is not empty, so the assertion above is not passing over nothing",
    JSON.stringify(suite).length > 20000, String(JSON.stringify(suite).length));

  // ⚠ THE BOUNDARY SOMEBODY WILL TRIP OVER, ASSERTED RATHER THAN COMMENTED.
  //
  // The parameter engine's per-patient series carries a change expressed as a percentage -- correct
  // there, wrong here, and one careless spread would put it in this payload. The suite is asserted to
  // hold no `percent` key at all, and the control proves the detector would have caught one.
  ok("THE PARAMETER SERIES IS NOT MERGED INTO THIS PAYLOAD: no `percent` key exists anywhere in the suite",
    !JSON.stringify(suite).includes("\"percent\""),
    JSON.stringify(suite).slice(0, 0));
  ok("CONTROL: and if it had been, the detector would have said so -- a merged series fires on the change field",
    findRates({ alerts: { series: [{ change: { percent: 12, direction: "up" } }] } }).length > 0,
    JSON.stringify(findRates({ alerts: { series: [{ change: { percent: 12 } }] } })));

  ok("THE LIST OF UNBUILDABLE MODULES TRAVELS IN THE PAYLOAD, not only on the page",
    suite.notBuildable.length === 6 && suite.notBuildable.some(u => u.key === "medication_review"),
    suite.notBuildable.map(u => u.key).join(","));

  // ⚠ STRUCTURAL, over the two new subtrees rather than spot-checked on the figures somebody remembered.
  const newFigures = figuresWithFormula({ referrals: suite.referrals, alerts: suite.alerts });
  const undocumented = newFigures.filter(f =>
    String(f.o.formula).length < 30 || !Array.isArray(f.o.sources) || f.o.sources.length === 0);
  ok("EVERY FIGURE IN BOTH NEW MODULES IDENTIFIES ITS SOURCE DEFINITION -- a formula and at least one table.column",
    newFigures.length > 10 && undocumented.length === 0,
    `${newFigures.length} figures, ${undocumented.length} undocumented: ${undocumented.slice(0, 3).map(f => f.path).join(", ")}`);

  const grounding = suiteGroundingFigures(suite);
  ok("THE NEW COUNTS ARE OFFERED TO THE ASSISTANT, each with its formula and its sources",
    grounding.some(f => f.key === "referrals_referrals_made" && f.value === 4) &&
    grounding.some(f => f.key === "alerts_alerts_open" && f.value === 7) &&
    grounding.filter(f => /^referrals_|^alerts_/.test(f.key)).every(f => f.formula.length > 20 && f.sources.length > 0),
    grounding.filter(f => /^referrals_|^alerts_/.test(f.key)).map(f => `${f.key}=${f.value}`).join(","));
  ok("and a REFUSED figure is absent rather than present-and-null -- the referral comparison has no prior period yet",
    !grounding.some(f => f.key.includes("referrals_change")),
    grounding.map(f => f.key).join(","));

  // ══ H. THE COMPARISON, EARNED RATHER THAN ASSUMED ═════════════════════════════════════════════════
  console.log("\n── Comparisons: refused until the previous window was real AND held enough records ──");
  const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString();
  await admin.from("practice_workspace").update({ created_at: twoYearsAgo }).eq("id", wsA);
  const { data: aged } = await admin.from("practice_workspace").select("created_at").eq("id", wsA).maybeSingle();
  ok("FIXTURE: the practice really was backdated two years",
    String((aged as any)?.created_at ?? "").startsWith(twoYearsAgo.slice(0, 4)),
    String((aged as any)?.created_at));

  // Four referrals already sit in the current window. Two in the prior window is 6 observations -- BELOW
  // the floor of 10, which is the gate this half proves.
  const priorRefs = [40, 45].map(d => ({
    workspace_id: wsA, patient_id: p2, referred_to: "Prior Window Clinic", reason: "Prior",
    status: "made", referred_on: dueDateFrom(today, -d), created_by: OWNER, updated_by: OWNER,
  }));
  const { error: priorError } = await admin.from("practice_referral").insert(priorRefs);
  const scarce = await referralIntelligence(admin, a.ctx, await intelRange(admin, wsA, { days: 30 }));
  ok("FIXTURE: two referrals were really written into the previous window",
    !priorError, priorError?.message ?? "");
  ok("BELOW THE OBSERVATION FLOOR THE COMPARISON IS STILL REFUSED, even though the previous window is now real",
    scarce.data?.change.status === "unknowable" && scarce.data?.change.change === null &&
    /needed before a difference means anything/.test(scarce.data?.change.reason ?? ""),
    JSON.stringify({ status: scarce.data?.change.status, reason: scarce.data?.change.reason }));

  // Now push both windows over the floor: +2 current and +5 prior gives 6 and 7 = 13 observations.
  const more = [
    ...[1, 2].map(d => ({ offset: -d })),
    ...[41, 42, 43, 44, 46].map(d => ({ offset: -d })),
  ].map(x => ({
    workspace_id: wsA, patient_id: p2, referred_to: "Volume Clinic", reason: "Volume",
    status: "made", referred_on: dueDateFrom(today, x.offset), created_by: OWNER, updated_by: OWNER,
  }));
  const { error: moreError, data: moreRows } = await admin.from("practice_referral").insert(more).select("id");
  ok("FIXTURE: seven more referrals were really written, two in this window and five in the one before",
    !moreError && ((moreRows ?? []) as any[]).length === 7,
    moreError?.message ?? String(((moreRows ?? []) as any[]).length));

  const compared = await referralIntelligence(admin, a.ctx, await intelRange(admin, wsA, { days: 30 }));
  const change = compared.data!.change;
  // ⚠ THE EXACT SIGNED COUNT. "change is a number" would pass on 0; the fixture makes the answer -1.
  ok("CONTROL: WITH A REAL PREVIOUS WINDOW AND ENOUGH RECORDS THE COMPARISON IS COMPUTED, as a signed count",
    change.status === "ok" && change.current === 6 && change.prior === 7 && change.change === -1,
    JSON.stringify({ current: change.current, prior: change.prior, change: change.change }));
  ok("and it says so in words rather than as a percentage, with the floor it had to clear named in the engine",
    /never as a percentage/.test(change.formula) && MIN_OBSERVATIONS_FOR_COMPARISON === 10,
    change.formula.slice(-80));
  ok("no rate has appeared now that a comparison exists -- the detector is run again over the new payload",
    findRates(JSON.parse(JSON.stringify(compared))).length === 0,
    JSON.stringify(findRates(JSON.parse(JSON.stringify(compared))).slice(0, 4)));

  // ══ I. ISOLATION ══════════════════════════════════════════════════════════════════════════════════
  console.log("\n── One practice cannot see another's referrals or alerts ──");
  const bSuite = await intelligenceSuite(admin, b.ctx, { days: 365 });
  ok("B'S SUITE COUNTS NONE OF A'S REFERRALS AND NONE OF A'S ALERTS",
    bSuite.referrals.data?.made.count === 0 && bSuite.referrals.data?.awaitingNews.count === 0 &&
    bSuite.alerts.data?.open.count === 0,
    JSON.stringify({
      referrals: bSuite.referrals.data?.made.count, awaiting: bSuite.referrals.data?.awaitingNews.count,
      alerts: bSuite.alerts.data?.open.count,
    }));
  ok("and A's are non-empty, so the isolation test is not vacuous",
    (suite.referrals.data?.made.count ?? 0) > 0 && (suite.alerts.data?.open.count ?? 0) > 0);
  ok("B still gets the unbuildable list, because \"not built\" is a fact about the product rather than about a practice",
    bSuite.notBuildable.length === 6);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
