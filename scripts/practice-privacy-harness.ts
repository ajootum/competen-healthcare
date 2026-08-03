/**
 * Practice privacy harness -- CPR-370, exercised against the live database through the same engine the
 * app uses.
 *
 * THE MODULE CLOSES A GAP THAT HAD BEEN OPEN SINCE PHASE 0: practice_audit_event recorded every WRITE
 * and nothing recorded a READ, so "who has opened this person's record" -- the question a patient is
 * most entitled to ask -- had no answer.
 *
 * WHAT IT PROVES:
 *   1. READS ARE RECORDED: opening a patient, an encounter and a document, running a search, exporting.
 *      Each lands with the patient denormalised onto it, which is the column the table exists for.
 *      A search records the TERM, because "who searched for this surname" is the question.
 *   2. THE REVIEWER IS NOT THE BYPASS. An access log is a list of who your patients are, so a reviewer
 *      WITHOUT patient.view sees stable references and no names -- asserted by checking the real name
 *      appears nowhere in the entire serialised response, not merely that a field was blanked. Paired
 *      with its control: the same review by a caller WITH patient.view does show names.
 *   3. REVIEWING IS ITSELF LOGGED. The one read that a naive implementation forgets.
 *   4. THE LOG IS APPEND-ONLY IN THE DATABASE -- update AND delete both refused, with a control proving
 *      the trigger is not refusing every write to the table.
 *   5. LOGGING NEVER BLOCKS A CLINICIAN, and the gap is never silent: a failing log write returns
 *      normally AND leaves a practice.access_log_failed entry in the audit trail.
 *   6. EXPORT is complete, self-describing, and logged twice -- as the largest read there is and as a
 *      thing that was done.
 *   7. Isolation non-vacuously; anon reads 0 rows.
 *
 *   npx --yes tsx scripts/practice-privacy-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { saveNoteSegment, createDocument } from "../src/lib/practice/documentation";
import { searchPractice } from "../src/lib/practice/search";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import {
  logAccess, patientAccessHistory, reviewAccess, exportPatientRecord, privacyPosture,
} from "../src/lib/practice/privacy";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e17c1";
const OTHER = "00000000-0000-4000-8000-0000000e17c2";

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
    idempotency_key: `harness-priv-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-priv",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-priv", workspace_id: null }, payload(name));
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

const base = { actorId: OWNER, correlationId: "harness-priv" };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The distinctive name the de-identification assertions hunt for across a whole serialised response. */
const PATIENT_NAME = "Zebrina Kwarikunda";

async function withoutCapability(workspaceId: string, userId: string, capability: string): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .eq("capability_code", capability).is("effective_to", null);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

async function restoreCapability(workspaceId: string, userId: string, capability: string) {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: null })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id)).eq("capability_code", capability);
}

async function main() {
  console.log("\nPractice privacy harness (CPR-370, migration 202)\n");
  await cleanup();

  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  ok("the function registry probe returns rows (the trigger checks are not vacuous)", fns.length > 0);
  ok("practice_access_log_immutable() is deployed (migration 202 s3)",
    fns.some(f => f.fn_name === "practice_access_log_immutable"), "NOT FOUND");

  const wsA = await provision(OWNER, "HARNESS Privacy A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Privacy B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  ok("the practitioner role now carries access.review and data.export (migration 202 s2)",
    a.ctx.capabilities.includes("access.review") && a.ctx.capabilities.includes("data.export"),
    a.ctx.capabilities.filter(c => c.startsWith("access") || c.startsWith("data")).join(","));

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: PATIENT_NAME, birthDate: "1990-08-14", sex: "female",
    phone: "0772 555 990", ...base,
  });
  if (!pa.ok) { ok("patient registration succeeded", false, pa.message); return report(); }
  const patientA = pa.data.id;

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "new_walk_in", reasonForVisit: "cough", ...base,
  });
  if (!enc.ok) { ok("encounter launch succeeded", false, enc.message); return report(); }
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "ACTIVE", ...base });
  await saveNoteSegment(admin, {
    workspaceId: wsA, encounterId: enc.data.id, noteType: "subjective", body: "dry cough for a week", ...base,
  });
  const doc = await createDocument(admin, {
    workspaceId: wsA, patientId: patientA, encounterId: enc.data.id,
    title: "Sick note", docType: "sick_note", body: "Unfit for work 2 days.", ...base,
  });
  ok("a patient, encounter and document exist for the harness", doc.ok, doc.ok ? "" : doc.message);
  if (!doc.ok) return report();

  // ── 1. Reads are recorded ─────────────────────────────────────────────────
  const { count: beforeAny } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("NOTHING IS LOGGED BY WRITING ALONE (the log records reads, not the setup above)",
    (beforeAny ?? 0) === 0, `${beforeAny} entries`);

  await logAccess(admin, {
    workspaceId: wsA, actorId: OWNER, subjectKind: "patient", subjectId: patientA,
    patientId: patientA, route: "/practice/patients/[id]",
  });
  await logAccess(admin, {
    workspaceId: wsA, actorId: OWNER, subjectKind: "encounter", subjectId: enc.data.id,
    patientId: patientA, route: "/practice/encounters/[id]",
  });
  await logAccess(admin, {
    workspaceId: wsA, actorId: OWNER, subjectKind: "document", subjectId: doc.data.id,
    patientId: patientA, route: "/practice/documents/[id]",
  });

  const history = await patientAccessHistory(admin, wsA, patientA);
  ok("THE PATIENT RECORD NOW ANSWERS 'WHO HAS OPENED THIS' -- it could not before CPR-370",
    history.entries.length === 3 && history.distinctActors === 1, `${history.entries.length} entries`);
  ok("...and each entry names the kind of thing that was opened",
    ["patient", "encounter", "document"].every(k => history.entries.some((e: any) => e.subject_kind === k)),
    history.entries.map((e: any) => e.subject_kind).join(","));

  // A SEARCH IS A READ ACROSS THE PRACTICE, and the term is the interesting part.
  await searchPractice(admin, a.ctx, "zebrina");
  const { data: searchEntries } = await admin.from("practice_access_log")
    .select("subject_kind, action, detail").eq("workspace_id", wsA).eq("subject_kind", "search");
  ok("A SEARCH IS LOGGED WITH ITS TERM ('who searched for this surname' is the question)",
    ((searchEntries ?? []) as any[]).length === 1 && (searchEntries as any[])[0].detail === "zebrina",
    JSON.stringify(searchEntries));

  await searchPractice(admin, a.ctx, "   ");
  const { count: afterEmpty } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("subject_kind", "search");
  ok("an empty search logs nothing (it never ran)", (afterEmpty ?? 0) === 1, `${afterEmpty}`);

  // ── 6. Export ─────────────────────────────────────────────────────────────
  const exported = await exportPatientRecord(admin, a.ctx, patientA, { correlationId: "harness-priv" });
  ok("a patient record exports", exported.ok, exported.ok ? "" : exported.message);
  if (!exported.ok) return report();
  const bundle = exported.data as any;

  ok("THE EXPORT SAYS WHAT IT IS, INSIDE ITSELF (a file that travels without provenance is one somebody mistakes for current)",
    bundle.export?.format === "competen-practice-patient-record" && !!bundle.export?.generatedAt &&
    /not a clinical document/i.test(bundle.export?.note ?? ""),
    JSON.stringify(bundle.export));
  ok("the export carries the clinical record, not a summary of it",
    bundle.encounters.length === 1 && bundle.encounterNotes.length === 1 &&
    bundle.documents.length === 1 && Array.isArray(bundle.encounterNoteVersions),
    JSON.stringify({ e: bundle.encounters.length, n: bundle.encounterNotes.length, d: bundle.documents.length }));

  const { data: exportEntries } = await admin.from("practice_access_log")
    .select("action, subject_kind, patient_id").eq("workspace_id", wsA).eq("action", "export");
  ok("AN EXPORT IS LOGGED AS THE LARGEST READ THERE IS",
    ((exportEntries ?? []) as any[]).length === 1 && (exportEntries as any[])[0].patient_id === patientA,
    JSON.stringify(exportEntries));
  const { data: exportAudit } = await admin.from("practice_audit_event")
    .select("event_type").eq("workspace_id", wsA).eq("event_type", "practice.patient_exported");
  ok("...and separately in the audit trail as a thing that was DONE (the two answer different questions)",
    ((exportAudit ?? []) as any[]).length === 1, JSON.stringify(exportAudit));

  const exportOther = await exportPatientRecord(admin, b.ctx, patientA, {});
  ok("a patient cannot be exported through another practice's context",
    !exportOther.ok && exportOther.code === "NOT_FOUND", exportOther.ok ? "was allowed" : exportOther.code);

  // ── 2. THE REVIEWER IS NOT THE BYPASS ─────────────────────────────────────
  const identified = await reviewAccess(admin, a.ctx, { correlationId: "harness-priv" });
  ok("a reviewer WITH clinical access sees the patient's name (control)",
    identified.identified === true && JSON.stringify(identified).includes(PATIENT_NAME),
    `identified=${identified.identified}`);

  const blinded = await withoutCapability(wsA, OWNER, "patient.view");
  const deidentified = await reviewAccess(admin, blinded, { correlationId: "harness-priv" });
  // ASSERTED OVER THE WHOLE SERIALISED RESPONSE, not over one field: a name leaking through any other
  // key -- a detail string, a nested row -- would be just as much a disclosure.
  ok("A REVIEWER WITHOUT CLINICAL ACCESS SEES NO PATIENT NAME ANYWHERE IN THE RESPONSE",
    deidentified.identified === false && !JSON.stringify(deidentified).includes(PATIENT_NAME),
    `identified=${deidentified.identified}`);
  ok("...but can still audit WHO LOOKED and how often (the control still works)",
    deidentified.byActor.length === 1 && deidentified.byActor[0].views > 0 &&
    deidentified.byActor[0].distinctPatients === 1,
    JSON.stringify(deidentified.byActor));
  ok("...and patients appear as stable references rather than blanks",
    deidentified.entries.some((e: any) => /^patient [0-9a-f]{8}$/.test(e.patient_label ?? "")),
    JSON.stringify(deidentified.entries.slice(0, 2).map((e: any) => e.patient_label)));
  await restoreCapability(wsA, OWNER, "patient.view");

  // ── 3. Reviewing is itself logged ─────────────────────────────────────────
  const { data: reviewEntries } = await admin.from("practice_access_log")
    .select("subject_kind, action").eq("workspace_id", wsA).eq("subject_kind", "access_review");
  ok("REVIEWING THE ACCESS LOG IS ITSELF LOGGED (the read a naive implementation forgets)",
    ((reviewEntries ?? []) as any[]).length === 2, `${((reviewEntries ?? []) as any[]).length} review entries`);

  // ── 4. Append-only, in the database ───────────────────────────────────────
  const { data: anyEntry } = await admin.from("practice_access_log")
    .select("id").eq("workspace_id", wsA).limit(1).single();
  const rewrite = await admin.from("practice_access_log").update({ action: "view" }).eq("id", anyEntry!.id);
  ok("THE DATABASE REFUSES TO REWRITE AN ACCESS ENTRY",
    !!rewrite.error && /append-only/i.test(rewrite.error.message), rewrite.error?.message ?? "the update succeeded");
  const wipe = await admin.from("practice_access_log").delete().eq("id", anyEntry!.id);
  ok("THE DATABASE REFUSES TO DELETE ONE TOO (a log somebody can prune reads as innocence)",
    !!wipe.error && /append-only/i.test(wipe.error.message), wipe.error?.message ?? "the delete succeeded");
  // CONTROL: inserting still works, so the trigger is not simply refusing everything on this table.
  const stillWrites = await admin.from("practice_access_log").insert({
    workspace_id: wsA, actor_id: OWNER, subject_kind: "patient", subject_id: patientA,
    patient_id: patientA, action: "view", route: "control",
  });
  ok("a fresh entry still inserts (the trigger is not refusing every write to the table)",
    !stillWrites.error, stillWrites.error?.message ?? "");

  // A BEFORE DELETE TRIGGER FIRES ON CASCADE DELETES TOO, and the first version of migration 202 did
  // not account for it: the trigger refused the workspace cascade, so a practice could never be deleted
  // at all. It surfaced the indirect way these things do -- cleanup stopped working and the next run
  // found duplicate patients from the previous one. Asserted directly now, on a throwaway workspace, so
  // it can never regress into somebody else's confusing failure.
  const scratch = await provision(OTHER, "HARNESS Privacy scratch (synthetic)", "scratch");
  await logAccess(admin, {
    workspaceId: scratch, actorId: OTHER, subjectKind: "patient", action: "view", route: "cascade-probe",
  });
  const { count: scratchRows } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", scratch);
  ok("the scratch workspace has access-log rows (the cascade test has a subject)", (scratchRows ?? 0) > 0, `${scratchRows}`);
  const cascade = await admin.from("practice_workspace").delete().eq("id", scratch);
  ok("A WORKSPACE WITH ACCESS-LOG ROWS CAN STILL BE DELETED (the trigger must not block the cascade)",
    !cascade.error, cascade.error?.message ?? "");
  const { count: afterCascade } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", scratch);
  ok("...and its entries went with it", (afterCascade ?? -1) === 0, `${afterCascade}`);

  // ── 5. Logging never blocks, and the gap is never silent ─────────────────
  const auditBefore = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("event_type", "practice.access_log_failed");
  // An invalid subject_kind fails the CHECK, which is the cheapest honest way to make the write fail.
  await logAccess(admin, {
    workspaceId: wsA, actorId: OWNER, subjectKind: "not_a_real_kind" as any, patientId: patientA,
    correlationId: "harness-priv",
  });
  ok("A FAILING LOG WRITE RETURNS NORMALLY (a doctor must never be blocked by the audit trail)", true);
  const { count: auditAfter } = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("event_type", "practice.access_log_failed");
  ok("...AND THE GAP IS RECORDED RATHER THAN SILENT",
    (auditAfter ?? 0) === ((auditBefore.count ?? 0) + 1), `${auditBefore.count} -> ${auditAfter}`);

  // ── The posture statement ─────────────────────────────────────────────────
  const posture = await privacyPosture(admin, a.ctx);
  ok("the posture counts real entries", posture.accessEntries > 0 && posture.patients === 1,
    JSON.stringify({ e: posture.accessEntries, p: posture.patients }));
  ok("it states what is NOT true as well as what is (the gaps are named, not implied)",
    posture.notYetTrue.length >= 3 && posture.notYetTrue.some(s => /retention/i.test(s)),
    `${posture.notYetTrue.length} gaps named`);
  ok("...and every guarantee is a property of the code rather than a promise about intent",
    posture.guarantees.length >= 5 && posture.guarantees.some(s => /append-only/i.test(s)),
    `${posture.guarantees.length} guarantees`);

  // ── 7. Isolation + anon ───────────────────────────────────────────────────
  const bReview = await reviewAccess(admin, b.ctx, {});
  ok("B's access review holds none of A's reads",
    bReview.entries.every((e: any) => e.patient_id !== patientA), `${bReview.entries.length} entries`);
  const aReview = await reviewAccess(admin, a.ctx, {});
  ok("A's review is non-empty (the isolation test is not vacuous)", aReview.entries.length > 5, `${aReview.entries.length}`);
  ok("B cannot read A's patient access history through its own workspace",
    (await patientAccessHistory(admin, wsB, patientA)).entries.length === 0);

  const { count: svc } = await admin.from("practice_access_log").select("*", { count: "exact", head: true });
  const { count: leaked } = await anon.from("practice_access_log").select("*", { count: "exact", head: true });
  ok("the service role sees access-log rows (the denial test is not vacuous)", (svc ?? 0) > 0, `${svc}`);
  ok("anon reads 0 rows from the access log", (leaked ?? 0) === 0, `${leaked}`);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
