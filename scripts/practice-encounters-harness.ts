/**
 * Practice clinical-encounter harness -- PEN-003 / DM-001 s8-s10 / s16, exercised against the live
 * database through the same engine the API uses.
 *
 * WHAT IT PROVES:
 *   1. FLOW-001's launch: an encounter opens from a patient, links a named appointment, refuses an
 *      appointment belonging to someone else, and RESUMES rather than duplicating a live encounter.
 *      The partial unique index refuses a second live encounter even on a raw insert.
 *   2. The state machine: legal transitions move, illegal ones are refused with the reason, and every
 *      move lands in the status history.
 *   3. SOAP segments are one live row per type -- a second save of the same type overwrites, it does
 *      not append a second draft.
 *   4. A diagnosis names a longitudinal Problem once and REUSES it on the next encounter, which is what
 *      makes the problem list span visits rather than repeat itself.
 *   5. SIGNED IS IMMUTABLE, AND THE DATABASE ENFORCES IT (migration 194 s6). The engine refuses notes,
 *      diagnoses and treatments after signature; and a RAW update that bypasses the engine entirely is
 *      refused by the trigger. Migration 194's header promises this file asserts that guarantee
 *      explicitly, so its absence is visible rather than assumed -- if section 6 did not apply, these
 *      assertions FAIL and name the trigger.
 *   6. Workspace isolation non-vacuously; anon reads 0 rows from all six encounter tables.
 *
 * CONTROLS: every refusal is paired with the same operation on an editable encounter, so a green
 * "refused" can never be an artefact of a malformed statement.
 *
 *   npx --yes tsx scripts/practice-encounters-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { daysAhead } from "./_harness-time";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import {
  launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment,
  getEncounter, patientTimeline,
} from "../src/lib/practice/encounters";
// Saving a SOAP segment moved to the documentation engine when CPR-130 made it a versioned write. This
// harness's assertions about segments are unchanged and still belong here: they are about the ENCOUNTER's
// behaviour (one live row per type, refused after signature), not about the history behind it.
import { saveNoteSegment as saveNote } from "../src/lib/practice/documentation";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0c31";
const USER_B = "00000000-0000-4000-8000-0000000e0c32";

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
    idempotency_key: `harness-enc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-enc",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-enc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-enc" };

async function main() {
  console.log("\nPractice clinical-encounter harness (PEN-003, DM-001 s8-s10/s16)\n");
  await cleanup();

  const wsA = await provision(USER_A, "HARNESS Encounter A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Encounter B (synthetic)", "b");

  // ── 0. Is the database guard actually deployed? ───────────────────────────
  // Reported before the assertions that depend on it, so a failure below reads as "the trigger is
  // missing" rather than as a mystery. The control proves the probe itself works.
  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  const guardDeployed = fns.some(f => f.fn_name === "practice_encounter_signed_guard");
  const probeWorks = fns.length > 0;
  ok("the function registry probe returns rows (the trigger check is not vacuous)", probeWorks, reg.error?.message ?? `${fns.length} functions`);
  ok("practice_encounter_signed_guard() is deployed (migration 194 s6)", guardDeployed,
    probeWorks ? "NOT FOUND -- migration 194 section 6 did not apply; signed records are engine-protected only" : "probe failed");

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Okello Peter", birthDate: "1979-06-02", sex: "male",
    phone: "0772 555 010", ...base,
  });
  if (!pa.ok) { ok("patient registration for the harness succeeded", false, pa.message); return report(); }
  const patientA = pa.data.id;

  const pOther = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nabirye Grace", birthDate: "1995-11-20", sex: "female",
    phone: "0772 555 011", ...base,
  });
  if (!pOther.ok) { ok("second patient registration succeeded", false, pOther.message); return report(); }

  // ── 1. FLOW-001 launch ────────────────────────────────────────────────────
  const appt = await bookAppointment(admin, {
    workspaceId: wsA, patientId: patientA, patientName: "Okello Peter",
    appointmentType: "new_consultation", scheduledAt: daysAhead(8), ...base,
  });
  ok("an appointment for the patient books", appt.ok, appt.ok ? "" : appt.message);

  const wrongAppt = await launchEncounter(admin, {
    workspaceId: wsA, patientId: pOther.data.id, pathway: "booked",
    appointmentId: appt.ok ? appt.data.id : null, ...base,
  });
  ok("an encounter filed against another patient's appointment is refused",
    !wrongAppt.ok && wrongAppt.code === "APPOINTMENT_PATIENT_MISMATCH", wrongAppt.ok ? "was allowed" : wrongAppt.code);

  const launched = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "booked",
    appointmentId: appt.ok ? appt.data.id : null, reasonForVisit: "cough for 5 days", ...base,
  });
  ok("launching from a booked appointment creates a DRAFT encounter",
    launched.ok && launched.data.status === "DRAFT" && launched.data.resumed === false,
    launched.ok ? JSON.stringify(launched.data) : launched.message);
  if (!launched.ok) return report();
  const encId = launched.data.id;

  const relaunch = await launchEncounter(admin, { workspaceId: wsA, patientId: patientA, pathway: "new_walk_in", ...base });
  ok("a second launch RESUMES the live encounter instead of duplicating the visit",
    relaunch.ok && relaunch.data.resumed === true && relaunch.data.id === encId,
    relaunch.ok ? JSON.stringify(relaunch.data) : relaunch.message);

  const rawSecond = await admin.from("practice_encounter").insert({
    workspace_id: wsA, patient_id: patientA, entry_pathway: "new_walk_in", status: "ACTIVE",
  });
  ok("the database refuses a second LIVE encounter for the same patient even when the engine is bypassed",
    !!rawSecond.error && /duplicate|unique/i.test(rawSecond.error.message), rawSecond.error?.message ?? "insert succeeded");
  // Control: the same raw insert for a DIFFERENT patient succeeds, so the refusal above is the partial
  // index doing its job rather than the insert being malformed.
  const rawControl = await admin.from("practice_encounter").insert({
    workspace_id: wsA, patient_id: pOther.data.id, entry_pathway: "new_walk_in", status: "ACTIVE",
  }).select("id").single();
  ok("control: the same raw insert succeeds for a different patient", !rawControl.error, rawControl.error?.message ?? "");
  if (rawControl.data) await admin.from("practice_encounter").delete().eq("id", rawControl.data.id);

  const ghost = await launchEncounter(admin, {
    workspaceId: wsB, patientId: patientA, pathway: "booked", ...base,
  });
  ok("workspace B cannot open an encounter on workspace A's patient",
    !ghost.ok && ghost.code === "NOT_FOUND", ghost.ok ? "was allowed" : ghost.code);

  // ── 2. State machine ──────────────────────────────────────────────────────
  const illegal = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "SIGNED", ...base });
  ok("DRAFT cannot jump straight to SIGNED",
    !illegal.ok && illegal.code === "ILLEGAL_TRANSITION", illegal.ok ? "was allowed" : illegal.code);

  const started = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "ACTIVE", ...base });
  ok("DRAFT -> ACTIVE is allowed", started.ok, started.ok ? "" : started.message);

  const paused = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "PAUSED", ...base });
  const resumed = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "ACTIVE", ...base });
  ok("ACTIVE -> PAUSED -> ACTIVE round-trips", paused.ok && resumed.ok);

  // Control for the trigger assertions further down: the SAME raw update, on a LIVE encounter, succeeds.
  // Without this, "the database refused it" could be an artefact of a malformed statement rather than
  // proof that the signature is what closed the record.
  const rawLiveEdit = await admin.from("practice_encounter")
    .update({ reason_for_visit: "cough for 5 days" }).eq("id", encId).select("id").maybeSingle();
  ok("control: a raw edit of a LIVE encounter succeeds", !rawLiveEdit.error && !!rawLiveEdit.data,
    rawLiveEdit.error?.message ?? "no row updated");

  // ── 3. Notes: one live segment per type ───────────────────────────────────
  const n1 = await saveNote(admin, { workspaceId: wsA, encounterId: encId, noteType: "subjective", body: "first draft", ...base });
  const n2 = await saveNote(admin, { workspaceId: wsA, encounterId: encId, noteType: "subjective", body: "cough, no fever", ...base });
  ok("a SOAP segment saves and re-saves", n1.ok && n2.ok, n2.ok ? "" : n2.message);

  const badType = await saveNote(admin, { workspaceId: wsA, encounterId: encId, noteType: "vibes", body: "x", ...base });
  ok("an unknown note type is refused", !badType.ok && badType.code === "VALIDATION_ERROR", badType.ok ? "was allowed" : badType.code);

  const { data: segs } = await admin.from("practice_encounter_note")
    .select("note_type, body").eq("encounter_id", encId).eq("note_type", "subjective");
  ok("re-saving overwrites the segment rather than appending a second draft",
    (segs ?? []).length === 1 && (segs ?? [])[0]?.body === "cough, no fever", JSON.stringify(segs));

  // ── 4. Diagnosis, treatment, and the longitudinal problem ────────────────
  const dx = await recordDiagnosis(admin, {
    workspaceId: wsA, encounterId: encId, label: "Acute bronchitis", certainty: "confirmed",
    isPrimary: true, problemLabel: "Recurrent bronchitis", ...base,
  });
  ok("a diagnosis records and creates the named problem", dx.ok && !!dx.data.problemId, dx.ok ? "" : dx.message);

  const tx = await recordTreatment(admin, {
    workspaceId: wsA, encounterId: encId, treatmentType: "medication", label: "Amoxicillin",
    dose: "500mg", route: "oral", frequency: "8 hourly", duration: "5 days", ...base,
  });
  ok("a treatment records against the encounter", tx.ok, tx.ok ? "" : tx.message);

  // ── 5. Signature, and immutability after it ──────────────────────────────
  const completed = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "COMPLETED", ...base });
  ok("ACTIVE -> COMPLETED is allowed", completed.ok, completed.ok ? "" : completed.message);

  // Control: an encounter that is completed-but-unsigned is still editable, so the refusals that follow
  // are caused by the SIGNATURE and not by the encounter merely being finished.
  const preSign = await saveNote(admin, { workspaceId: wsA, encounterId: encId, noteType: "plan", body: "review in 5 days", ...base });
  ok("control: a COMPLETED but unsigned encounter still accepts a note", preSign.ok, preSign.ok ? "" : preSign.message);

  const signed = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "SIGNED", ...base });
  ok("COMPLETED -> SIGNED is allowed and stamps signed_at", signed.ok, signed.ok ? "" : signed.message);
  const { data: signedRow } = await admin.from("practice_encounter").select("signed_at, signed_by, status").eq("id", encId).single();
  ok("the signature is recorded on the encounter",
    !!signedRow?.signed_at && signedRow?.signed_by === USER_A && signedRow?.status === "SIGNED", JSON.stringify(signedRow));

  const postNote = await saveNote(admin, { workspaceId: wsA, encounterId: encId, noteType: "plan", body: "sneaky edit", ...base });
  ok("the engine refuses a note after signature", !postNote.ok && postNote.code === "ENCOUNTER_LOCKED", postNote.ok ? "was allowed" : postNote.code);
  const postDx = await recordDiagnosis(admin, { workspaceId: wsA, encounterId: encId, label: "Added later", ...base });
  ok("the engine refuses a diagnosis after signature", !postDx.ok && postDx.code === "ENCOUNTER_LOCKED", postDx.ok ? "was allowed" : postDx.code);
  const postTx = await recordTreatment(admin, { workspaceId: wsA, encounterId: encId, treatmentType: "advice", label: "Added later", ...base });
  ok("the engine refuses a treatment after signature", !postTx.ok && postTx.code === "ENCOUNTER_LOCKED", postTx.ok ? "was allowed" : postTx.code);

  // THE GUARANTEE MIGRATION 194 PROMISES: bypass the engine completely and go at the table directly.
  const rawEdit = await admin.from("practice_encounter")
    .update({ reason_for_visit: "rewritten after the fact" }).eq("id", encId);
  ok("the DATABASE refuses a raw edit of a signed encounter (migration 194 s6 trigger)",
    !!rawEdit.error && /signed/i.test(rawEdit.error.message), rawEdit.error?.message ?? "the update succeeded");

  const rawAmendWithEdit = await admin.from("practice_encounter")
    .update({ status: "AMENDED", reason_for_visit: "rewritten under cover of an amendment" }).eq("id", encId);
  ok("the DATABASE refuses an amendment that also rewrites the original content",
    !!rawAmendWithEdit.error && /signed/i.test(rawAmendWithEdit.error.message), rawAmendWithEdit.error?.message ?? "the update succeeded");

  const { data: unchanged } = await admin.from("practice_encounter").select("reason_for_visit, status").eq("id", encId).single();
  ok("the signed encounter still holds its original content",
    unchanged?.reason_for_visit === "cough for 5 days" && unchanged?.status === "SIGNED", JSON.stringify(unchanged));

  const amend = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "AMENDED", ...base });
  ok("a governed amendment IS allowed (the lock is not a dead end)", amend.ok, amend.ok ? "" : amend.message);

  // ── 6. The problem list spans visits ─────────────────────────────────────
  const second = await launchEncounter(admin, { workspaceId: wsA, patientId: patientA, pathway: "walk_in_followup", ...base });
  ok("a follow-up encounter opens once the first is closed", second.ok, second.ok ? "" : second.message);
  if (second.ok) {
    const { data: prevLink } = await admin.from("practice_encounter").select("previous_encounter_id").eq("id", second.data.id).single();
    ok("the follow-up links back to the previous encounter", prevLink?.previous_encounter_id === encId, JSON.stringify(prevLink));

    await transitionEncounter(admin, { workspaceId: wsA, encounterId: second.data.id, to: "ACTIVE", ...base });
    const dx2 = await recordDiagnosis(admin, {
      workspaceId: wsA, encounterId: second.data.id, label: "Acute bronchitis",
      problemLabel: "Recurrent bronchitis", ...base,
    });
    ok("the same named problem is REUSED on the next encounter, not duplicated",
      dx2.ok && dx.ok && dx2.data.problemId === dx.data.problemId, dx2.ok ? `${dx2.data.problemId}` : dx2.message);

    const { count: problems } = await admin.from("practice_problem")
      .select("*", { count: "exact", head: true }).eq("patient_id", patientA);
    ok("the patient has exactly one problem row for that label", (problems ?? 0) === 1, `${problems}`);

    const timeline = await patientTimeline(admin, wsA, patientA, 10);
    ok("the timeline returns both encounters, newest first",
      timeline.encounters.length === 2 && timeline.encounters[0].id === second.data.id, `${timeline.encounters.length}`);
    ok("the timeline carries each encounter's diagnoses",
      (timeline.diagnosesByEncounter[encId] ?? []).length === 1, JSON.stringify(Object.keys(timeline.diagnosesByEncounter)));

    // ── AN EMPTY CLINICAL TIMELINE IS THE MOST DANGEROUS EMPTY LIST IN THIS PRODUCT ────────────────
    //
    // ⚠ BOTH READS DISCARDED THEIR ERRORS. A failed query returned `encounters: []`, and an empty
    // timeline does not read as "something went wrong" -- it reads as A PATIENT WITH NO HISTORY. Three
    // places said so in words: the patient record ("No encounters recorded for this patient yet"), the
    // consultation screen ("This is the first recorded encounter for this patient", read DURING a
    // consultation by somebody deciding how much history to take), and worst of all the AI assistant,
    // which fed "No previous consultations recorded here" TO THE MODEL as grounding and let it write a
    // fluent summary resting on a false absence.
    //
    // ⚠ AND THE COMPILER COULD NOT HELP: patientTimeline already returned an OBJECT, so adding
    // `unavailable` broke nothing and tsc stayed at zero. Third time in three commits. All six callers
    // were found by hand.
    const failingTimeline = {
      from: (table: string) => {
        if (table !== "practice_encounter") return admin.from(table);
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "order"]) chain[m] = () => chain;
        chain.limit = async () => ({ data: null, error: { message: "simulated timeline failure" } });
        return chain;
      },
    };
    const blindTimeline = await patientTimeline(failingTimeline as never, wsA, patientA, 10);
    ok("timeline-1. ⚠ a timeline whose encounter read FAILED says so, and does not report an empty history",
      blindTimeline.unavailable === true && blindTimeline.encounters.length === 0
      && /simulated timeline failure/.test(blindTimeline.detail ?? ""),
      JSON.stringify(blindTimeline));

    // The DIAGNOSIS read is reported separately, because a timeline with its consultations and no
    // diagnoses is still worth showing -- and is a different claim from one with nothing on it.
    const failingDiagnoses = {
      from: (table: string) => {
        if (table !== "practice_diagnosis") return admin.from(table);
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
        chain.in = async () => ({ data: null, error: { message: "simulated diagnosis failure" } });
        return chain;
      },
    };
    const partialTimeline = await patientTimeline(failingDiagnoses as never, wsA, patientA, 10);
    ok("timeline-2. ⚠ a failed DIAGNOSIS read is reported separately -- the consultations are still real",
      partialTimeline.unavailable === false && partialTimeline.diagnosesUnavailable === true
      && partialTimeline.encounters.length === 2,
      JSON.stringify({ u: partialTimeline.unavailable, d: partialTimeline.diagnosesUnavailable, n: partialTimeline.encounters.length }));

    // CONTROL. Without it both pass just as well if every timeline reported itself unavailable.
    ok("timeline-control. the same read through the real client is available, with its diagnoses",
      timeline.unavailable === false && timeline.diagnosesUnavailable === false && timeline.detail === null,
      JSON.stringify({ u: timeline.unavailable, d: timeline.diagnosesUnavailable, detail: timeline.detail }));

    // ⚠ AND THE SENTENCES THEMSELVES. The engine flag is only half the fix: the three claims above are
    // written in JSX, and a page that ignores `unavailable` still prints them. Source-checked, because
    // a React branch cannot be reached from here -- the same reason adaptive-4 exists.
    const claims: [string, string, RegExp][] = [
      ["patient record", "src/app/practice/(shell)/patients/[patientId]/page.tsx", /No encounters recorded/],
      ["consultation", "src/app/practice/(shell)/encounters/[encounterId]/page.tsx", /first recorded encounter/],
    ];
    for (const [where, file, claim] of claims) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      const guarded = /timeline\.unavailable\s*\?/.test(src) && claim.test(src);
      ok(`timeline-3-${where}. the "no history" sentence sits behind a timeline.unavailable check`,
        guarded, `guard=${/timeline\.unavailable\s*\?/.test(src)} claim=${claim.test(src)}`);
    }
  }

  // ── 7. Detail view + history ─────────────────────────────────────────────
  const detail = await getEncounter(admin, wsA, encId);
  ok("getEncounter returns the encounter with its patient, notes, diagnoses and treatments",
    !!detail && detail.notes.length === 2 && detail.diagnoses.length === 1 && detail.treatments.length === 1,
    detail ? `notes=${detail.notes.length} dx=${detail.diagnoses.length} tx=${detail.treatments.length}` : "null");
  ok("every transition is in the status history",
    !!detail && detail.history.length >= 6 && detail.history.some((h: { to_status: string }) => h.to_status === "SIGNED"),
    detail ? `${detail.history.length} entries` : "null");
  ok("getEncounter is workspace-scoped (B cannot read A's encounter)", (await getEncounter(admin, wsB, encId)) === null);

  // ── 8. Isolation + anon ──────────────────────────────────────────────────
  const TABLES = ["practice_encounter", "practice_encounter_note", "practice_encounter_status_history",
    "practice_problem", "practice_diagnosis", "practice_treatment"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in every encounter table (denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("anon reads 0 rows from every encounter table", leaked === 0, `${leaked} table(s) leaked`);

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
