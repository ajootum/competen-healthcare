/**
 * Competen Practice pilot-gate preflight -- CPR-IAM-001 s14 cutover checklist, evaluated against the
 * live database instead of remembered.
 *
 * WHAT THIS IS FOR: s14 is a ten-line checklist ending in "run controlled internal and pilot-user
 * acceptance testing". Most of those lines are facts about the deployment and can be checked here; two
 * of them are facts about a HUMAN and cannot. The point of automating the first set is to shrink the
 * second, so the person walking docs/CPR-GATE-001-pilot-walkthrough.md spends their attention on the
 * part that genuinely needs a person -- not on re-verifying that a table exists.
 *
 * IT ALSO RUNS THE WHOLE CLINICAL LOOP END TO END, in a synthetic workspace it provisions and then
 * deletes: provision -> onboard -> ACTIVE -> book -> check in -> register a patient -> launch an
 * encounter -> note -> diagnosis -> treatment -> sign. That is the acceptance-criteria core of
 * CPR-BUILD-000 phases 0-3 in one pass. If this is green, a failure during the human walkthrough is a
 * UI or session problem, not an engine problem -- which is exactly the distinction that makes a failed
 * walkthrough diagnosable.
 *
 * MANUAL ITEMS ARE PRINTED, NEVER PASSED. A preflight that quietly greened "a person signed in" would
 * be worse than no preflight.
 *
 *   npx --yes tsx scripts/practice-pilot-gate.ts
 */
import { loadEnvConfig } from "@next/env";
import { daysAhead } from "./_harness-time";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, platformFlag, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment, transitionAppointment } from "../src/lib/practice/scheduling";
import { launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment } from "../src/lib/practice/encounters";
import { saveNoteSegment as saveNote } from "../src/lib/practice/documentation";
import { launchState } from "../src/lib/practice/operations";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER = "00000000-0000-4000-8000-0000000a7e10";
const CORR = "gate-preflight";

let pass = 0;
const fails: string[] = [];
const manual: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const todo = (label: string, detail: string) => {
  manual.push(label); console.log(`  HUMAN ${label}\n        ${detail}`);
};

const payload: IndividualRequest = {
  displayName: "GATE Preflight Practice (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
  professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
  termsVersion: "pilot-1", privacyNoticeVersion: "pilot-1", source: "pilot",
};

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER]);
}

async function main() {
  console.log("\nCompeten Practice pilot-gate preflight (CPR-IAM-001 s14)\n");
  console.log("-- Deployment ------------------------------------------------------------");

  // 1. Schema + seed catalogs.
  const catalogs: Record<string, number | null> = {};
  for (const t of ["practice_role_capabilities", "practice_onboarding_step_catalog", "practice_plans", "practice_platform_flags"]) {
    const { count } = await admin.from(t).select("*", { count: "exact", head: true });
    catalogs[t] = count ?? null;
  }
  ok("provisioning schema + seed catalogs are deployed (migration 191)",
    Object.values(catalogs).every(n => (n ?? 0) > 0), JSON.stringify(catalogs));

  // Every phase's tables, so "the routes are deployed" means the stores behind them are too.
  const PHASE_TABLES: Record<string, string[]> = {
    "phase 1 diary (192)": ["practice_availability_slot", "practice_appointment", "practice_arrival", "practice_queue_entry"],
    "phase 2 identity (193)": ["practice_patient", "practice_patient_identifier", "practice_patient_contact", "practice_patient_merge"],
    "phase 3 encounter (194)": ["practice_encounter", "practice_encounter_note", "practice_encounter_status_history", "practice_problem", "practice_diagnosis", "practice_treatment"],
  };
  for (const [label, tables] of Object.entries(PHASE_TABLES)) {
    const missing: string[] = [];
    for (const t of tables) {
      // A missing table returns 204 with error null and count NULL -- the COUNT is the discriminator,
      // never the error. This project has shipped a broken audit that tested the error instead.
      const { count } = await admin.from(t).select("*", { count: "exact", head: true });
      if (count === null) missing.push(t);
    }
    ok(`${label} tables all exist`, missing.length === 0, missing.join(", "));
  }

  // The database-level immutability guard is a deployment fact, not an engine fact.
  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  ok("the function registry probe returns rows (the trigger check is not vacuous)", fns.length > 0, reg.error?.message ?? "");
  ok("practice_encounter_signed_guard() is deployed (migration 194 s6)",
    fns.some(f => f.fn_name === "practice_encounter_signed_guard"),
    "signed encounters would be engine-protected only");

  // 2. Launch flags + posture.
  const flags = {
    practice_pilot_provisioning: await platformFlag(admin, "practice_pilot_provisioning"),
    practice_sign_in: await platformFlag(admin, "practice_sign_in"),
    practice_public_signup: await platformFlag(admin, "practice_public_signup"),
  };
  const state = launchState(flags);
  console.log(`\n  Launch state: ${state.state} -- ${state.detail}\n`);
  ok("at least one provisioning pathway is open",
    flags.practice_pilot_provisioning || flags.practice_public_signup, JSON.stringify(flags));
  ok("the public posture and the sign-in flag agree",
    flags.practice_sign_in || !flags.practice_public_signup,
    "public signup is ON while sign-in is OFF -- a person could create a Practice and not be able to return to it");

  // ── The clinical loop, end to end, in a workspace this script owns ──────
  //
  // The anon-denial check runs AFTER this, deliberately. Run against an empty database it proves
  // nothing: "anon reads 0 rows" is trivially true when there are no rows. Building the loop first
  // makes the denial test non-vacuous BY CONSTRUCTION rather than by hoping production data exists.
  console.log("\n-- The acceptance-criteria core, run end to end ---------------------------");
  await cleanup();

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: "gate-preflight-run", request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "gate", correlation_id: CORR,
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: USER, correlation_id: CORR, workspace_id: null }, payload);
  ok("provisioning completes every step", run.ok && !!run.workspaceId, run.ok ? "" : `${run.failedStep} / ${run.errorCode}`);
  if (!run.ok || !run.workspaceId) { await cleanup(); return report(); }
  const ws = run.workspaceId;

  const { data: steps } = await admin.from("provisioning_step").select("step_code, status").eq("request_id", req!.id);
  ok("every provisioning step succeeded (the saga has no silent gap)",
    (steps ?? []).length > 0 && (steps as { status: string }[]).every(s => s.status === "succeeded"),
    JSON.stringify(steps));

  const { data: wsRow } = await admin.from("practice_workspace").select("status").eq("id", ws).single();
  ok("the new workspace starts in ONBOARDING", wsRow?.status === "ONBOARDING", wsRow?.status);

  // THE CHECK THAT FOUND THE ASSIGN_CAPABILITIES BUG. A membership with no capabilities renders an
  // empty sidebar and 403s every API call, so a workspace can be "provisioned" and unusable.
  const { data: memberships } = await admin.from("practice_membership").select("id, role_code").eq("workspace_id", ws);
  const membershipIds = ((memberships ?? []) as { id: string }[]).map(m => m.id);
  const { count: caps } = membershipIds.length
    ? await admin.from("practice_role_assignment").select("*", { count: "exact", head: true })
      .in("membership_id", membershipIds).is("effective_to", null)
    : { count: 0 };
  ok("capabilities were granted to the new memberships", (caps ?? 0) > 0, `${caps}`);

  const practitioner = ((memberships ?? []) as { id: string; role_code: string }[]).find(m => m.role_code === "practitioner");
  const { data: heldRows } = practitioner
    ? await admin.from("practice_role_assignment").select("capability_code").eq("membership_id", practitioner.id).is("effective_to", null)
    : { data: [] };
  const held = ((heldRows ?? []) as { capability_code: string }[]).map(r => r.capability_code);
  const NEEDED = ["practice.home.view", "practice.calendar.view", "appointment.manage", "patient.list", "encounter.create", "encounter.sign"];
  const absent = NEEDED.filter(c => !held.includes(c));
  ok("the owner holds every capability the shipped phases need", absent.length === 0, `missing: ${absent.join(", ")}`);

  // Onboarding to ACTIVE. practice_onboarding is ONE row per (workspace, user) carrying current_step
  // and completed_steps -- not a row per step -- so completion is a state change on that row.
  const { data: onboarding } = await admin.from("practice_onboarding").select("id, state, current_step").eq("workspace_id", ws).maybeSingle();
  ok("an onboarding instance exists for the owner", !!onboarding, JSON.stringify(onboarding));
  if (onboarding) {
    const { error: obErr } = await admin.from("practice_onboarding")
      .update({ state: "completed", completed_at: new Date().toISOString() }).eq("id", onboarding.id);
    ok("onboarding can be completed", !obErr, obErr?.message ?? "");
  }
  const { error: actErr } = await admin.from("practice_workspace").update({ status: "ACTIVE" }).eq("id", ws);
  const { data: active } = await admin.from("practice_workspace").select("status").eq("id", ws).single();
  ok("the workspace reaches ACTIVE", !actErr && active?.status === "ACTIVE", actErr?.message ?? active?.status);

  const base = { actorId: USER, correlationId: CORR };

  const patient = await registerPatient(admin, {
    workspaceId: ws, displayName: "Gate Preflight Patient", birthDate: "1990-03-15", sex: "female",
    phone: "0772 900 900", ...base,
  });
  ok("a patient registers with an allocated CP Patient Number (CPR-PID-001)",
    patient.ok && /^\d{2}-\d{6}$/.test(patient.data.patientNumber), patient.ok ? patient.data.patientNumber : patient.message);
  if (!patient.ok) { await cleanup(); return report(); }

  const appt = await bookAppointment(admin, {
    workspaceId: ws, patientId: patient.data.id, patientName: "Gate Preflight Patient",
    appointmentType: "new_consultation", scheduledAt: daysAhead(13), ...base,
  });
  ok("an appointment books against the registry", appt.ok, appt.ok ? "" : appt.message);
  if (!appt.ok) { await cleanup(); return report(); }

  // ⚠ REPOINTED 2026-08-16: this used to TRANSITION to CONFIRMED and went red the day commit
  // 2ee597ae made a staff booking confirm ITSELF -- "this path used to enter every non-walk-in as
  // REQUESTED, which asked a human to confirm a booking a colleague just made". The property PEN-001
  // actually needs -- CONFIRMED before ARRIVED -- still holds; what changed is WHO confirms: the
  // staff channel at birth, the patient channel by a person. So the pin now asserts the deliberate
  // birth status instead of replaying a transition the engine rightly refuses as CONFIRMED-to-
  // CONFIRMED. The patient-channel REQUESTED path keeps its own coverage in the booking harnesses.
  const { data: born } = await admin.from("practice_appointment")
    .select("status").eq("id", appt.data.id).single();
  ok("a staff booking is born CONFIRMED -- 2ee597ae's rule, which is what makes check-in immediately offerable",
    born?.status === "CONFIRMED", `status=${born?.status}`);
  const arrived = await transitionAppointment(admin, { workspaceId: ws, appointmentId: appt.data.id, to: "ARRIVED", ...base });
  ok("check-in moves the appointment to ARRIVED and queues the patient", arrived.ok, arrived.ok ? "" : arrived.message);
  const { count: queued } = await admin.from("practice_queue_entry").select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("a queue entry exists after check-in", (queued ?? 0) === 1, `${queued}`);

  const enc = await launchEncounter(admin, {
    workspaceId: ws, patientId: patient.data.id, pathway: "booked", appointmentId: appt.data.id,
    reasonForVisit: "gate preflight", ...base,
  });
  ok("an encounter launches from the checked-in appointment", enc.ok, enc.ok ? "" : enc.message);
  if (!enc.ok) { await cleanup(); return report(); }

  await transitionEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, to: "ACTIVE", ...base });
  const note = await saveNote(admin, { workspaceId: ws, encounterId: enc.data.id, noteType: "assessment", body: "preflight", ...base });
  const dx = await recordDiagnosis(admin, { workspaceId: ws, encounterId: enc.data.id, label: "Preflight finding", problemLabel: "Preflight problem", ...base });
  const tx = await recordTreatment(admin, { workspaceId: ws, encounterId: enc.data.id, treatmentType: "advice", label: "Preflight advice", ...base });
  ok("note, diagnosis and treatment all record", note.ok && dx.ok && tx.ok);
  ok("the diagnosis created a longitudinal problem", dx.ok && !!dx.data.problemId);

  await transitionEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, to: "COMPLETED", ...base });
  const signed = await transitionEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, to: "SIGNED", ...base });
  ok("the encounter signs, closing the loop", signed.ok, signed.ok ? "" : signed.message);

  const afterSign = await saveNote(admin, { workspaceId: ws, encounterId: enc.data.id, noteType: "assessment", body: "tampered", ...base });
  ok("the signed record refuses further edits", !afterSign.ok && afterSign.code === "ENCOUNTER_LOCKED", afterSign.ok ? "was allowed" : afterSign.code);

  const { count: events } = await admin.from("practice_audit_event").select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("the whole run is audited", (events ?? 0) >= 5, `${events} event(s)`);

  // ── Tenant denial, measured while there is something to deny ────────────
  console.log("\n-- Tenant isolation, against a database that now holds real rows ----------");
  let svc = 0, leaked = 0;
  const GUARDED = ["practice_workspace", "practice_membership", "practice_patient", "practice_encounter", "practice_platform_flags"];
  for (const t of GUARDED) {
    const { count: s } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((s ?? 0) > 0) svc++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in EVERY guarded table (so the denial test cannot be vacuous)",
    svc === GUARDED.length, `${svc}/${GUARDED.length}`);
  ok("anon reads 0 rows from every guarded Practice table", leaked === 0, `${leaked} leaked`);

  await cleanup();
  const { count: left } = await admin.from("practice_workspace").select("*", { count: "exact", head: true }).eq("id", ws);
  ok("the synthetic workspace is removed", (left ?? 0) === 0, `${left}`);

  // ── What only a person can attest ──────────────────────────────────────
  console.log("\n-- Attested by a human, never by this script -----------------------------");
  todo("A person signs in cold, from signed out, with their own credentials",
    flags.practice_sign_in
      ? "practice_sign_in is ON, so the form renders. Walk it from a logged-out browser."
      : "practice_sign_in is OFF, so the form does not render. Flip it in Platform Operations > Competen Practice first.");
  todo("Controlled internal and pilot-user acceptance testing",
    "Walk docs/CPR-GATE-001-pilot-walkthrough.md in a browser. No script can stand in for a person using the product.");
  // ⚠ THIS NOTE SENT A READER AFTER A RETIREMENT THAT NEVER HAPPENED. It said "confirm disclosure
  // assertion 7e was retired deliberately in the same change". 7e is
  // practice-content-harness:481 -- "<page> has no password field" -- and it is LIVE and GREEN today
  // (126/0). It never had to be retired, because it is about a different thing: the journey pages
  // collect no credential, and the panel below them now LINKS to /practice/sign-in, which is where a
  // password field belongs. Nothing conflicts.
  //
  // A note that names a consequence which did not occur is the same defect as a failure message that
  // names the expected cause instead of the observed one: it hands the next reader a conclusion.
  todo("Replace the public \"not open yet\" panel with live actions",
    flags.practice_sign_in
      // ⚠ RE-VERIFIED 2026-08-21. This note used to say /practice renders "Create your practice".
      // It no longer does, and neither does anywhere else: signup is shut by owner decision, the
      // sign-in footer now reads "See how to get a Practice", and /practice/sign-up refuses honestly.
      // The note was describing copy that had been deliberately removed -- which is the very defect
      // the comment above it warns about, committed by the note itself.
      ? "DONE -- verified 2026-08-21: /practice/sign-in renders the real form, and NO public surface "
        + "offers to create a practice, because signup is closed by decision. The sign-in copy is read "
        + "from practice_sign_in rather than written as prose, so those two cannot disagree again. "
        + "Nothing to do; confirm and tick."
      : "do this only after the two items above pass.");

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "READY"}  ${pass} automated assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}`);
  console.log(`${manual.length} item(s) remain for a human.${fails.length ? "" : " The deployment is ready for the walkthrough."}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
