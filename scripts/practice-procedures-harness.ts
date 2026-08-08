/**
 * Practice procedure harness -- CPR-150, exercised against the live database through the same engine
 * the API uses.
 *
 * WHAT IT PROVES:
 *   1. THE TWO SAFETY REFUSALS, which are the reason this module is not a text field.
 *      LATERALITY: a catalogue entry marked sided cannot be recorded without a side, and
 *      `not_applicable` is refused too -- it is exactly what somebody picks to get past a required
 *      field. CONSENT: where the catalogue requires it, `not_recorded` is refused, while `refused` is
 *      accepted, because a patient declining is a real event the record should be able to state.
 *      Both are paired with an unsided, no-consent procedure recorded in the same workspace, so a green
 *      "refused" cannot be an artefact of recordProcedure being broken.
 *   2. THE LABEL IS WRITTEN DOWN, NOT JOINED. Retiring or renaming the catalogue entry afterwards does
 *      not rewrite what a past procedure says it was.
 *   3. AN OUTCOME IS LEARNED LATER, AND THE SIGNED ENCOUNTER STAYS SIGNED. A complication recorded
 *      weeks after the fact attaches to the procedure and to the encounter that NOTICED it, while the
 *      encounter that performed it remains locked and unchanged -- the situation the whole table exists
 *      for. Severity is required for a complication and refused for anything else, both directions.
 *   4. An outcome cannot be rewritten, even by a raw statement that bypasses the engine (197 s5).
 *   5. INTENTION AND ACT STAY APART. A treatment row is not evidence a procedure happened; a procedure
 *      may link to the plan it carried out, and only to a plan on its own encounter.
 *   6. Clinical activity counts real rows and reports a denominator rather than a rate.
 *   7. Workspace isolation non-vacuously; anon reads 0 rows from all three tables.
 *
 *   npx --yes tsx scripts/practice-procedures-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter, recordTreatment } from "../src/lib/practice/encounters";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  listProcedureTypes, createProcedureType, setProcedureTypeStatus,
  recordProcedure, recordProcedureOutcome, listProcedures, procedureActivity, getProcedure,
} from "../src/lib/practice/procedures";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e1061";
const USER_B = "00000000-0000-4000-8000-0000000e1062";

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
    idempotency_key: `harness-proc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-proc",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-proc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-proc" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice procedure harness (CPR-150, migration 197)\n");
  await cleanup();

  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  ok("the function registry probe returns rows (the trigger check is not vacuous)", fns.length > 0,
    reg.error?.message ?? `${fns.length} functions`);
  ok("practice_procedure_outcome_immutable() is deployed (migration 197 s5)",
    fns.some(f => f.fn_name === "practice_procedure_outcome_immutable"),
    "NOT FOUND -- recorded outcomes are rewritable by anything that bypasses the engine");

  const wsA = await provision(USER_A, "HARNESS Procedure A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Procedure B (synthetic)", "b");

  const catalogue = await listProcedureTypes(admin, wsA);
  ok("the supplied procedure catalogue is seeded and visible (migration 197 s4)",
    catalogue.length >= 10 && catalogue.every(t => t.scope === "platform"),
    `${catalogue.length} entries`);

  const sided = catalogue.find(t => t.code === "abscess_incision");
  const unsided = catalogue.find(t => t.code === "wound_dressing");
  const consentOnly = catalogue.find(t => t.code === "urinary_catheter");
  ok("the catalogue carries the flags that do the work (sided, consent_required)",
    sided?.sided === true && sided?.consent_required === true &&
    unsided?.sided === false && unsided?.consent_required === false &&
    consentOnly?.sided === false && consentOnly?.consent_required === true,
    JSON.stringify({ sided: sided?.sided, unsided: unsided?.sided, consentOnly: consentOnly?.consent_required }));
  if (!sided || !unsided || !consentOnly) return report();

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Wamala Joseph", birthDate: "1984-11-02", sex: "male",
    phone: "0772 555 440", ...base,
  });
  if (!pa.ok) { ok("patient registration for the harness succeeded", false, pa.message); return report(); }
  const patientA = pa.data.id;

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "new_walk_in", reasonForVisit: "painful lump in the axilla", ...base,
  });
  if (!enc.ok) { ok("encounter launch for the harness succeeded", false, enc.message); return report(); }
  const encId = enc.data.id;
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "ACTIVE", ...base });

  // ── 1. THE TWO SAFETY REFUSALS ────────────────────────────────────────────
  const noSide = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: sided.id, consentStatus: "obtained", ...base,
  });
  ok("a SIDED procedure is REFUSED without a side (wrong-site is the never-event)",
    !noSide.ok && noSide.code === "LATERALITY_REQUIRED", noSide.ok ? "was allowed" : noSide.code);

  const naSide = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: sided.id,
    laterality: "not_applicable", consentStatus: "obtained", ...base,
  });
  ok("'not applicable' is refused on a sided procedure too (it is the get-past-the-field answer)",
    !naSide.ok && naSide.code === "LATERALITY_REQUIRED", naSide.ok ? "was allowed" : naSide.code);

  const noConsent = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: consentOnly.id, ...base,
  });
  ok("a CONSENT-REQUIRED procedure is refused while consent reads 'not recorded'",
    !noConsent.ok && noConsent.code === "CONSENT_REQUIRED", noConsent.ok ? "was allowed" : noConsent.code);

  const refusedConsent = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: consentOnly.id, consentStatus: "refused",
    consentNote: "patient declined after discussion", ...base,
  });
  ok("consent REFUSED is accepted (a patient declining is a real recordable event, not a blocker)",
    refusedConsent.ok, refusedConsent.ok ? "" : refusedConsent.message);

  // CONTROL for all three refusals: a procedure needing neither flag records with nothing extra.
  const dressing = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: unsided.id, ...base,
  });
  ok("an unsided, no-consent procedure records with nothing extra (control)", dressing.ok, dressing.ok ? "" : dressing.message);

  const abscess = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: sided.id, laterality: "left",
    site: "left axilla", indication: "fluctuant abscess", consentStatus: "obtained",
    anaesthesia: "1% lignocaine local", immediateOutcome: "20ml pus drained, cavity packed", ...base,
  });
  ok("the sided procedure records once a side is given (control for the laterality refusals)",
    abscess.ok, abscess.ok ? "" : abscess.message);
  if (!abscess.ok || !dressing.ok) return report();

  const abandoned = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, label: "Attempted lumbar puncture", status: "ABANDONED", ...base,
  });
  ok("an abandoned procedure needs a reason (something happened to the patient either way)",
    !abandoned.ok && abandoned.code === "VALIDATION_ERROR", abandoned.ok ? "was allowed" : abandoned.code);
  const abandonedOk = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, label: "Attempted lumbar puncture",
    status: "ABANDONED", abandonedReason: "patient could not tolerate positioning", ...base,
  });
  ok("an abandoned procedure records WITH a reason (control)", abandonedOk.ok, abandonedOk.ok ? "" : abandonedOk.message);

  const unpublished = await createProcedureType(admin, {
    workspaceId: wsA, code: "practice_special", name: "Practice-specific thing", sided: true, ...base,
  });
  ok("a workspace can add its own catalogue entry", unpublished.ok, unpublished.ok ? "" : unpublished.message);
  const useUnpublished = unpublished.ok ? await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: unpublished.data.id, laterality: "right", ...base,
  }) : null;
  ok("an UNPUBLISHED catalogue entry cannot be used on a patient",
    !!useUnpublished && !useUnpublished.ok && useUnpublished.code === "PROCEDURE_NOT_PUBLISHED",
    useUnpublished?.ok ? "was allowed" : useUnpublished?.code ?? "setup failed");

  const platformWrite = await setProcedureTypeStatus(admin, { workspaceId: wsA, procedureTypeId: sided.id, status: "retired", ...base });
  ok("a workspace may not retire a supplied catalogue entry",
    !platformWrite.ok && platformWrite.code === "PLATFORM_PROCEDURE", platformWrite.ok ? "was allowed" : platformWrite.code);

  // ── 2. The label is written down, not joined ──────────────────────────────
  if (unpublished.ok) {
    await setProcedureTypeStatus(admin, { workspaceId: wsA, procedureTypeId: unpublished.data.id, status: "published", ...base });
    const used = await recordProcedure(admin, {
      workspaceId: wsA, encounterId: encId, procedureTypeId: unpublished.data.id, laterality: "right", ...base,
    });
    ok("a published workspace entry can then be used (control)", used.ok, used.ok ? "" : used.message);

    await admin.from("practice_procedure_type").update({ name: "RENAMED AFTER THE FACT" }).eq("id", unpublished.data.id);
    const after = used.ok ? await getProcedure(admin, wsA, used.data.id) : null;
    ok("RENAMING THE CATALOGUE DOES NOT REWRITE HISTORY (the label was written down, not joined)",
      after?.procedure.label === "Practice-specific thing", String(after?.procedure.label));
    ok("the catalogue entry itself does show the new name (the check above is not just a stale read)",
      after?.type?.name === "RENAMED AFTER THE FACT", String(after?.type?.name));
  }

  // ── 5. Intention and act stay apart ───────────────────────────────────────
  const plan = await recordTreatment(admin, {
    workspaceId: wsA, encounterId: encId, treatmentType: "procedure", label: "Excision of lipoma", ...base,
  });
  ok("a treatment can plan a procedure", plan.ok, plan.ok ? "" : plan.message);
  const { count: procCount } = await admin.from("practice_procedure")
    .select("*", { count: "exact", head: true }).eq("encounter_id", encId).eq("label", "Excision of lipoma");
  ok("PLANNING ONE CREATES NO PROCEDURE ROW (a plan is not evidence anything happened)",
    (procCount ?? 0) === 0, `${procCount}`);

  const enc2 = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "new_walk_in", ...base,
  });
  // Resume-before-create returns the live encounter, so this is the same one -- which is what makes the
  // mismatch test below need a genuinely different encounter. Build it on the second patient instead.
  const pOther = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Namulondo Ruth", birthDate: "1990-05-19", sex: "female", phone: "0772 555 441", ...base,
  });
  ok("the second launch resumed rather than duplicated (as PEN-003 requires)",
    enc2.ok && enc2.data.resumed === true, enc2.ok ? String(enc2.data.resumed) : enc2.message);

  const otherEnc = pOther.ok
    ? await launchEncounter(admin, { workspaceId: wsA, patientId: pOther.data.id, pathway: "new_walk_in", ...base })
    : null;
  if (otherEnc?.ok) {
    await transitionEncounter(admin, { workspaceId: wsA, encounterId: otherEnc.data.id, to: "ACTIVE", ...base });
    const crossPlan = plan.ok ? await recordProcedure(admin, {
      workspaceId: wsA, encounterId: otherEnc.data.id, label: "Excision of lipoma",
      treatmentId: plan.data.id, ...base,
    }) : null;
    ok("a procedure may not be linked to another encounter's plan",
      !!crossPlan && !crossPlan.ok && crossPlan.code === "TREATMENT_ENCOUNTER_MISMATCH",
      crossPlan?.ok ? "was allowed" : crossPlan?.code ?? "setup failed");
  } else {
    ok("a procedure may not be linked to another encounter's plan", false, "setup failed");
  }

  const carriedOut = plan.ok ? await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, label: "Excision of lipoma", treatmentId: plan.data.id,
    consentStatus: "obtained", ...base,
  }) : null;
  ok("a procedure CAN carry out a plan on its own encounter (control)",
    !!carriedOut && carriedOut.ok, carriedOut?.ok ? "" : carriedOut?.message ?? "setup failed");

  // ── 3. An outcome is learned later, and the signed encounter stays signed ──
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "COMPLETED", ...base });
  const signed = await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "SIGNED", ...base });
  ok("the encounter that performed the procedures signs", signed.ok, signed.ok ? "" : signed.message);

  const editSigned = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: unsided.id, ...base,
  });
  ok("no further procedure can be added to a signed encounter",
    !editSigned.ok && editSigned.code === "ENCOUNTER_LOCKED", editSigned.ok ? "was allowed" : editSigned.code);

  // Weeks later: a new consultation notices a complication of the abscess drainage.
  const laterEnc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "walk_in_followup", reasonForVisit: "wound discharging", ...base,
  });
  if (!laterEnc.ok) { ok("a later encounter opens for the same patient", false, laterEnc.message); return report(); }
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: laterEnc.data.id, to: "ACTIVE", ...base });

  const noSeverity = await recordProcedureOutcome(admin, {
    workspaceId: wsA, procedureId: abscess.data.id, observedAtEncounterId: laterEnc.data.id,
    outcomeType: "complication", detail: "cavity re-accumulated", ...base,
  });
  ok("a complication with no severity is refused", !noSeverity.ok && noSeverity.code === "SEVERITY_REQUIRED",
    noSeverity.ok ? "was allowed" : noSeverity.code);

  const wrongSeverity = await recordProcedureOutcome(admin, {
    workspaceId: wsA, procedureId: abscess.data.id, observedAtEncounterId: laterEnc.data.id,
    outcomeType: "healing", severity: "severe", detail: "closing well", ...base,
  });
  ok("severity on a NON-complication is refused (it is enforced both ways)",
    !wrongSeverity.ok && wrongSeverity.code === "SEVERITY_NOT_APPLICABLE",
    wrongSeverity.ok ? "was allowed" : wrongSeverity.code);

  const complication = await recordProcedureOutcome(admin, {
    workspaceId: wsA, procedureId: abscess.data.id, observedAtEncounterId: laterEnc.data.id,
    outcomeType: "complication", severity: "moderate",
    detail: "wound infection, cavity re-accumulated; re-drained and started on antibiotics", ...base,
  });
  ok("A COMPLICATION IS RECORDED WEEKS LATER, AGAINST A PROCEDURE IN A SIGNED ENCOUNTER (control)",
    complication.ok, complication.ok ? "" : complication.message);

  const { data: signedEnc } = await admin.from("practice_encounter").select("status").eq("id", encId).single();
  ok("and the signed encounter is STILL SIGNED and untouched", signedEnc?.status === "SIGNED", String(signedEnc?.status));

  const detail = await getProcedure(admin, wsA, abscess.data.id);
  ok("the outcome names the encounter that NOTICED it, not the one that performed it",
    (detail?.outcomes ?? []).some((o: any) => o.observed_at_encounter_id === laterEnc.data.id),
    JSON.stringify((detail?.outcomes ?? []).map((o: any) => o.observed_at_encounter_id)));
  ok("the original procedure record is unchanged",
    detail?.procedure.encounter_id === encId && detail?.procedure.laterality === "left",
    JSON.stringify({ enc: detail?.procedure.encounter_id === encId, lat: detail?.procedure.laterality }));

  const wrongPatientOutcome = otherEnc?.ok ? await recordProcedureOutcome(admin, {
    workspaceId: wsA, procedureId: abscess.data.id, observedAtEncounterId: otherEnc.data.id,
    outcomeType: "note", detail: "x", ...base,
  }) : null;
  ok("an outcome cannot be observed at another patient's encounter",
    !!wrongPatientOutcome && !wrongPatientOutcome.ok && wrongPatientOutcome.code === "ENCOUNTER_PATIENT_MISMATCH",
    wrongPatientOutcome?.ok ? "was allowed" : wrongPatientOutcome?.code ?? "setup failed");

  // ── 4. Outcomes are immutable ─────────────────────────────────────────────
  const rewrite = await admin.from("practice_procedure_outcome")
    .update({ detail: "actually it was fine" }).eq("id", complication.ok ? complication.data.id : "");
  ok("the DATABASE refuses to rewrite an outcome (migration 197 s5 trigger)",
    !!rewrite.error, rewrite.error?.message ?? "the update succeeded");

  const listed = await listProcedures(admin, wsA, { patientId: patientA });
  ok("a procedure with a complication is flagged as such for a reader",
    listed.find((p: any) => p.id === abscess.data.id)?.hasComplication === true,
    JSON.stringify(listed.map((p: any) => ({ l: p.label, c: p.hasComplication }))));

  // ── 6. Clinical activity ──────────────────────────────────────────────────
  const activity = await procedureActivity(admin, wsA);
  ok("activity counts real rows", activity.total === listed.length, `${activity.total} vs ${listed.length}`);
  ok("activity separates performed from abandoned",
    activity.byLabel.some(l => l.label === "Attempted lumbar puncture" && l.abandoned === 1 && l.performed === 0),
    JSON.stringify(activity.byLabel.map(l => [l.label, l.performed, l.abandoned])));
  ok("activity reports complications as a COUNT AND A DENOMINATOR, never as a rate",
    activity.complications === 1 && activity.complicationsOf === activity.total &&
    !Object.prototype.hasOwnProperty.call(activity, "complicationRate"),
    JSON.stringify({ c: activity.complications, of: activity.complicationsOf }));
  ok("activity surfaces how many procedures have no consent recorded",
    activity.consentNotRecorded >= 1, `${activity.consentNotRecorded}`);

  // ── 7. Isolation + anon ───────────────────────────────────────────────────
  ok("getProcedure is workspace-scoped (B cannot read A's procedure)",
    (await getProcedure(admin, wsB, abscess.data.id)) === null);
  const bOutcome = await recordProcedureOutcome(admin, {
    workspaceId: wsB, procedureId: abscess.data.id, outcomeType: "note", detail: "x", ...base,
  });
  ok("B cannot append an outcome to A's procedure", !bOutcome.ok && bOutcome.code === "NOT_FOUND",
    bOutcome.ok ? "was allowed" : bOutcome.code);
  ok("A's procedure list is non-empty (the isolation test is not vacuous)", listed.length >= 4, `${listed.length}`);
  ok("B's procedure list is empty", (await listProcedures(admin, wsB, {})).length === 0);

  const TABLES = ["practice_procedure_type", "practice_procedure", "practice_procedure_outcome"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in every procedure table (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("anon reads 0 rows from every procedure table", leaked === 0, `${leaked} table(s) leaked`);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
