/**
 * THE ENCOUNTERS LANDING PAGE -- CPR-ENC-LANDING-001.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS PROVED HERE, AND WHY EACH ONE EARNS ITS PLACE
 *
 *   1. Every capability code the loader gates on EXISTS in practice_role_capabilities. NO NEW CODES.
 *   2. ⚠ THE FROZEN DECISION IS KEPT: no queue, no appointment list, no session dashboard. The board
 *      this replaces opened with one card per session carrying four figures each; the spec forbids it
 *      by name, so its absence is asserted rather than assumed.
 *   3. ⚠ NO TILE RENDERS A FAILED READ AS A COUNT. Every figure on this board is `number | null` and
 *      null draws an em dash. A nought here says "nothing needs you", which is the sentence a
 *      practitioner acts on by going home with a consultation still open. Proved at the loader (a
 *      client whose encounter reads fail) AND at the pixel (rendered HTML), each with a control.
 *   4. ⚠ THE SAFETY ELEMENT NEVER CLAIMS ZERO. The comp draws "0 -- Unresolved safety alerts".
 *      There is no medication safety alert store in this product; the row therefore has NO count field
 *      at all and renders as permanently not-checked. Proved by slicing that block out of real HTML and
 *      showing it contains no digit -- with a control proving the other three rows DO print theirs.
 *   5. ⚠ A TAB WITH NO ROWS SAYS WHICH STATE IT IS EMPTY OF. Every tab's empty sentence is distinct,
 *      and rendering one tab's empty panel prints its sentence and none of the others'.
 *   6. AC-06: raw elapsed minutes are never displayed, and a duration that could not be measured is an
 *      em dash rather than "0m".
 *   7. s4.4's outstanding components carry the null discipline: a component read that FAILED raises no
 *      "still required" claim AND is not drawn as a complete record.
 *   8. s4.5: COMPLETED is completed-but-unsigned, it is separated from drafts, and the board's action
 *      on it OPENS the record rather than signing from a list.
 *   9. s4.7: the history register, its filters, its pagination, and AC-11's visually distinct AMENDED --
 *      whose timestamp is DERIVED from the immutable status history, because there is no amended_at.
 *  10. s12: permissions and tenant isolation, non-vacuously.
 *  11. The label maps restate migration 194's CHECK constraints in full, parsed from the migration.
 *
 * CONTROLS: every "it refuses" is paired with the same thing somewhere it must succeed; every "it says
 * unavailable" is paired with "and the real one does not".
 *
 *   npx --yes tsx scripts/practice-encounters-landing-harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import {
  launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment, setEncounterOutcome,
} from "../src/lib/practice/encounters";
import {
  encountersLanding, ENCOUNTERS_LANDING_CAPABILITIES,
  type LandingEncounter, type AttentionRow, type LandingContext, type Panel,
} from "../src/lib/practice/encounters-landing";
import {
  LANDING_TABS, MEDICATION_SAFETY_ROW, MEDICATION_SAFETY_CHECK_KEYS,
  PATHWAY_LABEL, MODE_LABEL, elapsedLabel, agingState, outstandingComponents,
  LANDING_REQUIRED_KEYS, OUTSTANDING_SHORT, COMPLETION_OVERDUE_MINUTES, CHANGE_CONTEXT_HREF,
  isLandingTab, HISTORY_PAGE_SIZE,
} from "../src/lib/practice/encounters-landing-constants";
import { WARNING_TEXT } from "../src/lib/practice/encounter-workspace-constants";
import { DEFERRED_SAFETY_CHECKS } from "../src/lib/practice/medication-constants";
import {
  ContextStrip, WorkSection, AttentionPanel, EncounterCard, PanelState, Figure,
} from "../src/app/practice/(shell)/encounters/Board";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

/* eslint-disable @typescript-eslint/no-explicit-any */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

// HEX ONLY -- a malformed uuid dies as a null several lines later, in the wrong place.
// ⚠ AND THEY ARE THIS HARNESS'S OWN. Nothing here touches the live practice the owner is walking.
const USER_A = "00000000-0000-4000-8000-0000000ec601";
const USER_B = "00000000-0000-4000-8000-0000000ec602";
const CID = "harness-enc-landing";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

/**
 * ⚠ COMMENTS ARE STRIPPED BEFORE ANY SCAN, AND EVERY NEGATIVE SCAN BELOW DEPENDS ON IT.
 *
 * These files explain in prose the very things they must not do -- "the board this replaces opened with
 * Today's sessions", "the comp draws 0 unresolved safety alerts". A scan for those phrases over raw
 * source would match MY OWN EXPLANATION and pass whether or not the thing itself was gone. An assertion
 * that survives the defect it exists to catch is not an assertion; it is a line in a passing total.
 */
const src = (rel: string) => {
  const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")          // block comments, which is also how JSX comments are written
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");      // line comments, without eating the // in a URL scheme
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-enclanding-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CID,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CID, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const owner of [USER_A, USER_B]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", owner);
    for (const w of (ws ?? []) as { id: string }[]) {
      const { data: encs } = await admin.from("practice_encounter").select("id").eq("workspace_id", w.id);
      for (const e of (encs ?? []) as any[]) {
        await admin.from("practice_encounter_status_history").delete().eq("encounter_id", e.id);
        await admin.from("practice_diagnosis").delete().eq("encounter_id", e.id);
        await admin.from("practice_treatment").delete().eq("encounter_id", e.id);
        await admin.from("practice_encounter_decision").delete().eq("encounter_id", e.id);
      }
      await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
      await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
      await admin.from("practice_patient").delete().eq("workspace_id", w.id);
      await admin.from("practice_access_log").delete().eq("workspace_id", w.id);
    }
    await admin.from("practice_practitioner_identity").delete().eq("user_id", owner);
    await admin.from("provisioning_request").delete().eq("target_user_id", owner);
  }
  // ⚠ NO practice_audit_event DELETE -- migration 247 makes it append-only and refuses one.
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

/**
 * A client whose reads of ONE table fail, and whose reads of everything else are real.
 *
 * The "and everything else is real" half is the point: a stub that failed universally would make every
 * panel report unavailable and every three-state assertion pass for the wrong reason.
 */
function failingOn(table: string, message: string) {
  return {
    from: (t: string) => {
      if (t !== table) return admin.from(t) as any;
      const chain: Record<string, any> = {};
      const result = { data: null, error: { message }, count: null };
      for (const m of ["select", "eq", "in", "order", "not", "is", "neq", "lt", "gt", "gte", "lte", "textSearch"]) {
        chain[m] = () => chain;
      }
      chain.limit = async () => result;
      chain.range = async () => result;
      chain.maybeSingle = async () => result;
      chain.single = async () => result;
      // Awaiting the builder itself is how a head:true count query resolves.
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
    rpc: (...args: unknown[]) => (admin.rpc as unknown as (...a: unknown[]) => unknown)(...args),
  } as any;
}

// ── RENDER HELPERS ───────────────────────────────────────────────────────────────────────────────────

const ENC = (over: Partial<LandingEncounter> = {}): LandingEncounter => ({
  id: "11111111-1111-4111-8111-111111111111",
  patientId: "22222222-2222-4222-8222-222222222222",
  patientName: "Sarah Nakato", patientNameUnavailable: false,
  patientIdentifier: "0412", patientIdentifierUnavailable: false,
  status: "DRAFT", entryPathway: "new_walk_in", encounterMode: "in_person",
  reasonForVisit: "headache", startedAt: "2026-08-08T13:34:00.000Z",
  completedAt: null, signedAt: null, amendedAt: null, amendedAtUnavailable: false,
  activityId: null, sessionTitle: null, sessionLocation: null,
  elapsedMinutes: 1134, aging: "fresh",
  outstanding: [], lastComponent: null, lastComponentUnavailable: false,
  ...over,
});

const PANEL = (over: Partial<Panel<LandingEncounter>> = {}): Panel<LandingEncounter> => ({
  items: [], permitted: true, unavailable: false, detail: null, capped: false, ...over,
});

const ATT = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  key: "incomplete", label: "Incomplete encounters", detail: "Open records with a required component still outstanding.",
  count: 0, permitted: true, href: "/practice/encounters?tab=open", ...over,
});

const CTX = (over: Partial<LandingContext> = {}): LandingContext => ({
  state: "none", title: null, activityLabel: null, facility: null, location: null, room: null,
  plannedStartMinute: null, plannedEndMinute: null, activityId: null, ...over,
});

const renderCard = (e: LandingEncounter, canSign = true) =>
  renderToStaticMarkup(React.createElement(EncounterCard as any, { e, canSeePatient: true, canSign }));

const renderSection = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(WorkSection as any, {
    id: "x", title: "Open encounters", subtitle: "sub", panel: PANEL(), what: "open encounters",
    empty: "EMPTY-SENTENCE", canSeePatient: true, canSign: true, count: 0, ...props,
  }));

const renderAttention = (rows: AttentionRow[]) =>
  renderToStaticMarkup(React.createElement(AttentionPanel as any, { rows }));

const renderContext = (context: LandingContext) =>
  renderToStaticMarkup(React.createElement(ContextStrip as any, { context }));

/** The medication-safety block, sliced out of a rendered attention panel. */
function safetyBlock(html: string): string {
  const at = html.indexOf(MEDICATION_SAFETY_ROW.label);
  if (at < 0) return "";
  return html.slice(at);
}

async function main() {
  console.log("\n== ENCOUNTERS LANDING -- CPR-ENC-LANDING-001 ==");
  await cleanup();

  const wsA = await provision(USER_A, "Landing Practice A", "a");
  const wsB = await provision(USER_B, "Landing Practice B", "b");
  const resA = await resolveWorkspaceContext(admin, USER_A, wsA);
  const resB = await resolveWorkspaceContext(admin, USER_B, wsB);
  if (!resA.ok || !resB.ok) throw new Error("no context");
  const ctxA: WorkspaceContext = resA.ctx;
  const ctxB: WorkspaceContext = resB.ctx;

  const page = src("src/app/practice/(shell)/encounters/page.tsx");
  const board = src("src/app/practice/(shell)/encounters/Board.tsx");
  const loader = src("src/lib/practice/encounters-landing.ts");

  // ── 1. CAPABILITY CODES ───────────────────────────────────────────────────────────────────────────
  section("1. no new capability codes");
  const { data: capRows, error: capErr } = await admin.from("practice_role_capabilities")
    .select("capability_code").in("capability_code", [...ENCOUNTERS_LANDING_CAPABILITIES]);
  const seeded = new Set(((capRows ?? []) as any[]).map(r => r.capability_code));
  ok("1a. the capability table could be read", !capErr, capErr?.message ?? "");
  for (const code of ENCOUNTERS_LANDING_CAPABILITIES) {
    ok(`1b. ${code} is a seeded capability, not an invented one`, seeded.has(code));
  }
  const { data: fake } = await admin.from("practice_role_capabilities")
    .select("capability_code").eq("capability_code", "encounter.landing.view");
  ok("1c. control: a plausible-looking invented code is NOT seeded -- which is what makes 1b mean something",
    (fake ?? []).length === 0);

  // ── 2. THE FROZEN DECISION ────────────────────────────────────────────────────────────────────────
  section("2. no queue, no appointment list, no session dashboard");
  ok("2a. the page no longer draws Today's sessions",
    !page.includes("Today&apos;s sessions") && !page.includes("Today's sessions"));
  ok("2b. and no longer imports the per-session figure row",
    !page.includes("SESSION_FIGURES") && !board.includes("SESSION_FIGURES"));
  ok("2c. the page mounts no session card and no queue",
    !page.includes("SessionCard") && !/\bqueue\b/i.test(page) && !/\bqueue\b/i.test(board));
  ok("2d. it does not read the appointment table either",
    !loader.includes("practice_appointment"));
  ok("2e. control -- the session IS still inherited, as one compact strip",
    page.includes("<ContextStrip") && loader.includes("todaysPlan"));
  const ctxRunning = renderContext(CTX({
    state: "running", title: "Morning Clinic", facility: "Nsambya Hospital",
    plannedStartMinute: 540, plannedEndMinute: 780,
  }));
  ok("2f. and that strip names the session and says a new encounter inherits it",
    ctxRunning.includes("Morning Clinic") && ctxRunning.includes("Nsambya Hospital")
    && ctxRunning.includes("inherit this session"));

  // ── 3. s4.1 THE HEADER, AND THE PICKER THAT ALREADY EXISTS ────────────────────────────────────────
  section("3. the header, and the launcher that is NOT re-implemented");
  ok("3a. the subtitle is the specification's own sentence",
    page.includes("Create, continue and review clinical encounters."));
  ok("3b. a search field is present and is a plain GET form -- so the result is a shareable URL",
    page.includes('name="q"') && page.includes('method="get"'));
  ok("3c. the existing picker is mounted, not replaced", page.includes("<StartEncounter"));
  ok("3d. and it is NOT re-implemented here -- neither file mounts the register's search or its form",
    !page.includes("<UniversalSearch") && !board.includes("<UniversalSearch")
    && !page.includes("<RegistrationForm") && !board.includes("<RegistrationForm"));
  ok("3e. the primary action still does not leave the board for the patient register",
    !page.includes('href="/practice/patients"'));

  // ── 4. s4.2 THE CONTEXT STRIP, FOUR STATES KEPT APART ─────────────────────────────────────────────
  section("4. the context strip has four states and does not collapse them");
  const ctxNone = renderContext(CTX({ state: "none" }));
  const ctxUnreadable = renderContext(CTX({ state: "unreadable" }));
  const ctxDenied = renderContext(CTX({ state: "not_permitted" }));
  ok("4a. no session says so, and says it is not a fault (s14: 'No current session is not an error')",
    ctxNone.includes("No active session") && ctxNone.includes("not a fault"));
  ok("4b. ⚠ a session that could not be READ is a different sentence -- it is never 'No active session'",
    !ctxUnreadable.includes("No active session") && ctxUnreadable.includes("could not be read"));
  ok("4c. and a caller who may not see the day gets a third sentence again",
    !ctxDenied.includes("No active session") && !ctxDenied.includes("could not be read")
    && ctxDenied.includes("does not carry"));
  ok("4d. control: the running state says none of those three things",
    !ctxRunning.includes("No active session") && !ctxRunning.includes("could not be read"));
  ok("4e. Change context goes to the command centre, which is the only place a session starts",
    ctxNone.includes(CHANGE_CONTEXT_HREF) && CHANGE_CONTEXT_HREF === "/practice/today");

  // ── 5. ⚠ NO TILE RENDERS A FAILED READ AS A COUNT ─────────────────────────────────────────────────
  section("5. a failed read is an em dash, never a nought");
  const figNull = renderToStaticMarkup(React.createElement(Figure as any, { value: null }));
  const figZero = renderToStaticMarkup(React.createElement(Figure as any, { value: 0 }));
  ok("5a. a null figure is an em dash and contains no digit",
    figNull.includes("—") && !/\d/.test(figNull.replace(/<[^>]*>/g, "")));
  ok("5b. control: a genuine nought IS drawn as 0 -- so 5a is not passing on an empty renderer",
    figZero.includes("0") && !figZero.includes("—"));

  const secNull = renderSection({ count: null });
  const secZero = renderSection({ count: 0 });
  ok("5c. a section whose count could not be read prints no number in its badge", secNull.includes("—"));
  ok("5d. control: a section with a real nought prints it", secZero.includes(">0<"));

  const attNull = renderAttention([
    ATT({ key: "incomplete", count: null }),
    ATT({ key: "ready_to_sign", label: "Ready to sign", count: null }),
    ATT({ key: "missing_required_data", label: "Required clinical data not recorded", count: null }),
  ]);
  const attZero = renderAttention([
    ATT({ key: "incomplete", count: 0 }),
    ATT({ key: "ready_to_sign", label: "Ready to sign", count: 0 }),
    ATT({ key: "missing_required_data", label: "Required clinical data not recorded", count: 0 }),
  ]);
  ok("5e. an attention panel of uncountable figures contains no nought at all",
    !attNull.includes(">0<") && (attNull.match(/—/g) ?? []).length >= 3);
  ok("5f. control: the same panel with real noughts prints three of them",
    (attZero.match(/>0</g) ?? []).length === 3);

  // ── 6. ⚠ THE SAFETY ELEMENT NEVER CLAIMS ZERO ─────────────────────────────────────────────────────
  section("6. the medication safety row has no figure and cannot acquire one");
  ok("6a. ⚠ MEDICATION_SAFETY_ROW carries NO count field, so no edit can put a number there without changing its type",
    !("count" in (MEDICATION_SAFETY_ROW as Record<string, unknown>)));
  ok("6b. its state is the literal not_checked", MEDICATION_SAFETY_ROW.state === "not_checked");
  const safeZero = safetyBlock(attZero);
  const safeNull = safetyBlock(attNull);
  ok("6c. ⚠ the rendered safety block contains no nought -- even on a panel where three real noughts ARE printed",
    safeZero.length > 0 && !safeZero.includes(">0<") && !/\b0\b/.test(safeZero.replace(/<[^>]*>/g, "")));
  ok("6d. control: that same panel really does print noughts elsewhere, so 6c is not scanning empty HTML",
    (attZero.match(/>0</g) ?? []).length === 3 && safeZero.length > 200);
  ok("6e. and it is drawn as not checked, in the slate dashed tone the checklist work established",
    safeNull.includes("Not checked") && MEDICATION_SAFETY_ROW.chip.includes("dashed"));
  ok("6f. it names the nine absent checks rather than shrugging",
    MEDICATION_SAFETY_CHECK_KEYS.length === 9
    && MEDICATION_SAFETY_CHECK_KEYS.join(",") === DEFERRED_SAFETY_CHECKS.map(c => c.key).join(",")
    && DEFERRED_SAFETY_CHECKS.every(c => safeNull.includes(c.label)));
  ok("6g. and it says outright that the absence of a number is not a claim of safety",
    /nobody looked/i.test(MEDICATION_SAFETY_ROW.detail));

  // The claim behind all of that: there is no such store to count.
  const { error: opWs } = await admin.from("op_safety_alerts").select("workspace_id").limit(1);
  const { error: noTable } = await admin.from("practice_safety_alert").select("id").limit(1);
  ok("6h. ⚠ the only safety-alert table is hospital-scoped -- it has no workspace_id at all",
    !!opWs && /workspace_id/.test(opWs.message), opWs?.message ?? "op_safety_alerts.workspace_id RESOLVED");
  ok("6i. and there is no practice-scoped safety alert table to read instead",
    !!noTable, noTable?.message ?? "practice_safety_alert EXISTS");
  const { error: paramAlertErr } = await admin.from("practice_parameter_alert")
    .select("alert_type").limit(1);
  ok("6j. control: the workspace-scoped alert table that DOES exist is for clinical parameters, not medication",
    !paramAlertErr, paramAlertErr?.message ?? "");

  // ── 7. ⚠ A TAB WITH NO ROWS SAYS WHICH STATE IT IS EMPTY OF ───────────────────────────────────────
  section("7. every empty state names the state it is empty of");
  const sentences = LANDING_TABS.map(t => t.empty);
  ok("7a. every tab has an empty sentence", sentences.every(s => s.trim().length > 20));
  ok("7b. and no two tabs share one -- a shared sentence names nothing",
    new Set(sentences).size === sentences.length);
  let allDistinct = true;
  for (const t of LANDING_TABS) {
    const html = renderSection({ empty: t.empty, panel: PANEL(), count: 0 });
    const mine = html.includes(t.empty);
    const others = LANDING_TABS.filter(o => o.key !== t.key).some(o => html.includes(o.empty));
    if (!mine || others) allDistinct = false;
  }
  ok("7c. rendering one tab's empty panel prints its own sentence and none of the others'", allDistinct);
  const secFilled = renderSection({ panel: PANEL({ items: [ENC()] }), count: 1 });
  ok("7d. control: a panel with rows prints no empty sentence at all",
    !secFilled.includes("EMPTY-SENTENCE") && secFilled.includes("Sarah Nakato"));

  const stDenied = renderToStaticMarkup(React.createElement(PanelState as any, {
    permitted: false, unavailable: false, empty: "EMPTY-SENTENCE", what: "open encounters",
  }));
  const stFailed = renderToStaticMarkup(React.createElement(PanelState as any, {
    permitted: true, unavailable: true, detail: "connection refused", empty: "EMPTY-SENTENCE", what: "open encounters",
  }));
  ok("7e. ⚠ a panel nobody may see says nothing was read -- it does NOT print the empty sentence",
    stDenied.includes("Nothing was read") && !stDenied.includes("EMPTY-SENTENCE"));
  ok("7f. ⚠ a panel that FAILED says so, prints the database's own words, and is not an empty list",
    stFailed.includes("could not be read") && stFailed.includes("not an empty list")
    && stFailed.includes("connection refused") && !stFailed.includes("EMPTY-SENTENCE"));

  // ── 8. AC-06: HUMAN-READABLE ELAPSED TIME ─────────────────────────────────────────────────────────
  section("8. elapsed time is human-readable and a null one is not nought");
  ok("8a. 1134 minutes reads as 18h 54m, and the raw number is nowhere in it",
    elapsedLabel(1134) === "18h 54m" && !elapsedLabel(1134).includes("1134"));
  ok("8b. ⚠ a duration that could not be measured is an em dash, never 0m",
    elapsedLabel(null) === "—");
  ok("8c. control: a consultation opened this minute IS 0m -- the two are different facts",
    elapsedLabel(0) === "0m");
  ok("8d. a multi-day encounter reads in days", elapsedLabel(4000) === "2d 18h");
  const cardOld = renderCard(ENC({ elapsedMinutes: 1134 }));
  const cardUnknown = renderCard(ENC({ elapsedMinutes: null, aging: "unknown" }));
  ok("8e. the card prints the readable form and not the raw minutes",
    cardOld.includes("18h 54m") && !cardOld.includes("1134"));
  ok("8f. and a card whose age is unknown prints an em dash rather than 0m",
    cardUnknown.includes("—") && !cardUnknown.includes("0m"));
  ok("8g. aging is a threshold over that same number, and an unmeasurable one is 'unknown' not 'fresh'",
    agingState(10) === "fresh" && agingState(COMPLETION_OVERDUE_MINUTES) === "overdue"
    && agingState(null) === "unknown");

  // ── 9. s4.4 OUTSTANDING COMPONENTS, AND THE NULL DISCIPLINE ───────────────────────────────────────
  section("9. what is still required -- and what a failed read must not claim");
  const allMissing = outstandingComponents({ diagnoses: 0, treatments: 0, decisions: 0, outcome: null });
  const allRead = outstandingComponents({ diagnoses: null, treatments: null, decisions: null, outcome: null });
  ok("9a. an empty encounter is missing all three components",
    allMissing.length === 3 && allMissing.every(w => (LANDING_REQUIRED_KEYS as readonly string[]).includes(w.key)));
  ok("9b. ⚠ counts that could not be READ raise no claim about a diagnosis or a treatment",
    !allRead.some(w => w.key === "missing_diagnosis") && !allRead.some(w => w.key === "missing_treatment_decision"),
    JSON.stringify(allRead.map(w => w.key)));
  ok("9c. every key it emits exists in the encounter screen's own warning table -- one vocabulary, not two",
    allMissing.every(w => w.key in WARNING_TEXT) && LANDING_REQUIRED_KEYS.every(k => k in WARNING_TEXT));
  ok("9d. and the follow-up question is never printed as a requirement",
    !allMissing.some(w => w.key === "no_follow_up")
    && !(LANDING_REQUIRED_KEYS as readonly string[]).includes("no_follow_up"));
  ok("9e. every key it may emit has a short label for the card", allMissing.every(w => !!OUTSTANDING_SHORT[w.key]));

  const cardUnknownReq = renderCard(ENC({ outstanding: null }));
  const cardComplete = renderCard(ENC({ outstanding: [] }));
  ok("9f. ⚠ a card whose component reads FAILED says so and is not drawn as a finished record",
    cardUnknownReq.includes("could not be read")
    && !cardUnknownReq.includes("Every required component is recorded"));
  ok("9g. control: a genuinely complete card DOES say so",
    cardComplete.includes("Every required component is recorded"));
  const cardMissing = renderCard(ENC({ outstanding: allMissing, lastComponent: { key: "medication", label: "Medication entered", at: "x" } }));
  ok("9h. and a part-written one lists exactly what is outstanding, plus what was last completed",
    cardMissing.includes("Still required: Diagnosis, Treatment or decision, Plan / disposition")
    && cardMissing.includes("Last completed: Medication entered"));

  // ── 10. LIVE: THE BOARD OVER REAL RECORDS ─────────────────────────────────────────────────────────
  section("10. the loader over real records");
  const sarah = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Sarah Nakato", sex: "female", birthDate: "1992-03-03", phone: "+256772000301",
    actorId: USER_A, correlationId: CID,
  });
  const peter = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Peter Okello", sex: "male", birthDate: "1998-05-05", phone: "+256772000302",
    actorId: USER_A, correlationId: CID,
  });
  ok("10a. fixture: two patients registered", sarah.ok && peter.ok, JSON.stringify({ sarah, peter }));
  const sarahId = sarah.ok ? sarah.data.id : "";
  const peterId = peter.ok ? peter.data.id : "";

  const encS = await launchEncounter(admin, {
    workspaceId: wsA, patientId: sarahId, pathway: "new_walk_in",
    reasonForVisit: "headache", actorId: USER_A, correlationId: CID,
  });
  ok("10b. fixture: an encounter is open for one of them", encS.ok, JSON.stringify(encS));
  const encSId = encS.ok ? encS.data.id : "";

  const board1 = await encountersLanding(admin, ctxA, {});
  ok("10c. it appears as open, with nothing ready to sign -- the two are separate lists",
    board1.open.items.length === 1 && board1.open.items[0].id === encSId && board1.ready.items.length === 0,
    JSON.stringify({ open: board1.open.items.length, ready: board1.ready.items.length }));
  ok("10d. the counts agree with the lists", board1.counts.open === 1 && board1.counts.ready === 0
    && board1.counts.attention === 1, JSON.stringify(board1.counts));
  ok("10e. and the card knows all three components are outstanding on an empty consultation",
    (board1.open.items[0].outstanding ?? []).length === 3,
    JSON.stringify(board1.open.items[0].outstanding));
  ok("10f. the attention panel counts one incomplete encounter and three outstanding items",
    board1.attention.find(a => a.key === "incomplete")?.count === 1
    && board1.attention.find(a => a.key === "missing_required_data")?.count === 3,
    JSON.stringify(board1.attention.map(a => [a.key, a.count])));
  ok("10g. and the attention panel holds NO follow-up, document or letter row -- s4.6 excludes each by name",
    !board1.attention.some(a => /follow|document|letter/i.test(a.label)),
    JSON.stringify(board1.attention.map(a => a.label)));

  // Fill it in, and the outstanding list must shrink for real reasons.
  await recordDiagnosis(admin, {
    workspaceId: wsA, encounterId: encSId, label: "Migraine", actorId: USER_A, correlationId: CID,
  });
  await recordTreatment(admin, {
    workspaceId: wsA, encounterId: encSId, treatmentType: "medication", label: "Paracetamol",
    actorId: USER_A, correlationId: CID,
  });
  await setEncounterOutcome(admin, {
    workspaceId: wsA, encounterId: encSId, outcome: "improved", actorId: USER_A, correlationId: CID,
  });
  const board2 = await encountersLanding(admin, ctxA, {});
  ok("10h. once a diagnosis, a treatment and an outcome exist, nothing is outstanding",
    (board2.open.items[0].outstanding ?? ["x"]).length === 0,
    JSON.stringify(board2.open.items[0].outstanding));
  ok("10i. and the last completed component is a real row, named for what it was",
    !!board2.open.items[0].lastComponent, JSON.stringify(board2.open.items[0].lastComponent));

  // ── 11. s4.5 COMPLETED IS COMPLETED-BUT-UNSIGNED ──────────────────────────────────────────────────
  section("11. ready to sign is COMPLETED, and it is not mixed with drafts");
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encSId, to: "ACTIVE", actorId: USER_A, correlationId: CID });
  const completed = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encSId, to: "COMPLETED", actorId: USER_A, correlationId: CID });
  ok("11a. the encounter completes", completed.ok, JSON.stringify(completed));
  const board3 = await encountersLanding(admin, ctxA, {});
  ok("11b. ⚠ it moves OUT of open and INTO ready to sign -- 'do not mix these with incomplete drafts'",
    board3.open.items.length === 0 && board3.ready.items.length === 1
    && board3.ready.items[0].status === "COMPLETED",
    JSON.stringify({ open: board3.open.items.length, ready: board3.ready.items.length }));
  ok("11c. and it is counted as completed today", board3.counts.completedToday === 1,
    String(board3.counts.completedToday));
  const cardReady = renderCard(ENC({ status: "COMPLETED" }), true);
  const cardReadyNoSign = renderCard(ENC({ status: "COMPLETED" }), false);
  ok("11d. ⚠ the board's action on it OPENS the record -- it does not sign from a list",
    cardReady.includes("Review and sign") && !cardReady.includes("Continue encounter")
    && !/<button[^>]*>\s*Sign/.test(cardReady));
  ok("11e. a caller without encounter.sign is told so rather than offered a button they cannot use",
    cardReadyNoSign.includes("encounter.sign") && !cardReadyNoSign.includes("Review and sign"));
  ok("11f. control: a DRAFT card offers Continue and not Review and sign",
    renderCard(ENC({ status: "DRAFT" })).includes("Continue encounter"));

  // ── 12. s4.7 HISTORY ──────────────────────────────────────────────────────────────────────────────
  section("12. the history register, its filters and its states");
  const signed = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encSId, to: "SIGNED", actorId: USER_A, correlationId: CID });
  ok("12a. it signs", signed.ok, JSON.stringify(signed));
  const board4 = await encountersLanding(admin, ctxA, {});
  ok("12b. and leaves the work lists for the register",
    board4.open.items.length === 0 && board4.ready.items.length === 0
    && board4.history.items.length === 1 && board4.history.items[0].status === "SIGNED");

  const encP = await launchEncounter(admin, {
    workspaceId: wsA, patientId: peterId, pathway: "new_walk_in", actorId: USER_A, correlationId: CID,
  });
  const encPId = encP.ok ? encP.data.id : "";
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encPId, to: "ACTIVE", actorId: USER_A, correlationId: CID });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encPId, to: "COMPLETED", actorId: USER_A, correlationId: CID });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encPId, to: "SIGNED", actorId: USER_A, correlationId: CID });
  const amended = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encPId, to: "AMENDED", actorId: USER_A, correlationId: CID });
  ok("12c. fixture: a second record is signed and then amended", amended.ok, JSON.stringify(amended));

  const histAll = await encountersLanding(admin, ctxA, { historyState: "all" });
  const histSigned = await encountersLanding(admin, ctxA, { historyState: "signed" });
  const histAmended = await encountersLanding(admin, ctxA, { historyState: "amended" });
  ok("12d. All holds both; Signed holds one; Amended holds the other",
    histAll.history.items.length === 2 && histSigned.history.items.length === 1
    && histSigned.history.items[0].status === "SIGNED"
    && histAmended.history.items.length === 1 && histAmended.history.items[0].status === "AMENDED",
    JSON.stringify({ all: histAll.history.items.length, s: histSigned.history.items.length, a: histAmended.history.items.length }));
  ok("12e. ⚠ the amendment time is DERIVED from the immutable status history -- there is no amended_at column",
    !!histAmended.history.items[0].amendedAt && !histAmended.history.items[0].amendedAtUnavailable
    && loader.includes("practice_encounter_status_history"),
    JSON.stringify(histAmended.history.items[0].amendedAt));
  const { error: noCol } = await admin.from("practice_encounter").select("amended_at").limit(1);
  ok("12f. control: there really is no amended_at column, so 12e is deriving rather than reading one",
    !!noCol && /amended_at/.test(noCol.message), noCol?.message ?? "amended_at RESOLVED");
  ok("12g. AC-11: the register draws AMENDED in its own tone rather than sharing SIGNED's emerald",
    page.includes('e.status === "AMENDED"') && page.includes("bg-amber-100 text-amber-800 ring-1 ring-amber-300"));
  ok("12h. no draft ever reaches the register",
    !histAll.history.items.some(e => ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"].includes(e.status)));

  // Pagination -- fixture rows inserted directly, because 21 full lifecycles prove nothing extra.
  const filler = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, i) => ({
    workspace_id: wsA, patient_id: peterId, status: "SIGNED", entry_pathway: "booked",
    encounter_mode: "in_person", started_at: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
    created_by: USER_A,
  }));
  const { error: fillErr } = await admin.from("practice_encounter").insert(filler);
  ok("12i. fixture: enough signed records to need a second page", !fillErr, fillErr?.message ?? "");
  const p0 = await encountersLanding(admin, ctxA, { historyState: "signed", historyPage: 0 });
  const p1 = await encountersLanding(admin, ctxA, { historyState: "signed", historyPage: 1 });
  ok("12j. the first page is full and says there is more",
    p0.history.items.length === HISTORY_PAGE_SIZE && p0.historyHasMore === true,
    JSON.stringify({ n: p0.history.items.length, more: p0.historyHasMore }));
  ok("12k. the second page holds different records from the first",
    p1.history.items.length > 0
    && !p1.history.items.some(e => p0.history.items.some(f => f.id === e.id)),
    JSON.stringify({ n: p1.history.items.length }));

  const narrow = await encountersLanding(admin, ctxA, {
    historyState: "amended", historyPeriod: "custom", historyFrom: "1990-01-01", historyTo: "1990-01-02",
  });
  const wide = await encountersLanding(admin, ctxA, { historyState: "amended", historyPeriod: "30d" });
  ok("12l. a custom range holding nothing returns an EMPTY register, not a failed one",
    narrow.history.items.length === 0 && !narrow.history.unavailable && narrow.history.permitted,
    JSON.stringify({ n: narrow.history.items.length, u: narrow.history.unavailable }));
  ok("12m. control: the same state filter over a range that DOES hold it finds the record -- so 12l is the filter working, not a broken query",
    wide.history.items.length === 1 && wide.history.items[0].status === "AMENDED",
    JSON.stringify({ n: wide.history.items.length }));

  // ── 13. ⚠ THE LOADER'S OWN THREE STATES ───────────────────────────────────────────────────────────
  section("13. a failed read at the loader is never a nought and never an empty list");
  // ⚠ A FIXTURE THE BREAK NEEDS, AND THE FIRST RUN OF THIS FILE PROVED IT: by this point every
  // encounter above has been signed, so `open.items` was empty and 13f asserted "every card in an
  // empty list is null" -- true, vacuous, and counted. An assertion over a list nobody put anything in
  // is not an assertion.
  const grace = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Grace Nabirye", sex: "female", birthDate: "1985-07-07",
    phone: "+256772000304", actorId: USER_A, correlationId: CID,
  });
  const encG = await launchEncounter(admin, {
    workspaceId: wsA, patientId: grace.ok ? grace.data.id : "", pathway: "new_walk_in",
    actorId: USER_A, correlationId: CID,
  });
  ok("13-fixture. one encounter is open again, so the breaks below have something to act on",
    encG.ok, JSON.stringify(encG));
  const brokeEnc = await encountersLanding(failingOn("practice_encounter", "connection refused"), ctxA, {});
  ok("13a. ⚠ every count is null when the encounter reads fail -- not one of them is 0",
    Object.values(brokeEnc.counts).every(c => c === null),
    JSON.stringify(brokeEnc.counts));
  ok("13b. and the lists report unavailable rather than empty",
    brokeEnc.open.unavailable && brokeEnc.ready.unavailable && brokeEnc.history.unavailable
    && brokeEnc.open.permitted, JSON.stringify({ o: brokeEnc.open.unavailable, r: brokeEnc.ready.unavailable }));
  ok("13c. the board says the figures are incomplete rather than showing a quiet zero board",
    brokeEnc.countsUnavailable === true);
  ok("13d. ⚠ and the attention figures are null too -- an attention sum of (open ?? 0) + (ready ?? 0) would be a plausible smaller number",
    brokeEnc.attention.every(a => a.count === null), JSON.stringify(brokeEnc.attention.map(a => a.count)));
  ok("13e. control: the same call through the real client counts and does not report unavailable",
    board4.counts.open !== null && !board4.open.unavailable && !board4.countsUnavailable);

  const brokeDiag = await encountersLanding(failingOn("practice_diagnosis", "permission denied"), ctxA, {});
  ok("13f. ⚠ a failed COMPONENT read leaves every card's outstanding list null -- never an empty one",
    brokeDiag.open.items.length > 0
    && brokeDiag.open.items.every(e => e.outstanding === null)
    && brokeDiag.ready.items.every(e => e.outstanding === null),
    JSON.stringify({ n: brokeDiag.open.items.length }));
  ok("13g. and the two attention figures that depend on it go null with it",
    brokeDiag.attention.find(a => a.key === "incomplete")?.count === null
    && brokeDiag.attention.find(a => a.key === "missing_required_data")?.count === null);
  ok("13h. control: the encounter lists themselves are still readable in that same run, so 13f is not a total outage",
    !brokeDiag.open.unavailable && !brokeDiag.history.unavailable && brokeDiag.counts.open !== null);

  const brokePatients = await encountersLanding(failingOn("practice_patient", "read failed"), ctxA, {});
  ok("13i. a failed NAME read is reported per row rather than printed as an unnamed patient",
    brokePatients.history.items.every(e => e.patientNameUnavailable && e.patientName === null));
  const cardNoName = renderCard(ENC({ patientName: null, patientNameUnavailable: true }));
  ok("13j. and the card says the name could not be read, not 'Unknown patient'",
    cardNoName.includes("Name could not be read") && !cardNoName.includes("Unknown patient"));

  // ── 14. s12 PERMISSIONS AND TENANT ISOLATION ──────────────────────────────────────────────────────
  section("14. permissions and tenancy");
  const noList: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "encounter.list") };
  const denied = await encountersLanding(admin, noList, {});
  ok("14a. a caller without encounter.list gets 'nothing was read', not an empty board",
    !denied.open.permitted && !denied.open.unavailable && denied.open.items.length === 0
    && Object.values(denied.counts).every(c => c === null));
  ok("14b. control: the same call with the capability reads real rows",
    board4.open.permitted && board4.counts.all !== null);

  const bPatient = await registerPatient(admin, {
    workspaceId: wsB, displayName: "Mary Achieng", sex: "female", birthDate: "1970-01-01", phone: "+256772000303",
    actorId: USER_B, correlationId: CID,
  });
  const bEnc = await launchEncounter(admin, {
    workspaceId: wsB, patientId: bPatient.ok ? bPatient.data.id : "", pathway: "new_walk_in",
    actorId: USER_B, correlationId: CID,
  });
  ok("14c. fixture: the other practice has an open encounter of its own", bEnc.ok, JSON.stringify(bEnc));
  const boardB = await encountersLanding(admin, ctxB, {});
  const boardA = await encountersLanding(admin, ctxA, {});
  ok("14d. it is visible in ITS workspace -- so 14e is not passing over an empty table",
    boardB.open.items.length === 1);
  ok("14e. and never in the other one",
    !boardA.open.items.some(e => e.id === (bEnc.ok ? bEnc.data.id : ""))
    && !boardA.history.items.some(e => e.id === (bEnc.ok ? bEnc.data.id : "")));

  const { data: anonRows } = await anon.from("practice_encounter").select("id").limit(5);
  ok("14f. anon reads no encounter at all", (anonRows ?? []).length === 0);

  // s9's search is a read across the practice, and s12 says every read is auditable.
  const searched = await encountersLanding(admin, ctxA, { q: "Nakato" });
  ok("14g. the search runs and reports each half separately",
    !!searched.search && searched.search.ran && searched.search.patientsComplete);
  const { data: logRows } = await admin.from("practice_access_log")
    .select("id, action, detail").eq("workspace_id", wsA).eq("action", "search");
  ok("14h. and it is logged, with the term, because 'who searched for this surname' is the question an access review asks",
    (logRows ?? []).some(r => (r as any).detail === "Nakato"),
    JSON.stringify((logRows ?? []).map(r => (r as any).detail)));
  const shortQ = await encountersLanding(admin, ctxA, { q: "a" });
  ok("14i. control: a one-character query is not run at all -- and says so rather than claiming nobody matches",
    !!shortQ.search && shortQ.search.ran === false && shortQ.search.patients.length === 0);

  // ⚠ ADDED BECAUSE A BREAK TURNED NOTHING RED. Setting `encountersUnavailable: false` unconditionally --
  // which is exactly what search.ts does today, since its `push` helper drops a group whose rows array is
  // empty and never looks at the PostgREST error -- left every assertion in this file green. A search
  // that FAILED must not render as a search that matched nobody: on a clinical-record workbench that is
  // the sentence which ends with a second consultation opened for a patient who already has one.
  const brokeSearch = await encountersLanding(
    failingOn("practice_encounter", "search index missing"), ctxA, { q: "Nakato" });
  ok("14j. ⚠ an encounter search whose query FAILED says so, in the database's own words",
    !!brokeSearch.search && brokeSearch.search.encountersUnavailable === true
    && /search index missing/.test(brokeSearch.search.encountersDetail ?? "")
    && page.includes("The encounter search could not be run."),
    JSON.stringify({ u: brokeSearch.search?.encountersUnavailable, d: brokeSearch.search?.encountersDetail }));
  ok("14k. control: a search that really ran reports available, so 14j is not always-true",
    !!searched.search && searched.search.encountersUnavailable === false
    && searched.search.encountersDetail === null);

  // ── 15. THE LABEL MAPS RESTATE MIGRATION 194's CHECKS IN FULL ─────────────────────────────────────
  section("15. no encounter renders its kind as a raw database token");
  const mig194 = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/194-practice-encounters.sql"), "utf8");
  const grab = (col: string) => {
    const m = mig194.match(new RegExp(`${col}[\\s\\S]{0,120}?check \\(${col} in \\(([^)]*)\\)`));
    return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]) : [];
  };
  const pathways = grab("entry_pathway");
  const modes = grab("encounter_mode");
  ok("15a. the migration's own entry_pathway list was parsed, and it is not empty", pathways.length === 4,
    JSON.stringify(pathways));
  ok("15b. every one of them has a label", pathways.every(p => !!PATHWAY_LABEL[p]),
    JSON.stringify(pathways.filter(p => !PATHWAY_LABEL[p])));
  ok("15c. the migration's own encounter_mode list was parsed", modes.length === 5, JSON.stringify(modes));
  ok("15d. every one of them has a label", modes.every(m => !!MODE_LABEL[m]),
    JSON.stringify(modes.filter(m => !MODE_LABEL[m])));
  ok("15e. and the card prints the label rather than the token",
    renderCard(ENC({ entryPathway: "scheduled_followup", encounterMode: "home_visit" }))
      .includes("Scheduled follow-up · Home visit"));

  ok("15f. the tab keys the URL accepts are exactly the tabs that exist",
    LANDING_TABS.every(t => isLandingTab(t.key)) && !isLandingTab("everything") && !isLandingTab(null));

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
