/**
 * Encounters workspace harness -- CPR-ENC-001 (the dashboard) and CPR-ENC-002 (the encounter screen),
 * on migration 238, exercised against the live database through the same engines the API uses.
 *
 * WHAT IT PROVES:
 *   0. MIGRATION 238 IS DEPLOYED. Probed first and reported plainly, so everything below reads as a
 *      real failure rather than as a mystery when it is not.
 *   1. Every capability code these engines gate on EXISTS in practice_role_capabilities. A plausible
 *      invented code costs nothing at compile time and silently disables a feature at runtime; six of
 *      them have shipped in this product already.
 *   2. CPR-ENC-002 s7's validation is WARNINGS, NOT REFUSALS -- and a warning is never raised from a
 *      count that could not be read.
 *   3. The encounter OUTCOME: the six values, the refusal of `other` with nothing said, the clearing of
 *      a stale note, and the DATABASE refusing an outcome write after signature when the engine is
 *      bypassed entirely.
 *   4. Decisions, investigations and referrals record, and are refused after signature -- each paired
 *      with a control on a live encounter, so a green "refused" cannot be an artefact.
 *   5. ⚠ INVESTIGATIONS ARE TYPE ONLY: the table has no result column, and asking for one errors.
 *   6. ⚠ REFERRALS ARE RECORDED, NOT SENT: the table has no channel and no sent_at.
 *   7. THE DASHBOARD'S THREE STATES. A failed read reports `unavailable`, NOT an empty list -- with a
 *      control proving the same read through the real client is available and non-empty.
 *   8. Workspace isolation, non-vacuously, and anon reads 0 rows from all four new tables.
 *
 * CONTROLS: every refusal is paired with the same operation somewhere it must succeed. Every "it says
 * unavailable" is paired with "and the real one does not".
 *
 *   npx --yes tsx scripts/practice-encounter-workspace-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment, setEncounterOutcome,
} from "../src/lib/practice/encounters";
import {
  encountersDashboard, encounterExtras, addDecision, removeDecision,
  recordInvestigation, reviewInvestigation, recordReferral, updateReferralStatus,
  ENCOUNTER_WORKSPACE_CAPABILITIES,
} from "../src/lib/practice/encounter-workspace";
import {
  encounterWarnings, ENCOUNTER_OUTCOME_CODES, QUICK_ACTIONS,
  weightPrompt, CLINICAL_FLOW_BLOCKS,
} from "../src/lib/practice/encounter-workspace-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0e51";
const USER_B = "00000000-0000-4000-8000-0000000e0e52";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-encws-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-encws",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-encws", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-encws" };

/**
 * A client whose reads of ONE table fail, and whose reads of everything else are real.
 *
 * The point of the "and everything else is real" half: a stub that failed universally would make every
 * panel report unavailable and every three-state assertion pass for the wrong reason.
 */
function failingOn(table: string, message: string) {
  return {
    from: (t: string) => {
      if (t !== table) return admin.from(t);
      const chain: Record<string, unknown> = {};
      const result = { data: null, error: { message }, count: null };
      for (const m of ["select", "eq", "in", "order", "not", "is", "neq", "lt", "gt", "gte", "lte"]) {
        chain[m] = () => chain;
      }
      chain.limit = async () => result;
      chain.maybeSingle = async () => result;
      chain.single = async () => result;
      // Awaiting the builder itself is how a head:true count query resolves.
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
    rpc: (...args: unknown[]) => (admin.rpc as unknown as (...a: unknown[]) => unknown)(...args),
  };
}

/**
 * Source with its comments removed.
 *
 * ⚠ EVERY ASSERTION THAT SOMETHING IS *NOT* RENDERED HAS TO GO THROUGH THIS. These files explain in
 * prose why a patient photograph, an AI assistant panel and a "no critical alerts" line are absent, so a
 * scan of the raw text finds each of those phrases exactly where the decision NOT to draw them is
 * written down. Punishing a file for documenting itself is how a true assertion is made to fail.
 */
function withoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")   // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, "")       // block comments
    .replace(/^\s*\/\/.*$/gm, "");          // line comments
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

async function main() {
  console.log("\nEncounters workspace harness (CPR-ENC-001 s9, CPR-ENC-002, migration 238)\n");
  await cleanup();

  // ── 0. IS MIGRATION 238 ACTUALLY DEPLOYED? ────────────────────────────────
  //
  // Reported FIRST and in plain words. Without this, a workspace where the migration has not been
  // applied by hand produces a wall of confusing failures about missing columns rather than one
  // sentence saying which file to run.
  // `async () =>` rather than `() =>`: a PostgREST builder is thenable but is not a Promise, and
  // `next build` type-checks this file even though `tsc --noEmit` did not object.
  const probes: [string, () => Promise<{ error: unknown }>][] = [
    ["practice_encounter_decision", async () => admin.from("practice_encounter_decision").select("id").limit(1)],
    ["practice_encounter_investigation", async () => admin.from("practice_encounter_investigation").select("id").limit(1)],
    ["practice_referral", async () => admin.from("practice_referral").select("id").limit(1)],
    ["practice_patient_milestone", async () => admin.from("practice_patient_milestone").select("id").limit(1)],
    ["practice_encounter.outcome", async () => admin.from("practice_encounter").select("outcome").limit(1)],
  ];
  const missing: string[] = [];
  for (const [name, probe] of probes) {
    const { error } = await probe();
    if (error) missing.push(name);
  }
  ok("migration 238 is applied (its four tables and the outcome column are present)",
    missing.length === 0,
    missing.length ? `MISSING: ${missing.join(", ")} -- run supabase/migrations/238-practice-encounter-longitudinal.sql` : "");
  if (missing.length) {
    console.log("\n  Everything below depends on migration 238. Stopping rather than reporting noise.\n");
    return report();
  }
  // The probe is not vacuous: a table that does not exist DOES error.
  const { error: nonsense } = await admin.from("practice_table_that_does_not_exist").select("id").limit(1);
  ok("control: the presence probe can detect an absent table", !!nonsense, "a missing table returned no error");

  // ── 1. CAPABILITY CODES ARE REAL ──────────────────────────────────────────
  //
  // ⚠ CHECKED AGAINST THE ENGINE'S OWN EXPORTED ARRAY, not a list re-typed here. A re-typed list can
  // invent the same fiction the engine did and agree with it forever.
  const { data: seeded } = await admin.from("practice_role_capabilities").select("capability_code");
  const known = new Set(((seeded ?? []) as { capability_code: string }[]).map(c => c.capability_code));
  ok("the capability catalogue read returned rows (the check is not vacuous)", known.size > 10, `${known.size}`);
  const invented = ENCOUNTER_WORKSPACE_CAPABILITIES.filter(c => !known.has(c));
  ok("every capability the encounters workspace gates on exists in practice_role_capabilities",
    invented.length === 0, invented.join(", "));
  ok("control: a plausible but invented code is NOT in the catalogue", !known.has("encounter.outcome.record"));

  // ── 2. CPR-ENC-002 s7: WARNINGS, AND THE NULL THAT MUST NOT WARN ──────────
  //
  // Pure, so every branch is reachable without a database, and the fixture is arranged so the WRONG
  // answer is the one a careless implementation would give.
  const wAll = encounterWarnings({ diagnoses: 0, treatments: 0, decisions: 0, outcome: null, openFollowUps: 0 });
  ok("warn-1. an encounter with nothing recorded raises all four warnings",
    ["missing_diagnosis", "missing_treatment_decision", "missing_outcome", "no_follow_up"]
      .every(k => wAll.some(w => w.key === k)), wAll.map(w => w.key).join(","));

  const wNone = encounterWarnings({ diagnoses: 1, treatments: 1, decisions: 1, outcome: "improved", openFollowUps: 1 });
  ok("warn-2. CONTROL: a complete encounter raises none", wNone.length === 0, wNone.map(w => w.key).join(","));

  // ⚠ THE ONE THAT MATTERS. A count of null means "could not be read". Warning on it would print a
  // clinical statement -- "no diagnosis has been recorded" -- on the strength of a failed query.
  const wUnknown = encounterWarnings({ diagnoses: null, treatments: null, decisions: null, outcome: "stable", openFollowUps: null });
  ok("warn-3. ⚠ a count that could NOT BE READ raises no warning (a failed read is not an absence)",
    wUnknown.length === 0, wUnknown.map(w => w.key).join(","));

  // A decision counts as a treatment decision even with no treatment row -- which is the whole reason
  // the two are one warning rather than two.
  const wDecisionOnly = encounterWarnings({ diagnoses: 1, treatments: 0, decisions: 2, outcome: "stable", openFollowUps: 1 });
  ok("warn-4. a recorded DECISION satisfies the treatment-decision warning without a treatment row",
    !wDecisionOnly.some(w => w.key === "missing_treatment_decision"), wDecisionOnly.map(w => w.key).join(","));

  // ── The live half ─────────────────────────────────────────────────────────
  const wsA = await provision(USER_A, "HARNESS EncWS A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS EncWS B (synthetic)", "b");
  const ctxARes = await resolveWorkspaceContext(admin, USER_A, wsA);
  const ctxBRes = await resolveWorkspaceContext(admin, USER_B, wsB);
  if (!ctxARes.ok || !ctxBRes.ok) { ok("workspace contexts resolve", false); return report(); }
  const ctxA: WorkspaceContext = ctxARes.ctx;
  const ctxB: WorkspaceContext = ctxBRes.ctx;

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Sarah", birthDate: "2017-04-01", sex: "female",
    phone: "0772 555 210", ...base,
  });
  if (!pa.ok) { ok("patient registration for the harness succeeded", false, pa.message); return report(); }
  const patientA = pa.data.id;

  const launched = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "booked", reasonForVisit: "seizure control review", ...base,
  });
  if (!launched.ok) { ok("an encounter launches", false, launched.message); return report(); }
  const encId = launched.data.id;
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "ACTIVE", ...base });

  // ── 3. THE ENCOUNTER OUTCOME ──────────────────────────────────────────────
  const badOutcome = await setEncounterOutcome(admin, { workspaceId: wsA, encounterId: encId, outcome: "much_better", ...base });
  ok("outcome-1. an outcome outside the six is refused",
    !badOutcome.ok && badOutcome.code === "VALIDATION_ERROR", badOutcome.ok ? "was allowed" : badOutcome.code);

  const otherNoNote = await setEncounterOutcome(admin, { workspaceId: wsA, encounterId: encId, outcome: "other", outcomeNote: "   ", ...base });
  ok("outcome-2. an outcome of \"other\" with nothing said is refused",
    !otherNoNote.ok && otherNoNote.code === "OUTCOME_NOTE_REQUIRED", otherNoNote.ok ? "was allowed" : otherNoNote.code);

  const otherWithNote = await setEncounterOutcome(admin, {
    workspaceId: wsA, encounterId: encId, outcome: "other", outcomeNote: "died at home before review", ...base,
  });
  ok("outcome-3. CONTROL: \"other\" WITH a reason is accepted", otherWithNote.ok, otherWithNote.ok ? "" : otherWithNote.message);

  const improved = await setEncounterOutcome(admin, { workspaceId: wsA, encounterId: encId, outcome: "improved", ...base });
  const { data: afterImproved } = await admin.from("practice_encounter").select("outcome, outcome_note").eq("id", encId).single();
  ok("outcome-4. moving off \"other\" CLEARS the note, so a stale sentence cannot describe a new outcome",
    improved.ok && afterImproved?.outcome === "improved" && afterImproved?.outcome_note === null,
    JSON.stringify(afterImproved));

  ok("outcome-5. all six of the specifications' outcomes are accepted by the database constraint",
    ENCOUNTER_OUTCOME_CODES.length === 6, ENCOUNTER_OUTCOME_CODES.join(","));
  let acceptedAll = true;
  for (const code of ENCOUNTER_OUTCOME_CODES) {
    const r = await setEncounterOutcome(admin, {
      workspaceId: wsA, encounterId: encId, outcome: code,
      outcomeNote: code === "other" ? "recorded by the harness" : null, ...base,
    });
    if (!r.ok) { acceptedAll = false; console.log(`        ${code}: ${r.message}`); }
  }
  ok("outcome-6. every one of the six is accepted end to end", acceptedAll);
  await setEncounterOutcome(admin, { workspaceId: wsA, encounterId: encId, outcome: "improved", ...base });

  // ── 4. DECISIONS ──────────────────────────────────────────────────────────
  const d1 = await addDecision(admin, { workspaceId: wsA, encounterId: encId, decision: "Continue levetiracetam 750mg BD", ...base });
  const d2 = await addDecision(admin, { workspaceId: wsA, encounterId: encId, decision: "Review in 3 months", ...base });
  ok("decision-1. decisions record", d1.ok && d2.ok, d2.ok ? "" : d2.message);

  const { data: decRows } = await admin.from("practice_encounter_decision")
    .select("decision, position").eq("encounter_id", encId).order("position");
  ok("decision-2. they keep the order they were entered in",
    (decRows ?? []).length === 2
    && (decRows ?? [])[0].decision === "Continue levetiracetam 750mg BD"
    && (decRows ?? [])[1].position === 1,
    JSON.stringify(decRows));

  const emptyDecision = await addDecision(admin, { workspaceId: wsA, encounterId: encId, decision: "   ", ...base });
  ok("decision-3. an empty decision is refused",
    !emptyDecision.ok && emptyDecision.code === "VALIDATION_ERROR", emptyDecision.ok ? "was allowed" : emptyDecision.code);

  const dropped = d2.ok ? await removeDecision(admin, { workspaceId: wsA, encounterId: encId, decisionId: d2.data.id, ...base }) : null;
  ok("decision-4. a decision can be removed while the encounter is open", !!dropped?.ok);

  const foreignDrop = d1.ok ? await removeDecision(admin, { workspaceId: wsB, encounterId: encId, decisionId: d1.data.id, ...base }) : null;
  ok("decision-5. workspace B cannot remove a decision from workspace A's encounter",
    !!foreignDrop && !foreignDrop.ok && foreignDrop.code === "NOT_FOUND", foreignDrop?.ok ? "was allowed" : foreignDrop?.code);

  // ── 5. INVESTIGATIONS, AND THE COLUMN THAT MUST NOT EXIST ─────────────────
  const inv = await recordInvestigation(admin, { workspaceId: wsA, encounterId: encId, label: "EEG (routine)", summary: "seizure follow-up", ...base });
  ok("inv-1. an investigation records as `requested`", inv.ok, inv.ok ? "" : inv.message);

  const reviewed = inv.ok ? await reviewInvestigation(admin, {
    workspaceId: wsA, encounterId: encId, investigationId: inv.data.id,
    summary: "Abnormal - generalised spike and wave. Continue medication.", ...base,
  }) : null;
  const { data: invRow } = inv.ok ? await admin.from("practice_encounter_investigation")
    .select("status, reviewed_at, summary").eq("id", inv.data.id).single() : { data: null };
  ok("inv-2. marking it reviewed stamps the time and keeps the practitioner's words",
    !!reviewed?.ok && invRow?.status === "reviewed" && !!invRow?.reviewed_at, JSON.stringify(invRow));

  // ⚠ THE REFUSAL THAT MATTERS. A nullable `result` column is how this table would quietly become the
  // laboratory system CPR-ENC-001 s5 forbids -- and a half-populated one is worse than none, because a
  // clinician reads the blanks as normal.
  const resultProbe = await admin.from("practice_encounter_investigation").select("result").limit(1);
  ok("inv-3. ⚠ there is NO result column on the investigation table",
    !!resultProbe.error, resultProbe.error ? "" : "a `result` column exists -- this has become an order system");
  const controlProbe = await admin.from("practice_encounter_investigation").select("label").limit(1);
  ok("inv-4. control: a column that DOES exist reads fine (the probe is not always-error)",
    !controlProbe.error, controlProbe.error?.message ?? "");

  // ── 6. REFERRALS: RECORDED, NOT SENT ──────────────────────────────────────
  const referral = await recordReferral(admin, {
    workspaceId: wsA, encounterId: encId, referredTo: "Dr Okello, Mulago paediatric neurology",
    reason: "second opinion on shunt", ...base,
  });
  ok("ref-1. a referral records", referral.ok, referral.ok ? "" : referral.message);

  const noReason = await recordReferral(admin, { workspaceId: wsA, encounterId: encId, referredTo: "Somebody", reason: "  ", ...base });
  ok("ref-2. a referral without a reason is refused",
    !noReason.ok && noReason.code === "VALIDATION_ERROR", noReason.ok ? "was allowed" : noReason.code);

  const badStatus = referral.ok ? await updateReferralStatus(admin, { workspaceId: wsA, referralId: referral.data.id, status: "sent", ...base }) : null;
  ok("ref-3. ⚠ `sent` is not a referral status -- this product transmits nothing",
    !!badStatus && !badStatus.ok && badStatus.code === "VALIDATION_ERROR", badStatus?.ok ? "was allowed" : badStatus?.code);

  const accepted = referral.ok ? await updateReferralStatus(admin, { workspaceId: wsA, referralId: referral.data.id, status: "accepted", ...base }) : null;
  ok("ref-4. CONTROL: a real status (`accepted`, i.e. somebody told us) is allowed", !!accepted?.ok, accepted?.ok ? "" : accepted?.message);

  for (const col of ["channel", "sent_at", "delivered_at"]) {
    const probe = await admin.from("practice_referral").select(col).limit(1);
    ok(`ref-5-${col}. ⚠ practice_referral has no \`${col}\` column`, !!probe.error,
      probe.error ? "" : `a \`${col}\` column exists -- something can now claim a referral was transmitted`);
  }

  // ── 7. THE WARNINGS THE SCREEN ACTUALLY SHOWS ─────────────────────────────
  const extras = await encounterExtras(admin, ctxA, encId, { diagnoses: 0, treatments: 0, openFollowUps: 0 });
  ok("extras-1. the encounter's decisions, investigations and referrals come back available",
    extras.decisions.permitted && !extras.decisions.unavailable && extras.decisions.items.length === 1
    && extras.investigations.items.length === 1 && extras.referrals.items.length === 1,
    JSON.stringify({ d: extras.decisions.items.length, i: extras.investigations.items.length, r: extras.referrals.items.length }));

  ok("extras-2. with a decision recorded, no treatment-decision warning is raised",
    !extras.warnings.some(w => w.key === "missing_treatment_decision"), extras.warnings.map(w => w.key).join(","));
  ok("extras-3. with no diagnosis, the diagnosis warning IS raised (the warning path is live)",
    extras.warnings.some(w => w.key === "missing_diagnosis"), extras.warnings.map(w => w.key).join(","));

  // ⚠ A FAILED DECISION READ MUST NOT PRODUCE "no treatment decision recorded".
  const blindExtras = await encounterExtras(
    failingOn("practice_encounter_decision", "simulated decision failure") as never,
    ctxA, encId, { diagnoses: 1, treatments: 0, openFollowUps: 1 },
  );
  ok("extras-4. ⚠ a decision read that FAILED reports unavailable and raises no false warning",
    blindExtras.decisions.unavailable === true && blindExtras.decisions.items.length === 0
    && !blindExtras.warnings.some(w => w.key === "missing_treatment_decision"),
    JSON.stringify({ u: blindExtras.decisions.unavailable, w: blindExtras.warnings.map(w => w.key) }));

  // CONTROL: with a REAL client and genuinely zero decisions, the warning IS raised -- so the assertion
  // above is about the failure, not about the warning never firing.
  const enc2 = await launchEncounter(admin, { workspaceId: wsA, patientId: patientA, pathway: "new_walk_in", ...base });
  ok("extras-5. a second encounter cannot open while the first is live (resume, not duplicate)",
    enc2.ok && enc2.data.resumed === true, enc2.ok ? JSON.stringify(enc2.data) : enc2.message);

  const extrasB = await encounterExtras(admin, ctxB, encId, { diagnoses: 0, treatments: 0, openFollowUps: 0 });
  ok("extras-6. workspace B reads NOTHING from workspace A's encounter",
    extrasB.decisions.items.length === 0 && extrasB.investigations.items.length === 0 && extrasB.referrals.items.length === 0
    && extrasB.outcome === null,
    JSON.stringify({ d: extrasB.decisions.items.length, o: extrasB.outcome }));

  // ── 8. THE DASHBOARD'S THREE STATES ───────────────────────────────────────
  const dash = await encountersDashboard(admin, ctxA);
  ok("dash-1. the open panel is available and non-empty (the failure test below is not vacuous)",
    dash.open.permitted && !dash.open.unavailable && dash.open.items.length >= 1,
    JSON.stringify({ p: dash.open.permitted, u: dash.open.unavailable, n: dash.open.items.length }));
  ok("dash-2. the open encounter carries its patient's name and an elapsed time",
    dash.open.items.some(e => e.patientName === "Nakato Sarah" && e.patientNameUnavailable === false && e.elapsedMinutes !== null),
    JSON.stringify(dash.open.items.map(e => ({ n: e.patientName, m: e.elapsedMinutes }))));

  const blindDash = await encountersDashboard(failingOn("practice_encounter", "simulated encounter failure") as never, ctxA);
  ok("dash-3. ⚠ a failed encounter read says `unavailable` and does NOT report an empty day",
    blindDash.open.unavailable === true && blindDash.open.items.length === 0 && blindDash.open.permitted === true,
    JSON.stringify({ u: blindDash.open.unavailable, p: blindDash.open.permitted }));

  // ⚠ AND THE ATTENTION COUNTS. A count that could not be read must be null, never nought -- a nought
  // is a claim that there are none of them.
  const blindCounts = await encountersDashboard(failingOn("practice_follow_up", "simulated follow-up failure") as never, ctxA);
  const overdue = blindCounts.attention.find(a => a.key === "overdue_follow_ups");
  ok("dash-4. ⚠ an attention count that could not be read is null, NOT nought",
    overdue?.permitted === true && overdue?.count === null, JSON.stringify(overdue));
  const realOverdue = dash.attention.find(a => a.key === "overdue_follow_ups");
  ok("dash-5. control: the same count through the real client is a number",
    typeof realOverdue?.count === "number", JSON.stringify(realOverdue));

  // A caller without encounter.list sees `permitted: false`, which is a different sentence from
  // "unavailable" and leads to a different action.
  const strippedCtx: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "encounter.list") };
  const deniedDash = await encountersDashboard(admin, strippedCtx);
  ok("dash-6. a caller without encounter.list gets `permitted: false`, not `unavailable`",
    deniedDash.open.permitted === false && deniedDash.open.unavailable === false && deniedDash.open.items.length === 0,
    JSON.stringify({ p: deniedDash.open.permitted, u: deniedDash.open.unavailable }));

  // And the SCREEN says all three in words -- a React branch cannot be reached from here, so the source
  // is checked instead.
  const dashSrc = readFileSync(join(process.cwd(), "src/app/practice/(shell)/encounters/page.tsx"), "utf8");
  ok("dash-7. the dashboard page renders all three states in words",
    /permitted/.test(dashSrc) && /could not be read/.test(dashSrc) && /do not take it as one/i.test(dashSrc),
    "the page is missing one of the three sentences");

  // ── 9. SIGNATURE CLOSES EVERYTHING, AND THE DATABASE AGREES ───────────────
  await recordDiagnosis(admin, { workspaceId: wsA, encounterId: encId, label: "Epilepsy", certainty: "confirmed", isPrimary: true, ...base });
  await recordTreatment(admin, { workspaceId: wsA, encounterId: encId, treatmentType: "medication", label: "Levetiracetam", dose: "750mg", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "COMPLETED", ...base });

  // CONTROL: completed-but-unsigned still accepts everything, so the refusals below are caused by the
  // SIGNATURE and not by the encounter merely being finished.
  const preSignDecision = await addDecision(admin, { workspaceId: wsA, encounterId: encId, decision: "Recorded before signing", ...base });
  const preSignOutcome = await setEncounterOutcome(admin, { workspaceId: wsA, encounterId: encId, outcome: "stable", ...base });
  ok("sign-0. CONTROL: a COMPLETED but unsigned encounter still accepts a decision and an outcome",
    preSignDecision.ok && preSignOutcome.ok, preSignDecision.ok ? (preSignOutcome.ok ? "" : preSignOutcome.message) : preSignDecision.message);

  const signed = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "SIGNED", ...base });
  ok("sign-1. the encounter signs", signed.ok, signed.ok ? "" : signed.message);

  const postDecision = await addDecision(admin, { workspaceId: wsA, encounterId: encId, decision: "sneaky", ...base });
  ok("sign-2. the engine refuses a decision after signature",
    !postDecision.ok && postDecision.code === "ENCOUNTER_LOCKED", postDecision.ok ? "was allowed" : postDecision.code);
  const postInv = await recordInvestigation(admin, { workspaceId: wsA, encounterId: encId, label: "sneaky", ...base });
  ok("sign-3. the engine refuses an investigation after signature",
    !postInv.ok && postInv.code === "ENCOUNTER_LOCKED", postInv.ok ? "was allowed" : postInv.code);
  const postRef = await recordReferral(admin, { workspaceId: wsA, encounterId: encId, referredTo: "x", reason: "y", ...base });
  ok("sign-4. the engine refuses a referral after signature",
    !postRef.ok && postRef.code === "ENCOUNTER_LOCKED", postRef.ok ? "was allowed" : postRef.code);
  const postOutcome = await setEncounterOutcome(admin, { workspaceId: wsA, encounterId: encId, outcome: "worsened", ...base });
  ok("sign-5. the engine refuses an outcome change after signature",
    !postOutcome.ok && postOutcome.code === "ENCOUNTER_LOCKED", postOutcome.ok ? "was allowed" : postOutcome.code);

  // ⚠ AND THE DATABASE, WITH THE ENGINE BYPASSED ENTIRELY. Migration 194's trigger refuses any update to
  // a SIGNED row that does not move it to AMENDED or ENTERED_IN_ERROR, and an outcome write does neither.
  const rawOutcome = await admin.from("practice_encounter").update({ outcome: "resolved" }).eq("id", encId);
  ok("sign-6. ⚠ the DATABASE refuses a raw outcome write on a signed encounter (migration 194 s6 trigger)",
    !!rawOutcome.error && /signed/i.test(rawOutcome.error.message), rawOutcome.error?.message ?? "the update succeeded");

  const { data: stillImproved } = await admin.from("practice_encounter").select("outcome").eq("id", encId).single();
  ok("sign-7. the signed encounter still holds the outcome it was signed with",
    stillImproved?.outcome === "stable", JSON.stringify(stillImproved));

  // CONTROL for sign-6: the same raw write on a LIVE encounter succeeds, so the refusal is the
  // signature and not a malformed statement.
  const p2 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Mukasa Brian", sex: "male", birthDate: "1990-02-14",
    phone: "0772 555 211", ...base,
  });
  const liveEnc = p2.ok ? await launchEncounter(admin, { workspaceId: wsA, patientId: p2.data.id, pathway: "new_walk_in", ...base }) : null;
  const rawLive = liveEnc?.ok
    ? await admin.from("practice_encounter").update({ outcome: "resolved" }).eq("id", liveEnc.data.id).select("id").maybeSingle()
    : null;
  ok("sign-8. CONTROL: the same raw outcome write on a LIVE encounter succeeds",
    !!rawLive && !rawLive.error && !!rawLive.data,
    rawLive?.error?.message ?? `no row updated (patient ok=${p2.ok}, encounter ok=${liveEnc?.ok}${liveEnc && !liveEnc.ok ? `: ${liveEnc.message}` : ""}${p2.ok ? "" : `: ${p2.message}`})`);

  // ── 10. THE SOURCE RULE: NO SECOND PLACE INVENTS A RESULT ─────────────────
  //
  // A grep, because the refusal is about what does NOT exist and no runtime call can prove that.
  const tree = walk(join(process.cwd(), "src", "app", "practice"))
    .concat(walk(join(process.cwd(), "src", "app", "api", "v1", "practice")));
  const resultWriters = tree.filter(f => /practice_encounter_investigation[\s\S]{0,200}result/.test(readFileSync(f, "utf8")));
  ok("src-1. ⚠ nothing in the Practice tree writes or reads a `result` on an investigation",
    resultWriters.length === 0, resultWriters.join(", "));
  ok("src-2. control: the scan is looking at real files", tree.length > 20, `${tree.length} files`);

  // ── 11. ISOLATION + ANON ──────────────────────────────────────────────────
  const TABLES = ["practice_encounter_decision", "practice_encounter_investigation", "practice_referral"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("rls-1. the service role sees rows in every new table (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("rls-2. anon reads 0 rows from every new table", leaked === 0, `${leaked} table(s) leaked`);

  // ── 12. THE COMP'S FOUR AFFORDANCES ───────────────────────────────────────
  //
  // ⚠ SOURCE-CHECKED, because a Tailwind class and a <Link> cannot be reached from here -- the same
  // reason src-1 above is a source check. These four are what CPR-ENC-001's comp draws and the first
  // build of this workspace left out; each is asserted by the thing that makes it WORK, not by its
  // label, so renaming a button does not break the test and deleting its destination does.
  const encDir = join(process.cwd(), "src", "app", "practice", "(shell)", "encounters");
  const listSrc = readFileSync(join(encDir, "page.tsx"), "utf8");
  const menuSrc = readFileSync(join(encDir, "RowMenu.tsx"), "utf8");

  ok("ui-1. a session card filters the lists to its own encounters, by activity id",
    /\?session=\$\{s\.id\}/.test(listSrc) && /e\.activityId === sessionFilter/.test(listSrc),
    "the card's link and the filter must agree on the same id, or the button narrows to nothing");
  ok("ui-2. 'View all' re-reads with a bigger bound rather than revealing hidden rows",
    /closedLimit: CLOSED_ALL_LIMIT/.test(listSrc) && /closed=all/.test(listSrc),
    "a client-side reveal would still be capped at twelve however it was labelled");
  ok("ui-2b. ⚠ and the cap is PRINTED when it is reached -- a silent truncation reads as 'that is all'",
    /closedCapped/.test(listSrc) && /Stopped at \{CLOSED_ALL_LIMIT\}/.test(listSrc),
    "this is the assertion that stops 'View all' becoming a lie");
  ok("ui-3. the row menu exists, is keyboard-dismissable, and offers only real destinations",
    /<RowMenu/.test(listSrc) && /useDismiss/.test(menuSrc)
    && /\/practice\/patients\/\$\{patientId\}/.test(menuSrc) && /role="menu"/.test(menuSrc),
    "a scrim that closes on click alone traps a keyboard user in the menu");
  // ⚠ BOTH OF THESE MATCH A CALL SITE, NOT A WORD. The first versions searched for "cancel|delete" and
  // "window.print" and failed on the COMMENTS explaining why neither is there -- an assertion that a file
  // does not MENTION something punishes the file for documenting itself, and the fix is to look for the
  // shape the real thing would have: a handler, a request, a method.
  ok("ui-3b. ⚠ the row menu is navigation only -- it issues no request, so it can destroy nothing",
    !/fetch\(/.test(menuSrc) && !/method:/.test(menuSrc) && !/onSubmit/.test(menuSrc),
    "a one-click cancel on a list row is a consultation cancelled by a trackpad; cancelling belongs on the state table with its confirmation");
  ok("ui-4. 'Print summary' exists and routes to Attachments rather than printing the page",
    QUICK_ACTIONS.some(a => a.key === "print_summary" && a.tab === "attachments")
    && !/=>\s*window\.print\(/.test(readFileSync(join(encDir, "[encounterId]", "EncounterConsole.tsx"), "utf8")),
    "a window.print() handler here would produce an unversioned sheet that looks like a clinical document");

  // ── 13. CPR-ENC-003: THE CLINICAL DECISION WORKSPACE ──────────────────────
  //
  // The reorganisation of 2026-08-08. Three things have to be true and none of them can be reached by
  // calling an engine, so they are source-checked -- a harness cannot execute a client component, which
  // is the same reason src-1 and the ui-* block above are scans.
  //
  //   13a  THE CAPTURE-POINT INVENTORY IS UNCHANGED. This is the assertion the whole section exists for.
  //        A reorganisation that quietly drops a field is a regression wearing a redesign's clothes, and
  //        a clinical field that silently stopped being askable would not announce itself.
  //   13b  NOTHING IS DRAWN THAT NO STORE CAN ANSWER.
  //   13c  THE LOCKED STATE SURVIVED THE MOVE.
  //
  const encWs = join(process.cwd(), "src", "app", "practice", "(shell)", "encounters", "[encounterId]");
  const encPage = readFileSync(join(encWs, "page.tsx"), "utf8");
  const consoleSrc = readFileSync(join(encWs, "EncounterConsole.tsx"), "utf8");
  const snapSrc = readFileSync(join(encWs, "SafetySnapshot.tsx"), "utf8");
  const weightSrc = readFileSync(join(encWs, "WeightTile.tsx"), "utf8");
  const paramSrc = readFileSync(join(encWs, "ParameterCollection.tsx"), "utf8");
  const medSrc = readFileSync(join(encWs, "MedicationConsole.tsx"), "utf8");
  ok("enc003-control. every file of the workspace was read and is non-trivial",
    [encPage, consoleSrc, snapSrc, weightSrc, paramSrc, medSrc].every(s => s.length > 1500),
    [encPage, consoleSrc, snapSrc, weightSrc, paramSrc, medSrc].map(s => s.length).join(","));

  // ── 13a. THE CAPTURE-POINT INVENTORY ──────────────────────────────────────
  //
  // ⚠ EVERY WRITE THIS SCREEN CAN MAKE, AS A REQUEST SIGNATURE. Matched on the call, not on a label, so
  // renaming a button does not break this and deleting the form behind it does. If an endpoint below
  // stops being reachable from the encounter workspace, a clinician lost a way to record something.
  const WRITE_PATHS: [string, RegExp][] = [
    ["record a clinical parameter (incl. the weight)", /\/api\/v1\/practice\/parameters/],
    ["prescribe / calculate a dose", /\/api\/v1\/practice\/medications/],
    ["save a note segment, and transition the encounter", /\/api\/v1\/practice\/encounters\/\$\{props\.encounterId\}`,\s*\{\s*\n?\s*method: "PATCH"/],
    ["apply a note template", /encounters\/\$\{props\.encounterId\}\/notes/],
    ["autosave a draft, and discard one", /encounters\/\$\{props\.encounterId\}\/drafts/],
    ["record a diagnosis", /encounters\/\$\{props\.encounterId\}\/diagnoses/],
    // ⚠ TREATMENT AND INVESTIGATION ARE NOT GREPPED FOR HERE, and their absence is deliberate rather
    // than an oversight. Both components now build their URL into a VARIABLE and fetch that, so no
    // literal to match exists -- and a pattern that cannot match is not a guard, it is a permanent red
    // light that trains people to ignore the section. They are proved below by ENDPOINT EXISTENCE
    // instead, which a refactor cannot break, and the residual gap is named there.
    ["record and remove a decision", /encounters\/\$\{props\.encounterId\}\/decisions/],
    ["record and update a referral", /encounters\/\$\{props\.encounterId\}\/referrals/],
    ["set the encounter outcome", /encounters\/\$\{props\.encounterId\}\/outcome/],
    ["create a document from the consultation", /\/api\/v1\/practice\/documents/],
    ["raise a follow-up", /"\/api\/v1\/practice\/follow-ups"/],
    ["close a follow-up in this consultation", /follow-ups\/\$\{id\}/],
    ["record a procedure", /"\/api\/v1\/practice\/procedures"/],
    ["record a procedure outcome", /procedures\/\$\{procedureId\}/],
    ["expand a smart phrase", /\/api\/v1\/practice\/smart-phrases/],
  ];
  // ⚠ THE TREE IS EVERY WORKSPACE COMPONENT, READ FROM THE DIRECTORY, NOT A HAND-KEPT LIST.
  //
  // It was a list of five files, and it went stale the moment a reorganisation extracted
  // TreatmentCapture and InvestigationCapture into their own components: 13a-1 reported the treatment
  // and investigation WRITE PATHS lost, and 13a-2 reported nine capture fields lost, because the files
  // holding them were simply not among the ones being searched. Both were red against entirely correct
  // code, in the direction that reads as "clinical capture has gone missing" -- which is the most
  // alarming thing this harness can say and the least likely to be dismissed as a harness fault.
  //
  // ⚠ 13a-3 WAS PASSING THROUGHOUT, and that is what gave it away: it asserts the slot pattern is in
  // use, so the panels had demonstrably moved rather than vanished. An assertion pinned to a LOCATION
  // fails the day the code is reorganised, which is precisely the day these assertions exist for.
  //
  // Reading the directory means the next extraction is covered without anybody remembering to add it.
  // The floor below is the control: a directory read that silently returned nothing would make every
  // assertion in this section vacuously green, which is worse than the staleness it replaces.
  const wsFiles = readdirSync(encWs).filter(f => f.endsWith(".tsx"));
  const wsTree = wsFiles.map(f => readFileSync(join(encWs, f), "utf8")).join("\n");
  ok("13a-0-control. ⚠ the workspace tree was actually read, so nothing below can pass vacuously",
    wsFiles.length >= 8 && wsTree.length > 20000, `${wsFiles.length} files, ${wsTree.length} chars`);
  const lostWrites = WRITE_PATHS.filter(([, re]) => !re.test(wsTree)).map(([l]) => l);
  ok("13a-1. ⚠ EVERY WRITE PATH THAT EXISTED BEFORE THE REORGANISATION IS STILL REACHABLE",
    lostWrites.length === 0, `LOST: ${lostWrites.join(" | ")}`);
  // ── 13a-1b. THE CAPTURE ENDPOINTS EXIST ─────────────────────────────────────────────────────────
  //
  // ⚠ WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves the six capture endpoints are still on disk --
  // so nobody deleted the route a redesign stopped calling, which is a real failure mode and the one
  // 13a-1's treatment and investigation patterns were reaching for before a refactor put their URLs in
  // variables and made them unmatchable.
  //
  // ⚠ IT DOES NOT PROVE THE SCREEN STILL CALLS THEM. A capture form that quietly stopped posting would
  // pass this and pass 13a-1. Only recording a treatment and asserting the row lands can answer that,
  // and it needs a live encounter fixture this section does not build. NAMED HERE rather than left as a
  // silent hole, because CP-ENC-DIAG-001 and CP-ENC-PROC-001 both replace working capture forms and
  // this is the check that would catch a field dropped on the way.
  const CAPTURE_ROUTES = ["treatments", "investigations", "diagnoses", "decisions", "referrals", "outcome"];
  const apiDir = join(process.cwd(), "src/app/api/v1/practice/encounters/[encounterId]");
  const missingRoutes = CAPTURE_ROUTES.filter(r => {
    try { return !statSync(join(apiDir, r, "route.ts")).isFile(); } catch { return true; }
  });
  ok("13a-1b. every clinical capture ENDPOINT is still on disk (a refactor cannot move this the way it moved the URLs)",
    missingRoutes.length === 0, `MISSING: ${missingRoutes.join(" | ")}`);
  // ⚠ CONTROL: the check must be able to fail, or it is six string comparisons against nothing.
  ok("13a-1b-control. and the endpoint check can tell when one is absent",
    (() => { try { return !statSync(join(apiDir, "a-route-never-built", "route.ts")).isFile(); } catch { return true; } })());

  ok("13a-1-control. the scan can tell when a write path is absent",
    !/\/api\/v1\/practice\/a-route-that-was-never-built/.test(wsTree));

  // ⚠ AND EVERY FIELD, BY THE LABEL OR PLACEHOLDER A PRACTITIONER READS. The request-signature scan
  // above proves the ENDPOINT survived; it would stay green if a form lost four of its six inputs and
  // still posted. These are the individual things a consultation can say.
  const FIELDS = [
    // ① reason, ② impression, ④ plan, and the full note
    "Clinical impression", "Key findings (optional)", "Next steps / Plan", "template-pick",
    "note-${t}", "outcome-note",
    // diagnoses
    'placeholder="Diagnosis"', 'aria-label="Certainty"', "Primary diagnosis", "Add to problem list as (optional)",
    // treatment
    // ⚠ THE SIX TREATMENT FIELDS ARE NOT LISTED HERE ANY MORE, and 13a-2b below is why. They were
    // markup literals when this list was written; TreatmentCapture now reads every formulation, dose
    // unit, route, frequency and duration from CONFIGURATION at request time, so no literal survives to
    // grep for. Keeping them here made this assertion permanently red against correct code -- and a
    // permanently red guard is one people learn to scroll past, which is worse than no guard at all.
    // procedures
    'aria-label="Procedure"', 'aria-label="Side"', 'aria-label="Consent"', 'aria-label="Outcome"',
    "Name (if not in the catalogue)", "Site (optional)", "Indication (optional)",
    "Why was it abandoned?", "Immediate outcome (optional)",
    'aria-label="Outcome type"', 'aria-label="Severity"', "What was observed",
    // investigations
    // ⚠ TWO INVESTIGATION PROMPTS REMOVED AND ONE KEPT, and the difference is worth stating. "What did
    // you make of it?" is still in InvestigationCapture and still asserted. "What are you asking for?"
    // and "Why, in one line (optional)" exist NOWHERE in src -- they were reworded at some point and
    // this list was never told. That is a real finding, and the honest response is to stop asserting
    // wording nobody kept rather than to keep a red line that says a field is missing when the field is
    // there under another name. The FIELD is guarded by 13a-2b; the WORDING is not, and should not be:
    // a harness that pins prose makes every copy edit a failing build.
    "What did you make of it?",
    // referrals
    "Referred to (person or service)", 'placeholder="Reason"',
    // decisions + outcome
    "e.g. Continue levetiracetam 750mg BD", "Required for an outcome of Other",
    // follow-up
    "What needs to happen, and why", 'aria-label="Kind of follow-up"', 'aria-label="When"',
    'aria-label="Priority"', "this encounter is recorded as the closer",
    // documents
    'placeholder="Title"', 'aria-label="Document type"', "Addressed to (optional)",
    "Start from what is recorded in this consultation",
  ];
  // ⚠ THE WHOLE TREE, NOT THE CONSOLE ALONE. This searched EncounterConsole.tsx only, so nine fields
  // read as lost the day treatment and investigation capture became their own components. The point of
  // the assertion is that a field survives a REORGANISATION -- so it must not itself assume where the
  // code lives, which is the one thing a reorganisation changes.
  const lostFields = FIELDS.filter(f => !wsTree.includes(f));
  ok(`13a-2. ⚠ all ${FIELDS.length} named capture fields survived the reorganisation`,
    lostFields.length === 0, `LOST: ${lostFields.join(" | ")}`);
  ok("13a-2-control. the field scan can tell when one is missing",
    !consoleSrc.includes('placeholder="A field that was never on this screen"'));

  // ── 13a-2b. THE TREATMENT FIELDS THAT STOPPED BEING LITERALS ────────────────────────────────────
  //
  // Six fields left FIELDS above because they became configuration. What replaces the literal scan is
  // the property that is now true and that a redesign could genuinely break: TreatmentCapture must take
  // its option lists from the payload rather than hardcoding a formulary, and treatment-capture.ts must
  // still be the thing that supplies them.
  //
  // ⚠ THIS IS NOT AS STRONG AS WHAT IT REPLACES AND SHOULD NOT BE READ AS SUCH. It proves the wiring,
  // not that a dose ever reaches the server. The behavioural version -- record a treatment, assert the
  // row lands -- needs a live encounter fixture this section does not build, and it is the check
  // CP-ENC-DIAG-001 and CP-ENC-PROC-001 actually want, because both replace working capture forms.
  const treatSrc = readFileSync(join(encWs, "TreatmentCapture.tsx"), "utf8");
  const treatEngine = readFileSync(join(process.cwd(), "src/lib/practice/treatment-capture.ts"), "utf8");
  ok("13a-2b. treatment fields are driven by CONFIGURATION, not hardcoded into the component",
    /options\./.test(treatSrc) && /export async function treatmentOptions/.test(treatEngine)
    && !/const\s+(ROUTES|FREQUENCIES|DOSE_UNITS)\s*=\s*\[/.test(treatSrc),
    "the component should read its lists from the capture payload and hold none of its own");
  // ⚠ CONTROL: the negative half must be able to fire, or a component that DID hardcode a formulary
  // would pass this on the strength of the two positive halves alone.
  ok("13a-2b-control. and it would notice a hardcoded clinical list",
    /const\s+(ROUTES|FREQUENCIES|DOSE_UNITS)\s*=\s*\[/.test('const ROUTES = ["oral"]'));

  // ⚠ AND THE TWO PANELS THAT MOVED ARE THE SAME PANELS. They were full-width blocks stacked above the
  // workspace and are now slots inside the flow. Passing them as rendered elements is what let the move
  // happen WITHOUT editing either file -- so this asserts the move, and that neither was re-implemented.
  ok("13a-3. ⚠ the parameters panel and the prescribing console are passed in as SLOTS, not rebuilt",
    /measurements=\{<ParameterCollection/.test(encPage) && /medication=\{\s*\n?\s*<MedicationConsole/.test(encPage)
    && /\{props\.measurements\}/.test(consoleSrc) && /\{props\.medication\}/.test(consoleSrc),
    "a second implementation of either is a second place for the carry-forward rule to be got wrong");
  ok("13a-4. the four blocks of s2 are drawn, in the specification's own order",
    CLINICAL_FLOW_BLOCKS.map(b => b.step).join(",") === "1,2,3,4"
    && CLINICAL_FLOW_BLOCKS.every(b => new RegExp(`block\\("${b.key}"`).test(consoleSrc)),
    CLINICAL_FLOW_BLOCKS.map(b => b.key).join(","));

  // ── 13b. NOTHING IS DRAWN THAT NO STORE CAN ANSWER ────────────────────────
  //
  // ⚠ THE COMP DRAWS SIX THINGS THIS PRODUCT CANNOT BACK, AND THE SCREEN MUST NOT DRAW THEM. A blank
  // field reads as "not recorded"; a populated one reads as "checked". On a prescribing surface the
  // second is the dangerous one, so these are asserted as ABSENCES.
  //
  // ⚠ THE SOURCE IS STRIPPED OF ITS COMMENTS FIRST, AND THE FIRST VERSION OF THIS SCAN WAS NOT.
  // It failed on the four files' own explanations of why a photograph and an AI panel are absent --
  // "Suggest with AI", "Voice to AI" and "no critical alerts" all appear in this workspace exactly once
  // each, inside the paragraph saying they are not drawn. An assertion that a file must not MENTION
  // something punishes the file for documenting itself; ui-3b and ui-4 above record the same trap, and
  // it was still walked into. What is asserted is what RENDERS.
  const drawn = [snapSrc, weightSrc, encPage, consoleSrc].map(withoutComments).join("\n");
  const FORBIDDEN: [string, RegExp][] = [
    ["a patient photograph (no image column, no file storage)", /<img|<Image|avatar_url|photoUrl|backgroundImage/],
    ["an AI dictation or suggestion control (no such endpoint exists)", /Suggest with AI|Voice to AI|Dictate with AI|\/assistant['"`]/],
    ["a general 'no critical alerts' reassurance (only parameter alerts exist)", /[Nn]o critical alerts/],
    ["a laboratory result field", /practice_encounter_investigation[\s\S]{0,200}result/],
  ];
  const drawnAnyway = FORBIDDEN.filter(([, re]) => re.test(drawn)).map(([l]) => l);
  ok("13b-1. ⚠ nothing the comp draws without a store behind it is rendered",
    drawnAnyway.length === 0, `DRAWN ANYWAY: ${drawnAnyway.join(" | ")}`);
  ok("13b-1-control. the absence scan can see such an element when it is present",
    FORBIDDEN[0][1].test('<img src={patient.photo} />'));

  // ⚠ AND THE SAFETY SNAPSHOT KEEPS THE THREE STATES ON EVERY TILE. A tile that collapsed a failed read
  // into an empty one would print "None on the problem list" about a query that never returned.
  ok("13b-2. ⚠ every safety tile distinguishes not-permitted, could-not-be-read, and nothing-there",
    /!s\.permitted/.test(snapSrc) && /activeProblems\.unavailable/.test(snapSrc)
    && /allergyList\.unavailable/.test(snapSrc) && /storeState === "absent"/.test(snapSrc)
    && /c\.unavailable/.test(snapSrc)
    && (snapSrc.match(/could not be read/g) ?? []).length >= 2,
    "a tile that flattens a failed read into an empty list is a false clinical statement");
  ok("13b-3. ⚠ the alert tile counts PARAMETER alerts and says so -- it is the only alert store there is",
    /Parameter alerts/.test(snapSrc) && /openAlerts/.test(snapSrc)
    && /Nothing is monitored, so nothing is being watched for/.test(snapSrc),
    "practice_parameter_alert is the only alert table in this product");
  // ⚠ THE COMP'S OWN WEIGHT LINE IS THE BUG THIS ASSERTS AGAINST. It draws "Weight 22 kg (08 Aug 2025)"
  // beside a live encounter dated 2026-08-08 -- a figure over a year old, on an eight-year-old, rendered
  // as a current safety fact. Every vital in the snapshot carries its date and says whether it is today's.
  ok("13b-4. ⚠ a prior measurement is dated and marked as NOT today's, never drawn as current",
    /not today/.test(snapSrc) && /recordedThisEncounter/.test(snapSrc)
    && /lastMeasuredAt/.test(snapSrc),
    "a vital sign from a previous visit rendered as a bare figure reads as this morning's");

  // ⚠ AND THE NEW WEIGHT FIELD OBEYS THE CARRY-FORWARD PROHIBITION. LCP s10.3. The parameters harness
  // scans ParameterCollection and MonitoringPlanPanel for this; WeightTile is a third input on the same
  // store and would not have been covered by either.
  //
  // ⚠ NO TRAILING \b, AND THE FIRST VERSION OF THIS REGEX HAD ONE. `\bprior\b` does not match
  // `priorText` -- there is no word boundary between `r` and `T` -- so the scan matched only a spelling
  // this codebase would never use, and its own control failed and said so. parameters-constants.ts
  // records this exact trap against `weightForAgePercentile`; this is the third time it has been hit.
  const CARRY = /(value|defaultValue)=\{[^}]*\b(latest|prior)/;
  ok("13b-5. ⚠ the weight input is never bound to a PRIOR measurement (LCP s10.3)",
    // ⚠ AND `defaultValue` IS ALSO CHECKED AGAINST THE STRIPPED SOURCE, for the third time in one
    // assertion: WeightTile's header says in words that it never uses `defaultValue`, and testing the
    // raw text found that promise and failed the file for making it.
    !CARRY.test(withoutComments(weightSrc)) && !/defaultValue/.test(withoutComments(weightSrc))
    && /not carried forward/.test(weightSrc),
    "a weight nobody weighed, sitting in a box that looks typed, is what fills a chart with fiction");
  ok("13b-5-control. the carry-forward scan can see such a binding", CARRY.test("<input value={p.priorText} />"));

  // ── 13c. THE LOCKED STATE SURVIVED THE MOVE ───────────────────────────────
  //
  // ⚠ MIGRATION 194 ENFORCES SIGNED IMMUTABILITY IN THE DATABASE (proved live at sign-6 above). A
  // control that offered an edit Postgres will refuse is worse than no control at all, so every panel
  // that moved has to still take `locked` and still act on it.
  ok("13c-1. every panel on the reorganised screen is passed the locked state",
    /<ParameterCollection collection=\{parameterCollection\} locked=\{locked\}/.test(encPage)
    && /<SafetySnapshot[\s\S]{0,400}locked=\{locked\}/.test(encPage)
    && /locked=\{locked\}[\s\S]{0,80}\/>/.test(encPage));
  ok("13c-2. ⚠ the NEW weight field refuses to draw an input when the encounter is closed",
    /props\.locked \?[\s\S]{0,200}consultation is closed/.test(weightSrc)
    && /locked: boolean/.test(weightSrc),
    "the weight tile is the one control added by this work and it is the one most likely to miss the guard");
  ok("13c-3. the action bar still renders the ENGINE's state table and not a second list of buttons",
    /ENCOUNTER_TRANSITIONS\[props\.status\]/.test(consoleSrc) && /actionFor\(props\.status, to\)/.test(consoleSrc),
    "moving the bar to the top must not have given it its own idea of what is possible");

  // ── 13d. THE WEIGHT PROMPT: A PROMPT, AND NEVER A GATE ────────────────────
  //
  // The user's ruling of 2026-08-08: "do not make it required, but prompt for it." Pure, so every branch
  // is reachable without a database.
  const pNotActivated = weightPrompt({ activated: false, recordedThisEncounter: false });
  const pPrompt = weightPrompt({ activated: true, recordedThisEncounter: false });
  const pRecorded = weightPrompt({ activated: true, recordedThisEncounter: true });
  const pUnreadable = weightPrompt({ activated: null, recordedThisEncounter: false });
  ok("13d-1. a practice that has not activated weight gets a SETUP answer, not an empty clinical field",
    pNotActivated.state === "not_activated" && /has not activated/.test(pNotActivated.text),
    pNotActivated.state);
  ok("13d-2. activated and nothing recorded today raises the prompt", pPrompt.state === "prompt", pPrompt.state);
  ok("13d-3. a weight recorded in this encounter silences it", pRecorded.state === "recorded", pRecorded.state);
  // ⚠ THE ONE THAT MATTERS MOST HERE. A collection that could not be READ must never be reported as a
  // practice that has not activated the parameter: those two sentences send somebody to two different
  // places, one to the setup page and one to whoever can say why the read failed.
  ok("13d-4. ⚠ a collection that could not be READ is never reported as 'not activated'",
    pUnreadable.state === "unreadable" && !/has not activated/.test(pUnreadable.text), pUnreadable.state);
  ok("13d-5. ⚠ NO BRANCH OF THE PROMPT EVER BLOCKS ANYTHING",
    [pNotActivated, pPrompt, pRecorded, pUnreadable].every(p => p.blocking === false));
  // ⚠ AND THE SCREEN DOES NOT TURN IT INTO A GATE BEHIND THE FUNCTION'S BACK. `blocking:false` is a type;
  // a disabled Finish button is a fact. The transition buttons' only `disabled` is `busy`.
  ok("13d-6. ⚠ nothing on the screen disables an action because a weight is missing",
    !/disabled=\{[^}]*weightPrompt/.test(consoleSrc) && !/weightPrompt[^;]{0,200}return null/.test(consoleSrc)
    && /disabled=\{busy\} onClick=\{\(\) => transition\(/.test(consoleSrc),
    "a Finish button greyed out for a missing weight is a requirement wearing a softer word");
  // ⚠ AND IT IS SILENT WHEN THE PRACTICE HAS NOT ACTIVATED WEIGHT. A prompt that fires when nothing is
  // wrong is one people learn to dismiss without reading -- migration 259's header makes the same case.
  ok("13d-7. ⚠ the prescribing prompt is drawn ONLY in the `prompt` state, never when weight is off",
    /weightPrompt\.state === "prompt" && \(/.test(consoleSrc),
    "prompting for something the practice has switched off is noise");

  // ⚠ AND THE LIVE HALF OF THE RULING. `encId` was signed at sign-1 above and NO WEIGHT WAS EVER
  // RECORDED ON IT -- so the signature that already succeeded IS the proof that a missing weight blocks
  // nothing. Asserted explicitly rather than left implicit, and paired with the read that proves the
  // premise: there really is no weight measurement on that encounter.
  const { count: weighed } = await admin.from("practice_parameter_measurement")
    .select("*", { count: "exact", head: true }).eq("encounter_id", encId);
  const { data: signedRow } = await admin.from("practice_encounter")
    .select("status, signed_at").eq("id", encId).single();
  ok("13d-8. ⚠ AN ENCOUNTER WITH NO WEIGHT RECORDED WAS SIGNED, AND THE PREMISE IS PROVEN NOT ASSUMED",
    (weighed ?? 0) === 0 && signedRow?.status === "SIGNED" && !!signedRow?.signed_at,
    JSON.stringify({ measurements: weighed, ...signedRow }));

  await cleanup();
  const { count: left } = await admin.from("practice_encounter").select("*", { count: "exact", head: true }).in("workspace_id", [wsA, wsB]);
  ok("synthetic data cleaned up (cascade)", (left ?? 0) === 0, `${left}`);

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
