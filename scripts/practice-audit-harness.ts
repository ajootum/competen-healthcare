/**
 * CPR-CORE-001 CORE-14: audit logging and permissions checks.
 *
 * s13 makes six claims about security, privacy and audit, and s16 finishes with "all state changes are
 * auditable". Each is treated here as a RULE TO VERIFY AGAINST THE ENGINES, not a property to assume:
 *
 *   1  every query is tenant/practice scoped and practitioner authorised
 *   2  patient data is not returned solely by human-readable name; stable identifiers are used
 *   3  every state-changing action carries actor, timestamp, source and an audit entry
 *   4  deleted clinical/practice records are voided or superseded, not physically removed
 *   5  AI and derived services receive only the minimum authorised data
 *   6  export and print actions are logged
 *
 * ⚠ WHY RULE 3 IS EXERCISED RATHER THAN READ. "No unaudited write was found" is true of a harness that
 * called nothing, and the existing clinic-day harness asserts exactly that shape -- `auditCount > 0`
 * passes against a day in which one row was written and twenty-eight state changes left no trace. So
 * every state-changing engine function below is CALLED, the trail is read immediately afterwards, and the
 * number of calls actually made is itself asserted (3-control-a). A fixture that silently stops halfway
 * fails instead of passing.
 *
 * ⚠ AND WHY THERE IS A NO-OP CONTROL. An audit detector that returned "yes, a row appeared" unconditionally
 * would satisfy every assertion in section 3. 3-control-b saves a note segment whose text has not changed
 * -- a call the engine correctly treats as nothing happening -- and requires the detector to see NOTHING.
 * Without it the whole section is unfalsifiable.
 *
 * WHAT THIS FOUND, all of it fixed in the same change:
 *   - activity.ts wrote state and left no audit entry at all (plan/start/end)
 *   - saveNoteSegment and updateDocument wrote clinical content and left no audit entry
 *   - the reports CSV download was logged as a SEARCH, so no export of it was visible to a reviewer
 *   - /api/v1/practice/attachments gated on `encounter.view`, which is not a capability and never was
 *
 *   npx --yes tsx scripts/practice-audit-harness.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { planActivity, startActivity, endActivity, ACTIVITY_CAPABILITIES } from "../src/lib/practice/activity";
import { bookAppointment, rescheduleAppointment, transitionAppointment, transitionQueueEntry } from "../src/lib/practice/scheduling";
import { launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment, getEncounter, patientTimeline } from "../src/lib/practice/encounters";
import { createFollowUp, scheduleFollowUp, closeFollowUp } from "../src/lib/practice/follow-ups";
import { createTask, transitionTask } from "../src/lib/practice/tasks";
import { registerPatient, searchPatients } from "../src/lib/practice/patients";
import { saveNoteSegment, createDocument, updateDocument, transitionDocument, amendDocument } from "../src/lib/practice/documentation";
import { recordLibraryDocument, binDocument, purgeDocument } from "../src/lib/practice/document-library";
import { exportPatientRecord } from "../src/lib/practice/privacy";
import { practiceReport, exportActivityCsv } from "../src/lib/practice/reports";
import { runAssistant } from "../src/lib/practice/ai-assistant";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

// Hex only: "au01" is not a uuid and PostgREST rejects the whole fixture over it.
const DOCTOR = "00000000-0000-4000-8000-0000000a0d17";
const STRANGER = "00000000-0000-4000-8000-0000000a0d18";
const TZ = "Africa/Kampala";  // UTC+3, no DST -- the arithmetic below is checkable by hand.
const CORR = "harness-audit";

const REPO = join(__dirname, "..");

/* eslint-disable @typescript-eslint/no-explicit-any */

type AuditRow = {
  id: string; event_type: string; actor_id: string | null; occurred_at: string;
  correlation_id: string | null; source: string | null;
};
type AccessRow = {
  id: string; actor_id: string; subject_kind: string; action: string; route: string | null;
};

// ── FIXTURE ──────────────────────────────────────────────────────────────────────────────────────────

async function wipe(userId: string) {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", userId);
  for (const w of (ws ?? []) as { id: string }[]) {
    // The self-referencing columns go first. A workspace delete cascades everything below it, but a row
    // that points at a sibling in the same table is not cleared by that cascade and the delete is refused.
    await admin.from("practice_encounter")
      .update({ interrupted_by_id: null, previous_encounter_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_clinical_document")
      .update({ supersedes_document_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_clinical_document").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", userId);
  // ⚠ The workspace delete lives in _cleanup.ts, which unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause and REPORTS a failure instead of discarding
  // it. The self-reference nulling above still runs first and is unchanged -- it solves a different
  // problem (a row pointing at a sibling in its own table, which no cascade clears).
  await purgeWorkspacesOwnedBy(admin, [userId]);
  // ⚠ practice_audit_event is NOT cleared here any more. Migration 247 made it append-only, so the
  // delete raises and the error was discarded -- it has been a silent no-op ever since. This harness
  // scopes its own assertions to rows created after the run started, which is the only thing that works.
}

async function provision(userId: string, name: string): Promise<string | null> {
  const { data: req, error: reqErr } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-audit-${userId.slice(-4)}-${Date.now()}`, request_type: "pilot",
    actor_user_id: userId, target_user_id: userId, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  // Checked rather than trusted: a null row here throws a TypeError two lines later, which reports a
  // fixture problem as a crash in the code under test.
  if (reqErr || !req) { console.error(`provisioning request refused: ${reqErr?.message ?? "no row"}`); return null; }

  const payload: IndividualRequest = {
    displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
    defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1",
    source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: userId, correlation_id: CORR, workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error(`provisioning failed: ${run.errorCode}`); return null; }
  return run.workspaceId;
}

/**
 * The capabilities this practice ACTUALLY granted, read out of the assignment table.
 *
 * Not a list re-typed into the harness. A hand-written list can invent the same fiction an engine did and
 * agree with it forever -- which is exactly how `practice.calendar.manage` and `encounter.view` survived.
 *
 * The error is returned separately: "this owner holds nothing" and "the grants could not be read" are
 * different answers, and only the second should ever stop the run.
 */
async function grantedCapabilities(workspaceId: string, userId: string): Promise<{ caps: string[] | null; error: string | null }> {
  const { data: m, error: mErr } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active");
  if (mErr) return { caps: null, error: mErr.message };
  const ids = ((m ?? []) as { id: string }[]).map(r => r.id);
  if (ids.length === 0) return { caps: null, error: "no active membership" };
  const { data, error } = await admin.from("practice_role_assignment")
    .select("capability_code").in("membership_id", ids);
  if (error) return { caps: null, error: error.message };
  return { caps: [...new Set(((data ?? []) as { capability_code: string }[]).map(r => r.capability_code))], error: null };
}

const ctxFor = (workspaceId: string, userId: string, capabilities: string[]): WorkspaceContext => ({
  userId, workspaceId, workspaceName: "Harness", workspaceType: "individual_practice",
  workspaceStatus: "active", roleCodes: ["owner"], capabilities,
  entitled: true, entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
});

// ── SOURCE SCANNING (rule 1's capability codes) ──────────────────────────────────────────────────────

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Every capability code this product NAMES, wherever it names it.
 *
 * A capability code is a string compared against a database table. Inventing a plausible one costs
 * nothing at compile time and silently disables the feature at runtime -- three times now. This is the
 * check that turns that from a thing somebody has to remember into a thing the harness refuses.
 */
function capabilityCodesInSource(): { codes: Map<string, string[]>; filesRead: number } {
  const files = [
    ...sourceFiles(join(REPO, "src", "app", "api", "v1", "practice")),
    ...sourceFiles(join(REPO, "src", "app", "practice")),
    ...sourceFiles(join(REPO, "src", "lib", "practice")),
  ];
  const patterns = [
    /requirePracticeContext\(\s*"([^"]+)"\s*\)/g,
    /hasCapability\([^,)]+,\s*"([^"]+)"\s*\)/g,
    /capabilities\.includes\(\s*"([^"]+)"\s*\)/g,
  ];
  const codes = new Map<string, string[]>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const where = codes.get(m[1]) ?? [];
        if (!where.includes(f)) where.push(f);
        codes.set(m[1], where);
      }
    }
  }
  return { codes, filesRead: files.length };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== SECURITY, PRIVACY AND AUDIT (CPR-CORE-001 s13, s16 \"all state changes are auditable\") ===");

  section("Controls: the fixture is real before anything is claimed about it");

  const columns = await admin.from("practice_audit_event").select("id, source, correlation_id").limit(1);
  ok("0a. control -- the audit trail is readable and has the columns s13 asks for",
    !columns.error, columns.error?.message ?? "");
  if (columns.error) { report(); return; }

  await wipe(DOCTOR); await wipe(STRANGER);
  const ws = await provision(DOCTOR, "Harness Audit");
  const other = await provision(STRANGER, "Harness Audit Stranger");
  ok("0b. control -- two separate practices exist to test a boundary between",
    !!ws && !!other && ws !== other, `${ws} / ${other}`);
  if (!ws || !other) { await wipe(DOCTOR); await wipe(STRANGER); report(); return; }

  const granted = await grantedCapabilities(ws, DOCTOR);
  ok("0c. control -- the owner's capabilities were read from the grants, not typed into this file",
    granted.caps !== null && granted.caps.length > 0, granted.error ?? `${granted.caps?.length} granted`);
  if (!granted.caps) { await wipe(DOCTOR); await wipe(STRANGER); report(); return; }
  const caps = granted.caps;

  const c = ctxFor(ws, DOCTOR, caps);
  const otherCtx = ctxFor(other, STRANGER, caps);

  // ══ 1. "Every query must be tenant/practice scoped and practitioner authorised." ══════════════════
  section("Rule 1: tenant scoped, practitioner authorised");

  const { data: known, error: knownErr } = await admin.from("practice_role_capabilities")
    .select("capability_code");
  // A FAILED READ IS NOT AN EMPTY CATALOGUE. Collapsing the two would report every capability in the
  // product as invented, which is the loudest possible way to say nothing.
  ok("1a-control. the capability catalogue is readable and populated",
    !knownErr && ((known ?? []) as any[]).length >= 30,
    knownErr?.message ?? `${((known ?? []) as any[]).length} codes`);
  const catalogue = new Set(((known ?? []) as { capability_code: string }[]).map(r => r.capability_code));

  const { codes, filesRead } = capabilityCodesInSource();
  ok("1a-control-2. the source scan actually read the practice source tree",
    filesRead >= 100 && codes.size >= 25, `${filesRead} files, ${codes.size} distinct codes`);
  ok("1a-control-3. and the catalogue check can say no -- a code nobody seeded is absent",
    !catalogue.has("encounter.view") && !catalogue.has("practice.calendar.manage"),
    "a code this product has already invented twice reads as REAL, so the check proves nothing");

  const invented = [...codes.entries()].filter(([code]) => !catalogue.has(code));
  ok("1a. every capability code this product names exists in practice_role_capabilities",
    invented.length === 0,
    invented.map(([code, files]) => `${code} (${files.map(f => f.replace(REPO, "")).join(", ")})`).join(" | "));

  ok("1b-control. the engine's own gate codes are the ones it compiled against",
    ACTIVITY_CAPABILITIES.every(x => catalogue.has(x)), ACTIVITY_CAPABILITIES.join(", "));

  // A caller without the write capability is refused, and the SAME call with it is allowed. One without
  // the other proves only that the function can return something.
  const today = new Date(new Date().toLocaleString("en-CA", { timeZone: TZ }).slice(0, 10)).toISOString().slice(0, 10);
  const noWrite = ctxFor(ws, DOCTOR, caps.filter(x => x !== "appointment.manage"));
  const refused = await planActivity(admin, noWrite, {
    activityType: "outpatient_clinic", title: "Refused Clinic", planDate: today,
    plannedStartMinute: 8 * 60, plannedEndMinute: 13 * 60,
  }, { correlationId: CORR });
  ok("1c. an unauthorised practitioner cannot plan a day",
    !refused.ok && refused.code === "FORBIDDEN", JSON.stringify(refused));

  // ══ The clinic the rest of the rules are asserted against ═════════════════════════════════════════
  const at = (h: number, m = 0) =>
    new Date(`${today}T${String(h - 3).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`).toISOString();

  const REGISTRY_NAME: string = "Auditable Namesake";
  const p1 = await registerPatient(admin, {
    workspaceId: ws, displayName: REGISTRY_NAME, birthDate: "1980-05-05", phone: "+256700000111",
    actorId: DOCTOR, correlationId: CORR,
  });
  ok("1d-control. the fixture patient was registered through the engine",
    p1.ok, p1.ok ? "" : JSON.stringify(p1));
  if (!p1.ok) { await wipe(DOCTOR); await wipe(STRANGER); report(); return; }

  const activity = await planActivity(admin, c, {
    activityType: "outpatient_clinic", title: "Audited Clinic", planDate: today,
    plannedStartMinute: 8 * 60, plannedEndMinute: 18 * 60,
  }, { correlationId: CORR });
  ok("1d. and the same call WITH the capability is allowed", activity.ok, activity.ok ? "" : JSON.stringify(activity));
  if (!activity.ok) { await wipe(DOCTOR); await wipe(STRANGER); report(); return; }

  // ⚠ CROSS-TENANT: the stranger's workspace, this practice's rows. Every engine below must answer
  // NOT_FOUND rather than acting -- and "Not found" rather than "not yours", because the second confirms
  // the row exists to somebody who should not know it does.
  const crossStart = await startActivity(admin, otherCtx, activity.value.id, { correlationId: CORR });
  ok("1e. another practice cannot start this practice's activity",
    !crossStart.ok && crossStart.code === "NOT_FOUND", JSON.stringify(crossStart));

  const crossFollowUp = await createFollowUp(admin, {
    workspaceId: other, patientId: p1.data.id, reason: "reaching across a tenant boundary",
    dueOn: today, actorId: STRANGER, correlationId: CORR,
  });
  ok("1f. another practice cannot raise a follow-up against this practice's patient",
    !crossFollowUp.ok && crossFollowUp.code === "NOT_FOUND", JSON.stringify(crossFollowUp));

  const crossLaunch = await launchEncounter(admin, {
    workspaceId: other, patientId: p1.data.id, pathway: "new_walk_in",
    actorId: STRANGER, correlationId: CORR,
  });
  ok("1g. another practice cannot open a consultation on this practice's patient",
    !crossLaunch.ok && crossLaunch.code === "NOT_FOUND", JSON.stringify(crossLaunch));

  // ══ 2. "Patient data must not be returned solely by human-readable name." ═════════════════════════
  section("Rule 2: stable identifiers, not names");

  const WRONG_NAME: string = "Somebody Else Entirely";
  ok("2a-control. the caller's spelling really does differ from the registry's",
    WRONG_NAME !== REGISTRY_NAME);
  const booking = await bookAppointment(admin, {
    workspaceId: ws, patientId: p1.data.id, patientName: WRONG_NAME,
    appointmentType: "new_consultation", scheduledAt: at(15), durationMinutes: 30,
    actorId: DOCTOR, correlationId: CORR,
  });
  ok("2a-control-2. the booking was accepted", booking.ok, booking.ok ? "" : JSON.stringify(booking));
  if (!booking.ok) { await wipe(DOCTOR); await wipe(STRANGER); report(); return; }

  const { data: apptRow, error: apptErr } = await admin.from("practice_appointment")
    .select("patient_id, patient_name").eq("id", booking.data.id).maybeSingle();
  ok("2a. a booking against a registered patient is keyed by the identifier, and carries the registry's name",
    !apptErr && apptRow?.patient_id === p1.data.id && apptRow?.patient_name === REGISTRY_NAME,
    apptErr?.message ?? JSON.stringify(apptRow));

  const byName = await searchPatients(admin, ws, REGISTRY_NAME);
  ok("2b-control. a name search finds the patient at all", byName.results.length >= 1,
    `${byName.results.length} results`);
  ok("2b-control-2. and a name nobody registered finds nobody",
    (await searchPatients(admin, ws, "Nobody Of That Name At All")).results.length === 0);
  // ⚠ THE OPAQUE IDENTIFIER IS THE CP PATIENT NUMBER NOW, not the retired P-XXXXXX. CPR-PID-001
  // (migration 289, 2026-08-12) made YY-NNNNNN the one human-facing identity and stopped minting a
  // practice_id for new registrations, so this pair asserted a shape the product no longer produces
  // and had been red since. It was missed when the rest of the suite was swept -- the SECOND stale
  // assertion from that change -- because it names the field only inside a regex.
  ok("2b. every search result carries a stable id and an opaque patient number, not just a name",
    byName.results.length >= 1
      && byName.results.every(r => /^[0-9a-f-]{36}$/.test(r.id) && /^\d{2}-\d{6}$/.test(r.patientNumber ?? "")),
    JSON.stringify(byName.results.map(r => [r.id, r.patientNumber])));

  const patientNumber = byName.results[0]?.patientNumber ?? "";
  const byIdentifier = await searchPatients(admin, ws, patientNumber);
  ok("2c. and the number retrieves the same person, ranked above the name that matched",
    byIdentifier.results[0]?.id === p1.data.id && byIdentifier.results[0]?.matchedBy === "patient_number",
    JSON.stringify(byIdentifier.results[0]));

  // ══ 3. "All state-changing actions require actor, timestamp, source and audit entry." ═════════════
  section("Rule 3: every state change leaves an audit entry");

  // The trail is read as a DELTA. Everything already seen is remembered, so each probe is judged on what
  // its own call produced rather than on a total that grows whatever happens.
  const seenAudit = new Set<string>();
  const seenAccess = new Set<string>();

  async function newAuditRows(): Promise<{ rows: AuditRow[]; error: string | null }> {
    const { data, error } = await admin.from("practice_audit_event")
      .select("id, event_type, actor_id, occurred_at, correlation_id, source")
      .eq("workspace_id", ws).order("occurred_at").limit(1000);
    // NEVER [] ON FAILURE. An unread trail reported as an empty one would turn every audited write in
    // this section into a finding, and every unaudited one into a pass on the next run.
    if (error) return { rows: [], error: error.message };
    const fresh = ((data ?? []) as AuditRow[]).filter(r => !seenAudit.has(r.id));
    fresh.forEach(r => seenAudit.add(r.id));
    return { rows: fresh, error: null };
  }

  async function newAccessRows(): Promise<{ rows: AccessRow[]; error: string | null }> {
    const { data, error } = await admin.from("practice_access_log")
      .select("id, actor_id, subject_kind, action, route")
      .eq("workspace_id", ws).order("occurred_at").limit(1000);
    if (error) return { rows: [], error: error.message };
    const fresh = ((data ?? []) as AccessRow[]).filter(r => !seenAccess.has(r.id));
    fresh.forEach(r => seenAccess.add(r.id));
    return { rows: fresh, error: null };
  }

  await newAuditRows();   // drain everything the fixture above already wrote
  await newAccessRows();

  let exercised = 0;
  const unaudited: string[] = [];
  const malformed: string[] = [];
  const unreadable: string[] = [];
  /** Ids the probes produce, so later sections can assert against the same objects. */
  const made: Record<string, string> = {};

  /**
   * Call one state-changing engine function, then look at the trail.
   *
   * A CALL THAT REFUSED IS NOT A SILENT SKIP. It is reported as its own failure -- an engine that started
   * returning 422 would otherwise make this whole section pass by exercising nothing.
   */
  async function probe(name: string, run: () => Promise<boolean>) {
    let ran: boolean;
    try { ran = await run(); } catch (e) { ran = false; console.log(`        ${name} threw: ${String(e)}`); }
    if (!ran) { unreadable.push(`${name}: the engine call did not succeed`); return; }
    exercised++;
    const { rows, error } = await newAuditRows();
    if (error) { unreadable.push(`${name}: the trail could not be read -- ${error}`); return; }
    if (rows.length === 0) { unaudited.push(name); return; }
    const bad = rows.filter(r =>
      r.actor_id !== DOCTOR
      || !r.occurred_at || Number.isNaN(Date.parse(r.occurred_at))
      || r.correlation_id !== CORR
      || !r.source);
    if (bad.length > 0) malformed.push(`${name} -> ${JSON.stringify(bad[0])}`);
  }

  // Sequenced as one morning, so every dependency is satisfied by the call before it.
  const PROBES: [string, () => Promise<boolean>][] = [
    ["activity.startActivity", async () => {
      // The source is declared, because a harness is not the web app. See the note in activity.ts.
      const r = await startActivity(admin, c, activity.value.id, { source: "integration", correlationId: CORR });
      return r.ok;
    }],
    ["scheduling.rescheduleAppointment", async () => {
      const r = await rescheduleAppointment(admin, {
        workspaceId: ws, appointmentId: booking.data.id, scheduledAt: at(16),
        actorId: DOCTOR, correlationId: CORR,
      });
      return r.ok;
    }],
    ["scheduling.transitionAppointment(CONFIRMED)", async () => (await transitionAppointment(admin, {
      workspaceId: ws, appointmentId: booking.data.id, to: "CONFIRMED", actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["scheduling.transitionAppointment(ARRIVED)", async () => {
      const r = await transitionAppointment(admin, {
        workspaceId: ws, appointmentId: booking.data.id, to: "ARRIVED", actorId: DOCTOR, correlationId: CORR,
      });
      if (r.ok && r.data.queueEntryId) made.queue = r.data.queueEntryId;
      return r.ok && !!r.data.queueEntryId;
    }],
    ["scheduling.transitionQueueEntry(READY)", async () => (await transitionQueueEntry(admin, {
      workspaceId: ws, entryId: made.queue, to: "READY", actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["encounters.launchEncounter", async () => {
      const r = await launchEncounter(admin, {
        workspaceId: ws, patientId: p1.data.id, pathway: "booked", appointmentId: booking.data.id,
        actorId: DOCTOR, correlationId: CORR,
      });
      if (r.ok) made.encounter = r.data.id;
      return r.ok;
    }],
    ["encounters.transitionEncounter(ACTIVE)", async () => (await transitionEncounter(admin, {
      workspaceId: ws, encounterId: made.encounter, to: "ACTIVE",
      actorId: DOCTOR, practitionerId: DOCTOR, correlationId: CORR,
    })).ok],
    ["documentation.saveNoteSegment", async () => {
      const r = await saveNoteSegment(admin, {
        workspaceId: ws, encounterId: made.encounter, noteType: "assessment",
        body: "Reviewed. Plan discussed.", actorId: DOCTOR, correlationId: CORR,
      });
      return r.ok && r.data.changed;
    }],
    ["encounters.recordDiagnosis", async () => (await recordDiagnosis(admin, {
      workspaceId: ws, encounterId: made.encounter, label: "Malaria", certainty: "confirmed",
      problemLabel: "Malaria", actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["encounters.recordTreatment", async () => (await recordTreatment(admin, {
      workspaceId: ws, encounterId: made.encounter, treatmentType: "medication",
      label: "Artemether-lumefantrine", actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["documentation.createDocument", async () => {
      const r = await createDocument(admin, {
        workspaceId: ws, patientId: p1.data.id, encounterId: made.encounter,
        title: "Referral", body: "Grateful for your opinion.", actorId: DOCTOR, correlationId: CORR,
      });
      if (r.ok) made.document = r.data.id;
      return r.ok;
    }],
    ["documentation.updateDocument", async () => (await updateDocument(admin, {
      workspaceId: ws, documentId: made.document, body: "Grateful for your opinion. Seen today.",
      actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["documentation.transitionDocument(FINAL)", async () => (await transitionDocument(admin, {
      workspaceId: ws, documentId: made.document, to: "FINAL", actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["documentation.transitionDocument(SIGNED)", async () => (await transitionDocument(admin, {
      workspaceId: ws, documentId: made.document, to: "SIGNED", actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["documentation.amendDocument", async () => {
      const r = await amendDocument(admin, {
        workspaceId: ws, documentId: made.document, reason: "corrected the referral address",
        actorId: DOCTOR, correlationId: CORR,
      });
      if (r.ok) made.successor = r.data.id;
      return r.ok;
    }],
    ["encounters.transitionEncounter(COMPLETED)", async () => (await transitionEncounter(admin, {
      workspaceId: ws, encounterId: made.encounter, to: "COMPLETED",
      actorId: DOCTOR, practitionerId: DOCTOR, correlationId: CORR,
    })).ok],
    ["follow-ups.createFollowUp", async () => {
      const r = await createFollowUp(admin, {
        workspaceId: ws, patientId: p1.data.id, originEncounterId: made.encounter,
        reason: "Review after treatment", dueOn: today, actorId: DOCTOR, correlationId: CORR,
      });
      if (r.ok) made.followUp = r.data.id;
      return r.ok;
    }],
    ["scheduling.bookAppointment", async () => {
      const r = await bookAppointment(admin, {
        workspaceId: ws, patientId: p1.data.id, patientName: REGISTRY_NAME,
        appointmentType: "scheduled_followup", scheduledAt: at(17, 30), durationMinutes: 20,
        actorId: DOCTOR, correlationId: CORR,
      });
      if (r.ok) made.followUpAppointment = r.data.id;
      return r.ok;
    }],
    ["follow-ups.scheduleFollowUp", async () => (await scheduleFollowUp(admin, {
      workspaceId: ws, followUpId: made.followUp, appointmentId: made.followUpAppointment,
      actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["follow-ups.closeFollowUp", async () => (await closeFollowUp(admin, {
      workspaceId: ws, followUpId: made.followUp, to: "COMPLETED", outcome: "seen and improving",
      actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["tasks.createTask", async () => {
      const r = await createTask(admin, {
        workspaceId: ws, title: "Chase the laboratory", assignedTo: DOCTOR,
        actorId: DOCTOR, correlationId: CORR,
      });
      if (r.ok) made.task = r.data.id;
      return r.ok;
    }],
    ["tasks.transitionTask(DONE)", async () => (await transitionTask(admin, {
      workspaceId: ws, taskId: made.task, to: "DONE", actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["document-library.recordLibraryDocument", async () => {
      const r = await recordLibraryDocument(admin, {
        workspaceId: ws, title: "Consent form", storagePath: `${ws}/harness/consent.pdf`,
        fileName: "consent.pdf", mimeType: "application/pdf", byteSize: 1024,
        actorId: DOCTOR, correlationId: CORR,
      });
      if (r.ok) made.libraryDocument = r.data.id;
      return r.ok;
    }],
    ["document-library.binDocument", async () => (await binDocument(admin, {
      workspaceId: ws, documentId: made.libraryDocument, actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["document-library.purgeDocument", async () => (await purgeDocument(admin, {
      workspaceId: ws, documentId: made.libraryDocument, actorId: DOCTOR, correlationId: CORR,
    })).ok],
    ["activity.endActivity", async () => (await endActivity(admin, c, activity.value.id,
      { source: "integration", correlationId: CORR })).ok],
  ];

  for (const [name, run] of PROBES) await probe(name, run);

  ok("3-control-a. every state-changing engine call this harness names was actually exercised",
    PROBES.length >= 25 && exercised === PROBES.length,
    `${exercised} of ${PROBES.length} ran -- ${unreadable.join("; ")}`);

  // ⚠ THE CONTROL THAT MAKES SECTION 3 FALSIFIABLE. A no-op save must produce NOTHING. Without this an
  // audit detector that always answered "a row appeared" would satisfy every assertion above.
  const noop = await saveNoteSegment(admin, {
    workspaceId: ws, encounterId: made.encounter, noteType: "assessment",
    body: "Reviewed. Plan discussed.", actorId: DOCTOR, correlationId: CORR,
  });
  const afterNoop = await newAuditRows();
  ok("3-control-b. a save that changed nothing writes no entry, and the detector sees that",
    noop.ok && !noop.data.changed && !afterNoop.error && afterNoop.rows.length === 0,
    afterNoop.error ?? `${afterNoop.rows.length} rows: ${afterNoop.rows.map(r => r.event_type).join(", ")}`);

  ok("3a. every state-changing engine call left an audit entry",
    unaudited.length === 0, unaudited.join(" | "));
  ok("3b. and every entry carries the actor, a timestamp, a source and the correlation id",
    malformed.length === 0, malformed.join(" | "));
  ok("3c. the trail could be read after every one of them",
    unreadable.length === 0, unreadable.join(" | "));

  // s13 names SOURCE explicitly, and the column defaults to 'api' -- so an engine that never sets it is
  // indistinguishable from one that always came through the API. This proves the declared value survives.
  const { data: activityRows, error: activityRowsErr } = await admin.from("practice_audit_event")
    .select("event_type, source").eq("workspace_id", ws).like("event_type", "practice.activity_%");
  const rows = (activityRows ?? []) as { event_type: string; source: string }[];
  ok("3d-control. the activity engine's entries are there to read",
    !activityRowsErr && rows.length >= 3, activityRowsErr?.message ?? `${rows.length} rows`);
  ok("3d. an entry records the SURFACE the write arrived through, not a default",
    rows.filter(r => r.event_type !== "practice.activity_planned").every(r => r.source === "integration")
      && rows.some(r => r.event_type === "practice.activity_planned" && r.source === "web"),
    JSON.stringify(rows));

  // ══ 4. "Deleted records should normally be voided or superseded rather than physically removed." ══
  section("Rule 4: voided or superseded, never physically removed");

  const countIn = async (table: string) => {
    const { count, error } = await admin.from(table)
      .select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    // A count that FAILED is not a count of nought -- the whole rule here is "the row is still there".
    return { count: error ? null : (count ?? 0), error: error?.message ?? null };
  };

  const libAfter = await countIn("practice_library_document");
  const { data: purged, error: purgedErr } = await admin.from("practice_library_document")
    .select("id, deleted_at, purged_at").eq("id", made.libraryDocument).maybeSingle();
  ok("4a-control. the library row can be read back at all", !libAfter.error && !purgedErr,
    libAfter.error ?? purgedErr?.message ?? "");
  ok("4a. a binned and then purged document keeps its row, marked, rather than disappearing",
    libAfter.count === 1 && !!purged?.deleted_at && !!purged?.purged_at, JSON.stringify(purged));

  const clinicalBinned = await binDocument(admin, {
    workspaceId: ws, documentId: made.document, actorId: DOCTOR, correlationId: CORR,
  });
  ok("4b. a CLINICAL document refuses deletion outright, and says what to do instead",
    !clinicalBinned.ok && clinicalBinned.code === "CLINICAL_DOCUMENT", JSON.stringify(clinicalBinned));

  const { data: amended, error: amendedErr } = await admin.from("practice_clinical_document")
    .select("id, status").eq("id", made.document).maybeSingle();
  const { data: successor } = await admin.from("practice_clinical_document")
    .select("id, supersedes_document_id, version").eq("id", made.successor).maybeSingle();
  ok("4c-control. both versions of the amended document are readable", !amendedErr && !!amended && !!successor,
    amendedErr?.message ?? JSON.stringify([amended, successor]));
  ok("4c. an amendment SUPERSEDES: the original stays, marked AMENDED, with the successor pointing at it",
    amended?.status === "AMENDED" && successor?.supersedes_document_id === made.document && successor?.version === 2,
    JSON.stringify([amended, successor]));

  // A cancelled consultation is the clearest case of the rule: it is the one a practitioner would call
  // "deleting" and the one that must survive as a record of a decision.
  const p2 = await registerPatient(admin, {
    workspaceId: ws, displayName: "Cancelled Consultation", birthDate: "1991-01-01",
    phone: "+256700000222", actorId: DOCTOR, correlationId: CORR,
  });
  ok("4d-control. a second patient exists to cancel a consultation for", p2.ok, p2.ok ? "" : JSON.stringify(p2));
  if (p2.ok) {
    const draft = await launchEncounter(admin, {
      workspaceId: ws, patientId: p2.data.id, pathway: "new_walk_in", actorId: DOCTOR, correlationId: CORR,
    });
    const draftId = draft.ok ? draft.data.id : "";
    const before = await countIn("practice_encounter");
    const cancelled = draft.ok
      ? await transitionEncounter(admin, {
        workspaceId: ws, encounterId: draftId, to: "CANCELLED",
        actorId: DOCTOR, practitionerId: DOCTOR, correlationId: CORR,
      })
      : null;
    const after = await countIn("practice_encounter");
    const { data: stillThere } = await admin.from("practice_encounter")
      .select("id, status").eq("id", draftId).maybeSingle();
    ok("4d-control-2. the cancellation was accepted and both counts were readable",
      cancelled !== null && cancelled.ok && before.count !== null && after.count !== null,
      JSON.stringify([cancelled, before, after]));
    ok("4d. cancelling a consultation voids it and removes nothing",
      before.count === after.count && stillThere?.status === "CANCELLED",
      `${before.count} -> ${after.count}, ${JSON.stringify(stillThere)}`);
  }

  // ══ 5. "AI and derived services receive only the minimum authorised data." ════════════════════════
  section("Rule 5: the assistant gets the minimum authorised data");

  // The two functions ai-assistant.ts builds its entire context from, asserted at the boundary that
  // matters: a workspace it was not called for.
  const groundedHere = await getEncounter(admin, ws, made.encounter);
  const timelineHere = await patientTimeline(admin, ws, p1.data.id);
  ok("5a-control. the grounding builders return this practice's record when asked for it",
    !!groundedHere?.encounter && timelineHere.encounters.length >= 1,
    JSON.stringify([!!groundedHere, timelineHere.encounters.length]));

  const groundedThere = await getEncounter(admin, other, made.encounter);
  const timelineThere = await patientTimeline(admin, other, p1.data.id);
  ok("5a. and nothing of it when asked from another practice",
    groundedThere === null && timelineThere.encounters.length === 0,
    JSON.stringify([groundedThere !== null, timelineThere.encounters.length]));

  // WITH CONSENT OFF, NOTHING IS EVEN READ. The gate runs before buildContext, so a refusal must leave no
  // session, no message and no disclosure entry -- the record content never reaches memory, let alone a
  // provider. Provisioning leaves the assistant off, which is the state being asserted.
  await newAccessRows();  // drain
  const refusedAi = await runAssistant(admin, c, {
    task: "summarise_encounter", encounterId: made.encounter, correlationId: CORR,
  });
  const afterAi = await newAccessRows();
  const { count: aiSessions, error: aiErr } = await admin.from("practice_ai_session")
    .select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("5b. an assistant this practice has not consented to reads nothing and discloses nothing",
    !refusedAi.ok && refusedAi.code === "AI_NOT_ENABLED"
      && !afterAi.error && afterAi.rows.length === 0
      && !aiErr && (aiSessions ?? 0) === 0,
    JSON.stringify([refusedAi, afterAi.rows.length, aiErr?.message ?? aiSessions]));

  // ⚠ THE CONTROL FOR 5b. "No disclosure was logged" is trivially true of a counter that never sees
  // anything, so the same counter is immediately shown a read that DID happen.
  await practiceReport(admin, c, { days: 7, correlationId: CORR });
  const afterReport = await newAccessRows();
  ok("5b-control. the same counter sees a read that really did happen",
    !afterReport.error && afterReport.rows.length >= 1
      && afterReport.rows.some(r => r.subject_kind === "search"),
    afterReport.error ?? JSON.stringify(afterReport.rows));

  // ══ 6. "Export and print actions must be logged." ═════════════════════════════════════════════════
  section("Rule 6: export and print are logged");

  await newAuditRows(); await newAccessRows();
  const exported = await exportPatientRecord(admin, c, p1.data.id, { correlationId: CORR });
  const exportAccess = await newAccessRows();
  const exportAudit = await newAuditRows();
  ok("6a-control. the export produced the patient's record, not an empty envelope",
    exported.ok && Array.isArray((exported.data as any).encounters) && (exported.data as any).encounters.length >= 1,
    exported.ok ? JSON.stringify((exported.data as any).encounters?.length) : JSON.stringify(exported));
  ok("6a. exporting a patient record is logged, in both the privacy log and the audit trail",
    !exportAccess.error && exportAccess.rows.some(r => r.action === "export" && r.subject_kind === "export")
      && !exportAudit.error && exportAudit.rows.some(r => r.event_type === "practice.patient_exported"),
    JSON.stringify([exportAccess.error ?? exportAccess.rows, exportAudit.error ?? exportAudit.rows.map(r => r.event_type)]));

  // ⚠ THE READ AND THE DOWNLOAD MUST BE DISTINGUISHABLE. practiceReport logs a search; the CSV download
  // used to log the same thing and nothing else, so a reviewer asking "what has left here" could not see
  // the file at all.
  await newAuditRows(); await newAccessRows();
  await practiceReport(admin, c, { days: 7, correlationId: CORR });
  const viewOnly = await newAccessRows();
  ok("6b-control. viewing the report logs a read and NOT an export",
    !viewOnly.error && viewOnly.rows.length >= 1 && viewOnly.rows.every(r => r.action !== "export"),
    viewOnly.error ?? JSON.stringify(viewOnly.rows));

  const csv = await exportActivityCsv(admin, c, { days: 7, correlationId: CORR });
  const csvAccess = await newAccessRows();
  const csvAudit = await newAuditRows();
  ok("6b-control-2. the download produced a file with the report in it",
    csv.csv.includes("Measure,Count,Of") && csv.csv.length > 200, `${csv.csv.length} bytes`);
  ok("6b. and downloading it is logged AS AN EXPORT, in both logs",
    !csvAccess.error && csvAccess.rows.some(r => r.action === "export" && r.route === "/api/v1/practice/reports/export")
      && !csvAudit.error && csvAudit.rows.some(r => r.event_type === "practice.report_exported"),
    JSON.stringify([csvAccess.error ?? csvAccess.rows, csvAudit.error ?? csvAudit.rows.map(r => r.event_type)]));

  // PRINTING IS A PAGE, NOT AN ENGINE, so it is asserted at the source. Weaker than exercising it and
  // said so rather than dressed up: what is checked is that the print view logs the act, and logs it
  // under the stronger verb -- the access taxonomy has no "print", and mapping it to "view" would
  // understate a copy nobody can recall in the one place a practice goes looking for it.
  const printPage = join(REPO, "src", "app", "practice", "(shell)", "documents", "[documentId]", "print", "page.tsx");
  let printSource = "";
  try { printSource = readFileSync(printPage, "utf8"); } catch { printSource = ""; }
  ok("6c-control. the print view is where this harness thinks it is",
    printSource.length > 0 && printSource.includes("PrintDocumentPage"), printPage);
  ok("6c. the print view logs the print, as an export rather than a view",
    /logAccess\(/.test(printSource) && /action:\s*"export"/.test(printSource)
      && /subjectKind:\s*"document"/.test(printSource),
    printSource.length ? "logAccess or its action is missing" : "the file could not be read");

  await wipe(DOCTOR); await wipe(STRANGER);
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
