/**
 * STARTING AN ENCOUNTER FROM THE ENCOUNTERS BOARD -- CPR-FLOW-001.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS TO KEEP CLOSED.
 *
 * "+ Start encounter" on /practice/encounters was a LINK to /practice/patients. It started nothing, and
 * the register it landed on did not know why anybody had arrived -- its own equivalent action lives in a
 * side panel that appears only once a patient is selected. The practice owner found it walking the
 * product: "Start encounter takes me to patient section."
 *
 * WHAT IS PROVED HERE:
 *   1. THE BUTTON NO LONGER LEAVES THE BOARD, and the picker's own file never links to the register.
 *   2. ONE SEARCH. The picker mounts the patients workspace's own box over universalSearch(); it makes
 *      no patient query of its own.
 *   3. ⚠ A ONE-CHARACTER QUERY IS NOT SENT, AND THE BOX SAYS SO -- with "nothing typed yet" kept as a
 *      separate state, because an empty box has not searched and has not found nothing.
 *   4. ⚠ A FAILED SEARCH NEVER RENDERS AS "NOBODY MATCHES". That sentence is what sends somebody to
 *      register a duplicate, and it is only made when every probe answered.
 *   5. ⚠ THE REGISTER BRANCH IS HIDDEN -- not greyed -- from a caller without patient.create.
 *   6. ⚠ REGISTER-AND-START GOES THROUGH registerPatient: the CPR-V2-005 minimum dataset refuses before
 *      anything is written, exactly ONE patient row results, and the encounter is reached.
 *   7. ⚠ THE DUPLICATE IS CAUGHT ON THE QUICK PATH EXACTLY AS ON THE FULL ONE -- same code, same
 *      candidates -- and an identifier collision is refused outright on both.
 *   8. THE FLOW-001 PATHWAY IS READ FROM THE RECORD and REFUSED when the record could not be read.
 *   9. A SECOND PRESS RESUMES rather than opening a second consultation, which is what the panel claims.
 *  10. ⚠ THE SAME DEFECT ONE LAYER IN. The longitudinal record at /practice/encounters/record/{patientId}
 *      offered "Start an encounter for this patient" and NAVIGATED to the patient's page -- from a screen
 *      with the patient in its own URL. It starts the consultation in place now, hidden (not greyed) from
 *      a caller without encounter.create; and the launch rule that four screens press is ONE function,
 *      every branch of which is run here over a stubbed transport. That consolidation closed a live bug:
 *      SummaryPanel decided the pathway from `!unavailable && rows.length > 0`, so an unreadable history
 *      opened a `new_walk_in` on a patient who may have been coming here for years.
 *
 *   npx --yes tsx scripts/practice-encounter-start-harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, hasCapability, type WorkspaceContext } from "../src/lib/practice/access";
import { register } from "../src/lib/practice/registration";
import { launchEncounter } from "../src/lib/practice/encounters";
import { universalSearch } from "../src/lib/practice/patient-workspace";
import { pathwayFor, startEncounterFor, MIN_PICKER_QUERY } from "../src/lib/practice/encounter-start";
import UniversalSearch from "../src/app/practice/(shell)/patients/UniversalSearch";
import { StartEncounterPanel } from "../src/app/practice/(shell)/encounters/StartEncounter";
import { StartEncounterActionView } from "../src/app/practice/(shell)/encounters/StartEncounterAction";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

/* eslint-disable @typescript-eslint/no-explicit-any */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// HEX ONLY -- a malformed uuid dies as a null several lines later, in the wrong place.
const OWNER = "00000000-0000-4000-8000-0000000ec501";
const CID = "harness-encounter-start";

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
 * These files explain the defect they fix in prose. A scan for "/practice/patients" over raw source
 * would match the SENTENCE describing the old link and pass whether or not the link itself was gone --
 * an assertion that cannot fail is worse than no assertion, because it is counted.
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
    idempotency_key: `harness-encstart-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CID,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row returned"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CID, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    const { data: encs } = await admin.from("practice_encounter").select("id").eq("workspace_id", w.id);
    for (const e of (encs ?? []) as any[]) {
      await admin.from("practice_encounter_status_history").delete().eq("encounter_id", e.id);
    }
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_relationship").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_contact").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  // ⚠ NO practice_audit_event DELETE -- migration 247 makes it append-only and refuses one. Nothing
  // here counts audit rows.
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

async function withoutCapabilities(workspaceId: string, userId: string, capabilities: string[]): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  // ⚠ AN HOUR AGO, NOT `new Date()`. resolveWorkspaceContext compares effective_to against the
  // DATABASE'S clock ("now" as a Postgres literal, deliberately -- access.ts says why). Expiring a
  // grant at this PROCESS'S now leaves it live for however far the app clock leads the database, which
  // is exactly the skew access.ts was fixed for. The first run of this file failed on that: the
  // capability was still granted a millisecond after being revoked. A grant that ended an hour ago
  // cannot be ambiguous on either clock.
  const { error } = await admin.from("practice_role_assignment")
    .update({ effective_to: new Date(Date.now() - 3_600_000).toISOString() })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .in("capability_code", capabilities).is("effective_to", null);
  if (error) throw new Error(`could not expire ${capabilities.join(",")}: ${error.message}`);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

async function restoreCapabilities(workspaceId: string, userId: string, capabilities: string[]) {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: null })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .in("capability_code", capabilities);
}

// ── Rendering helpers ────────────────────────────────────────────────────────────────────────────────

const searchView = (over: Record<string, unknown>) => ({
  query: "kabarole", ran: true, results: [], limit: 20, truncated: false, complete: true,
  probes: {}, unavailable: false, reason: null, searchedBy: ["Name"], ...over,
} as any);

const renderSearch = (props: Record<string, unknown>) => renderToStaticMarkup(
  React.createElement(UniversalSearch as any, {
    initialQuery: "", initial: null, canCreate: true, selectedPatientId: null,
    onSelect: () => {}, onRegister: () => {}, onSubmitQuery: () => {}, ...props,
  }),
);

const renderPanel = (props: Record<string, unknown>) => renderToStaticMarkup(
  React.createElement(StartEncounterPanel as any, {
    canRegisterPatient: true, phase: "search", notice: null, busy: false,
    form: null, formError: null, justRegistered: null,
    onSelectPatient: () => {}, onOpenRegister: () => {}, onBackToSearch: () => {},
    onRegistered: () => {}, onNotice: () => {}, ...props,
  }),
);

async function main() {
  console.log("\n== ENCOUNTER START -- the picker on the encounters board ==");
  await cleanup();

  const ws = await provision(OWNER, "Encounter Start Practice", "a");
  const res = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!res.ok) throw new Error("no context");
  const ctx = res.ctx;

  // ── 1. THE BUTTON NO LONGER LEAVES THE BOARD ──────────────────────────────────────────────────────
  section("1. the primary action starts something");
  const page = src("src/app/practice/(shell)/encounters/page.tsx");
  const picker = src("src/app/practice/(shell)/encounters/StartEncounter.tsx");

  ok("1a. the encounters page no longer links its primary action to the patient register",
    !page.includes('href="/practice/patients"'));
  ok("1b. it mounts the in-place picker instead", page.includes("<StartEncounter"));
  ok("1c. the picker never navigates to the register either",
    !picker.includes("/practice/patients"));
  ok("1d. it lands on the consultation it opened",
    picker.includes("/practice/encounters/${r.encounterId}"));

  // ── 2. ONE SEARCH, AND IT IS THE ONE THAT ALREADY EXISTS ──────────────────────────────────────────
  section("2. the search is reused, not rewritten");
  const universal = src("src/app/practice/(shell)/patients/UniversalSearch.tsx");
  ok("2a. the picker issues no patient query of its own",
    !picker.includes("/api/v1/practice/patients"));
  // ⚠ THE MOUNT, NOT THE IMPORT. This scanned for the bare identifier and passed a deliberate break
  // that deleted the component from the tree and replaced it with an inline fetch -- because the import
  // line still carried the word. An assertion that survives the thing it exists to catch is not an
  // assertion; it is a line in a passing total.
  ok("2b. it mounts the register's own search box", picker.includes("<UniversalSearch"));
  ok("2c. and that box is the one over universalSearch()",
    universal.includes("/api/v1/practice/patients/search"));

  const amina = await register(admin, ctx, {
    givenName: "Amina", familyName: "Kabarole", sex: "female", birthDate: "1990-04-04",
    phone: "+256772000101", correlationId: CID,
  });
  ok("2d. fixture: an existing patient is registered", amina.ok, JSON.stringify(amina));
  const aminaId = amina.ok ? amina.data.patientId : "";

  const found = await universalSearch(admin, ctx, "Kabarole");
  ok("2e. the engine behind the box finds her",
    found.ran && found.complete && found.results.some(r => r.patientId === aminaId),
    JSON.stringify({ ran: found.ran, complete: found.complete, n: found.results.length }));
  const absent = await universalSearch(admin, ctx, "Zzyzxwq");
  ok("2f. control: a name nobody carries answers nothing, completely -- so 'nobody matches' is a claim that CAN be made",
    absent.ran && absent.complete && absent.results.length === 0);

  // ── 3. A ONE-CHARACTER QUERY IS NOT SENT, AND SAYS WHY ────────────────────────────────────────────
  section("3. below the floor, nothing is searched and the box says so");
  const oneChar = renderSearch({ initialQuery: "a" });
  ok("3a. a one-character query says nothing was searched",
    oneChar.includes("Nothing has been searched yet"));
  ok("3b. it names the floor, and the floor is the constant",
    oneChar.includes(`at least ${MIN_PICKER_QUERY} characters`) && MIN_PICKER_QUERY === 2);
  ok("3c. and it makes no claim about the register",
    !oneChar.includes("Nobody matches") && !oneChar.includes("possible match"));
  const twoChar = renderSearch({ initialQuery: "ab" });
  ok("3d. control: at the floor the refusal is gone", !twoChar.includes("Nothing has been searched yet"));
  const empty = renderSearch({ initialQuery: "" });
  ok("3e. control: an empty box is its own state -- it is not told it typed too little",
    !empty.includes("Nothing has been searched yet") && !empty.includes("Nobody matches"));

  // ── 4. A FAILED SEARCH IS NOT "NO SUCH PATIENT" ───────────────────────────────────────────────────
  section("4. a read that failed never renders as an absent patient");
  const broke = renderSearch({
    initial: searchView({
      complete: false, unavailable: true, reason: "read_failed",
      probes: { identifiers: { unavailable: true, reason: "read_failed", error: "connection refused", truncated: false } },
    }),
  });
  ok("4a. it says part of the search did not answer", broke.includes("Part of this search did not answer"));
  ok("4b. it refuses the dangerous sentence", !broke.includes("Nobody matches"));
  ok("4c. and it prints the database's own words", broke.includes("connection refused"));
  const clean = renderSearch({ initial: searchView({}) });
  ok("4d. control: when every probe answered, 'Nobody matches.' IS said",
    clean.includes("Nobody matches."));
  const denied = renderSearch({ initial: searchView({ ran: false, unavailable: true, reason: "capability" }) });
  ok("4e. a capability refusal is a third sentence, not the second one",
    denied.includes("Not shown to you") && !denied.includes("Nobody matches"));

  // ── 5. THE REGISTER BRANCH IS HIDDEN WITHOUT patient.create ───────────────────────────────────────
  section("5. no patient.create, no register branch");
  const withCreate = renderPanel({ canRegisterPatient: true });
  const withoutCreate = renderPanel({ canRegisterPatient: false });
  ok("5a. hidden -- not greyed -- when the caller may not create a patient",
    !withoutCreate.includes("Register"));
  ok("5b. control: it is there for a caller who may", withCreate.includes("Register a new patient"));
  ok("5c. non-vacuity: the panel still rendered its search box in both",
    withoutCreate.includes("Search patients") && withCreate.includes("Search patients"));

  const noCreateCtx = await withoutCapabilities(ws, OWNER, ["patient.create"]);
  ok("5d. the page's own gate reads the capability table, and it is false for that caller",
    hasCapability(ctx, "patient.create") && !hasCapability(noCreateCtx, "patient.create"));
  await restoreCapabilities(ws, OWNER, ["patient.create"]);

  // ── 6. REGISTER-AND-START GOES THROUGH registerPatient ────────────────────────────────────────────
  section("6. the quick path is the registration engine, whole");
  const noAge = await register(admin, ctx, {
    givenName: "Nakato", familyName: "Nobirth", phone: "+256772000199", correlationId: CID,
  });
  ok("6a. the CPR-V2-005 minimum dataset refuses a registration with neither a birth date nor an estimate",
    !noAge.ok && noAge.status === 400 && /birthDate or ageEstimateYears/.test(noAge.message),
    JSON.stringify(noAge));
  const { data: nobirth } = await admin.from("practice_patient")
    .select("id").eq("workspace_id", ws).eq("display_name", "Nakato Nobirth");
  ok("6b. and it refused BEFORE writing anything", (nobirth ?? []).length === 0);

  const walkIn = await register(admin, ctx, {
    givenName: "Joseph", familyName: "Mugisha", sex: "male", ageEstimateYears: 34,
    phone: "+256772000102", reasonForVisit: "chest pain since morning", correlationId: CID,
  });
  ok("6c. control: the same registration with an ESTIMATED age is accepted -- 'estimated OR actual'",
    walkIn.ok, JSON.stringify(walkIn));
  const josephId = walkIn.ok ? walkIn.data.patientId : "";

  const { data: josephRows } = await admin.from("practice_patient")
    .select("id").eq("workspace_id", ws).eq("display_name", "Joseph Mugisha");
  ok("6d. exactly ONE patient record was created", (josephRows ?? []).length === 1,
    String((josephRows ?? []).length));

  const launched = await launchEncounter(admin, {
    workspaceId: ws, patientId: josephId, pathway: "new_walk_in",
    reasonForVisit: "chest pain since morning", actorId: OWNER, correlationId: CID,
  });
  ok("6e. and the consultation is reached", launched.ok && !launched.data.resumed && launched.data.status === "DRAFT",
    JSON.stringify(launched));
  const encId = launched.ok ? launched.data.id : "";
  const { data: encRow } = await admin.from("practice_encounter")
    .select("id, patient_id, entry_pathway").eq("id", encId).maybeSingle();
  ok("6f. filed against that patient, on that pathway",
    encRow?.patient_id === josephId && encRow?.entry_pathway === "new_walk_in", JSON.stringify(encRow));

  const regForm = src("src/app/practice/(shell)/patients/RegistrationForm.tsx");
  const regRoute = src("src/app/api/v1/practice/registration/route.ts");
  const regEngine = src("src/lib/practice/registration.ts");
  ok("6g. the screen presses that chain and no other: form -> /registration -> register() -> registerPatient()",
    regForm.includes("/api/v1/practice/registration")
    && regForm.includes("/api/v1/practice/encounters")
    && regRoute.includes("register(auth.caller.admin")
    && regEngine.includes("registerPatient(admin"));

  const registerPhase = renderPanel({
    phase: "register", form: { today: "2026-08-09", majorityAge: 18, template: null, fields: [] },
  });
  // ⚠ THE BUTTON, NOT THE SENTENCE. This scanned for the bare phrase and survived a break that passed
  // canStartEncounter={false} to the form -- because the PANEL'S OWN HEADING says the same words. The
  // heading is copy; the button is the act, and only one of them registers anybody.
  ok("6h. the branch renders the real form, with the act that does both",
    registerPhase.includes("Register and start the consultation</button>"));
  ok("6i. and states what the quick path defers, which is the hospital numbers and nothing else",
    registerPhase.includes("Deferred by this quick registration")
    && registerPhase.includes("hospital and clinic numbers"));

  // ── 7. THE DUPLICATE IS CAUGHT ON THE QUICK PATH EXACTLY AS ON THE FULL ONE ───────────────────────
  section("7. the duplicate check does not weaken on the quick path");
  const quickAgain = await register(admin, ctx, {
    // What the quick form sends: names, an estimate, a contact. No identifiers card, no relationships.
    givenName: "Joseph", familyName: "Mugisha", sex: "male", ageEstimateYears: 34,
    phone: "+256772000102", custom: {}, correlationId: CID,
  });
  const fullAgain = await register(admin, ctx, {
    // What the full form sends: the same person, plus everything the longer form collects.
    givenName: "Joseph", familyName: "Mugisha", sex: "male", ageEstimateYears: 34,
    phone: "+256772000102", email: "joseph@example.com",
    relationships: [{ relationshipType: "spouse", fullName: "Grace Mugisha", phone: "+256772000103" }],
    custom: {}, correlationId: CID,
  });
  const idsOf = (r: any) => ((r.candidates ?? []) as any[]).map(c => c.id).sort().join(",");
  ok("7a. the quick path is refused with the candidates",
    !quickAgain.ok && quickAgain.status === 409 && quickAgain.code === "POSSIBLE_DUPLICATE"
    && idsOf(quickAgain) === josephId, JSON.stringify(quickAgain));
  ok("7b. the full path is refused identically -- same code, same candidates",
    !fullAgain.ok && fullAgain.code === (quickAgain as any).code && idsOf(fullAgain) === idsOf(quickAgain),
    JSON.stringify({ quick: (quickAgain as any).code, full: (fullAgain as any).code }));
  const { data: stillOne } = await admin.from("practice_patient")
    .select("id").eq("workspace_id", ws).eq("display_name", "Joseph Mugisha");
  ok("7c. and neither attempt created a second record", (stillOne ?? []).length === 1,
    String((stillOne ?? []).length));

  const namesake1 = await register(admin, ctx, {
    givenName: "Sarah", familyName: "Ainembabazi", birthDate: "1988-02-02",
    phone: "+256772000104", correlationId: CID,
  });
  const namesakeBlocked = await register(admin, ctx, {
    givenName: "Sarah", familyName: "Ainembabazi", birthDate: "1988-02-02",
    phone: "+256772000105", correlationId: CID,
  });
  const namesakeConfirmed = await register(admin, ctx, {
    givenName: "Sarah", familyName: "Ainembabazi", birthDate: "1988-02-02",
    phone: "+256772000105", confirmNew: true, correlationId: CID,
  });
  ok("7d. control: a genuine namesake is a QUESTION, not a wall -- refused until confirmed, then registered",
    namesake1.ok && !namesakeBlocked.ok && (namesakeBlocked as any).code === "POSSIBLE_DUPLICATE"
    && namesakeConfirmed.ok,
    JSON.stringify({ first: namesake1.ok, blocked: (namesakeBlocked as any).code, confirmed: namesakeConfirmed.ok }));

  const okello = await register(admin, ctx, {
    givenName: "Peter", familyName: "Okello", birthDate: "1975-06-06",
    phone: "+256772000106", nationalId: "CM75001PEO", correlationId: CID,
  });
  const stolenNumber = await register(admin, ctx, {
    givenName: "Patrick", familyName: "Otim", birthDate: "1980-01-01",
    phone: "+256772000107", nationalId: "CM75001PEO", correlationId: CID,
  });
  const ownNumber = await register(admin, ctx, {
    givenName: "Patrick", familyName: "Otim", birthDate: "1980-01-01",
    phone: "+256772000107", nationalId: "CM80002PAO", correlationId: CID,
  });
  ok("7e. an identifier already on the register is refused OUTRIGHT on the quick path -- not a question",
    okello.ok && !stolenNumber.ok && (stolenNumber as any).code === "DUPLICATE_IDENTIFIER",
    JSON.stringify({ okello: okello.ok, clash: (stolenNumber as any).code }));
  ok("7f. control: the same registration with its own number is accepted", ownNumber.ok,
    JSON.stringify(ownNumber));

  // ── 8. THE PATHWAY IS READ FROM THE RECORD, OR NOT GUESSED ────────────────────────────────────────
  section("8. the visit type is established before anything is written");
  const unreadable = pathwayFor({ unavailable: true, count: 0 });
  ok("8a. an unreadable history refuses the launch rather than filing a first visit",
    !unreadable.ok && /could not be read/.test((unreadable as any).message)
    && /Nothing was opened/.test((unreadable as any).message), JSON.stringify(unreadable));
  const fresh = pathwayFor({ unavailable: false, count: 0 });
  ok("8b. control: no earlier encounter is a new walk-in",
    fresh.ok && (fresh as any).pathway === "new_walk_in");
  const returning = pathwayFor({ unavailable: false, count: 2 });
  ok("8c. control: a patient seen here before is a follow-up",
    returning.ok && (returning as any).pathway === "walk_in_followup");

  const { data: josephEncs } = await admin.from("practice_encounter")
    .select("id").eq("workspace_id", ws).eq("patient_id", josephId);
  const { data: aminaEncs } = await admin.from("practice_encounter")
    .select("id").eq("workspace_id", ws).eq("patient_id", aminaId);
  ok("8d. the input to that decision is a real per-patient read",
    (josephEncs ?? []).length === 1 && (aminaEncs ?? []).length === 0,
    JSON.stringify({ joseph: (josephEncs ?? []).length, amina: (aminaEncs ?? []).length }));

  const encRouteSrc = src("src/app/api/v1/practice/encounters/route.ts");
  ok("8e. the route it reads carries the patient filter and does not discard the read's error",
    encRouteSrc.includes('req.nextUrl.searchParams.get("patientId")')
    && encRouteSrc.includes("const { data: encounters, error } = await q")
    && encRouteSrc.includes("unavailable: !!error"));
  // ⚠ THIS USED TO SCAN THE PICKER, and the picker no longer holds the rule -- startEncounterFor() does,
  // for all four screens that start an encounter. Left pointing at the picker it would have gone green
  // on a file that no longer contains a decision at all.
  const startRule = src("src/lib/practice/encounter-start.ts");
  // ⚠ AND THE THIRD CONJUNCT IS THE CALL, NOT THE IMPORT -- assertion 2b's lesson, learned again here.
  // It read `picker.includes("startEncounterFor")` and survived a deliberate break that aliased the
  // import (`startEncounterFor as launch`) and called something else: the word was still on line 6.
  ok("8f. and the launcher acts on that field rather than on the length of the list",
    startRule.includes("d?.unavailable === true") && startRule.includes("pathwayFor(prior)")
    && picker.includes("await startEncounterFor(patientId)"));

  // ── 9. A SECOND PRESS RESUMES ─────────────────────────────────────────────────────────────────────
  section("9. resumed, never duplicated -- which is what the panel promises");
  const again = await launchEncounter(admin, {
    workspaceId: ws, patientId: josephId, pathway: "new_walk_in", actorId: OWNER, correlationId: CID,
  });
  ok("9a. the second launch resumes the first", again.ok && again.data.resumed && again.data.id === encId,
    JSON.stringify(again));
  const { data: liveRows } = await admin.from("practice_encounter")
    .select("id").eq("workspace_id", ws).eq("patient_id", josephId);
  ok("9b. and there is still exactly one encounter for that patient", (liveRows ?? []).length === 1,
    String((liveRows ?? []).length));
  ok("9c. the panel says so before anybody presses it",
    renderPanel({}).includes("resumed rather than duplicated"));

  // ── 10. THE SAME DEFECT, ONE LAYER IN: THE LONGITUDINAL RECORD ────────────────────────────────────
  //
  // /practice/encounters/record/{patientId} offered "Start an encounter for this patient" and NAVIGATED
  // to the patient's page. The board's defect with the excuse removed: this screen has the patient in
  // its URL, so there was nothing to work out -- it sent somebody away to search for a patient whose
  // record was open in front of them.
  section("10. the record starts the consultation it is standing on");
  const record = src("src/app/practice/(shell)/encounters/record/[patientId]/page.tsx");
  const control = src("src/app/practice/(shell)/encounters/StartEncounterAction.tsx");
  const patientActions = src("src/app/practice/(shell)/patients/[patientId]/PatientActions.tsx");
  const summaryPanel = src("src/app/practice/(shell)/patients/SummaryPanel.tsx");

  ok("10a. the record no longer sends a clinical act to the patient register",
    !record.includes("/practice/patients"));
  ok("10b. it presses the act in place instead", record.includes("<StartEncounterAction"));
  ok("10c. gated on encounter.create, and on no capability code that had to be invented",
    record.includes('hasCapability(shell.ctx, "encounter.create")'));
  // ⚠ HIDDEN, NOT DISABLED. The gate has to be a conditional RENDER: a greyed-out "Start a consultation"
  // is still an offer, and the person it is offered to is the one who cannot accept it.
  ok("10d. hidden rather than greyed -- the capability gates the render, not a disabled attribute",
    record.includes("{canStartEncounter && (") && !record.includes("disabled={!canStartEncounter"));

  const noStartCtx = await withoutCapabilities(ws, OWNER, ["encounter.create"]);
  ok("10e. and that capability is a real revocable grant, false for a caller without it",
    hasCapability(ctx, "encounter.create") && !hasCapability(noStartCtx, "encounter.create"));
  await restoreCapabilities(ws, OWNER, ["encounter.create"]);

  // ── ONE IMPLEMENTATION OF THE ACT, WHICH IS WHY THE RECORD COULD HAVE ITS OWN BUTTON AT ALL ───────
  //
  // The defence written against building this in place was that a second implementation is a second
  // place for the resume-before-create rule to be got wrong. It was right, and by then there were three.
  ok("10f. no screen writes its own launch any more -- the four call sites hold no encounter POST",
    [record, patientActions, summaryPanel, picker, control]
      .every(f => !f.includes("/api/v1/practice/encounters")));
  ok("10g. and none of them decides a pathway, which is the thing that had drifted",
    !summaryPanel.includes("new_walk_in") && !summaryPanel.includes("walk_in_followup")
    && !patientActions.includes("new_walk_in") && !record.includes("new_walk_in"));
  // ⚠ THE DRIFT, NAMED. SummaryPanel computed `!unavailable && rows.length > 0` and launched on it, so
  // an unreadable history opened a `new_walk_in` -- the exact claim pathwayFor exists to refuse, on a
  // field written onto the encounter permanently. Two siblings refused it; this one did not.
  ok("10h. control: the panel that had the bug no longer reads a list length to decide anything",
    !summaryPanel.includes("recentEncounters.rows.length > 0"));

  // ── THE RULE ITSELF, EVERY BRANCH, OVER A STUBBED TRANSPORT ───────────────────────────────────────
  const seen: { url: string; method: string; body: any }[] = [];
  const reply = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300, status, json: async () => body,
  });
  async function underFetch(
    route: (url: string, init: any) => any, run: () => Promise<any>,
  ) {
    const real = (globalThis as any).fetch;
    seen.length = 0;
    (globalThis as any).fetch = async (u: any, init: any) => {
      seen.push({
        url: String(u), method: String(init?.method ?? "GET"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return route(String(u), init);
    };
    try { return await run(); } finally { (globalThis as any).fetch = real; }
  }
  const posts = () => seen.filter(c => c.method.toUpperCase() === "POST");

  const history = (body: unknown, status = 200) => (url: string) =>
    url.includes("?status=all") ? reply(status, body) : reply(201, { encounter: { id: "enc-created", resumed: false } });

  const unreadableHistory = await underFetch(history({ encounters: [], unavailable: true, detail: "connection refused" }),
    () => startEncounterFor("pat-1"));
  ok("10i. an unreadable history refuses the launch -- and NOTHING is posted",
    !unreadableHistory.ok && /could not be read/.test(unreadableHistory.message) && posts().length === 0,
    JSON.stringify({ r: unreadableHistory, posts: posts().length }));

  const refusedRead = await underFetch(history({}, 500), () => startEncounterFor("pat-1"));
  ok("10j. a history read that errored refuses too, in the server's own status, and posts nothing",
    !refusedRead.ok && /HTTP 500/.test(refusedRead.message) && posts().length === 0,
    JSON.stringify({ r: refusedRead, posts: posts().length }));

  const firstVisit = await underFetch(history({ encounters: [], unavailable: false }),
    () => startEncounterFor("pat-1"));
  ok("10k. control: a history that ANSWERED empty is a first visit, and it is created",
    firstVisit.ok && firstVisit.pathway === "new_walk_in" && firstVisit.encounterId === "enc-created"
    && posts()[0]?.body?.pathway === "new_walk_in",
    JSON.stringify({ r: firstVisit, body: posts()[0]?.body }));

  const returningPatient = await underFetch(history({ encounters: [{ id: "e1" }, { id: "e2" }], unavailable: false }),
    () => startEncounterFor("pat-1"));
  ok("10l. control: a patient with encounters here is a follow-up, and the POST carries that",
    returningPatient.ok && returningPatient.pathway === "walk_in_followup"
    && posts()[0]?.body?.pathway === "walk_in_followup",
    JSON.stringify({ r: returningPatient, body: posts()[0]?.body }));

  ok("10m. the history is asked for BY PATIENT, encoded, and it is the patient asked about",
    seen[0]?.url.includes("patientId=pat-1") && seen[0]?.url.includes("status=all")
    && seen[0]?.method.toUpperCase() === "GET", seen[0]?.url);

  const refusedLaunch = await underFetch(
    (url: string) => url.includes("?status=all")
      ? reply(200, { encounters: [], unavailable: false })
      : reply(409, { error: { code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" } }),
    () => startEncounterFor("pat-1"));
  // ⚠ THE SERVER'S OWN WORDS. "That did not work" over a refused launch sends somebody to press it
  // again; naming the reason sends them to the record.
  ok("10n. a refused launch carries the reason the server gave, and reaches no encounter",
    !refusedLaunch.ok && /not active \(archived or merged\)/.test(refusedLaunch.message)
    && !("encounterId" in refusedLaunch), JSON.stringify(refusedLaunch));

  // ── AND THE CONTROL SAYS WHAT HAPPENED, WHERE IT WAS PRESSED ──────────────────────────────────────
  const renderAction = (props: Record<string, unknown>) => renderToStaticMarkup(
    React.createElement(StartEncounterActionView as any, {
      label: "Start a consultation with Joseph Mugisha", busy: false, notice: null,
      onStart: () => {}, ...props,
    }),
  );
  const working = renderAction({ busy: true });
  ok("10o. a press is not silent -- it says the consultation is opening, and cannot be pressed twice",
    working.includes("Opening the consultation") && working.includes("disabled=\"\""));
  const idle = renderAction({});
  ok("10p. control: idle, it names the patient it will open a consultation with, and is pressable",
    idle.includes("Start a consultation with Joseph Mugisha") && !idle.includes("disabled=\"\""));
  const failed = renderAction({ notice: { kind: "err", text: unreadableHistory.ok ? "" : unreadableHistory.message } });
  ok("10q. and a refusal is drawn AT the button, not on the page somebody was sent to",
    failed.includes("could not be read") && !idle.includes("could not be read"));

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
