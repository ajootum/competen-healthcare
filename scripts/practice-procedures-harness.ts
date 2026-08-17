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
import { procedureFieldPlan, procedureReadiness } from "../src/lib/practice/procedure-constants";
import {
  listProcedureTypes, createProcedureType, setProcedureTypeStatus,
  recordProcedure, recordProcedureOutcome, listProcedures, procedureActivity, getProcedure,
  configureProcedureType, setProcedureActivation,
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
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
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
  // ⚠ THE UNRESTRICTED CONTROL MOVED OFF wound_dressing, AND THE MOVE IS THE FINDING. Migration 297
  // seeds site_rule = required on the four wound and skin procedures, so "records with nothing extra" is
  // no longer true of a dressing -- it needs the site. im_injection carries no rule at all, which is
  // what this control has always been for. wound_dressing becomes the fixture for the site rule below.
  const unsided = catalogue.find(t => t.code === "im_injection");
  const siteRequired = catalogue.find(t => t.code === "wound_dressing");
  const consentOnly = catalogue.find(t => t.code === "urinary_catheter");
  ok("the catalogue carries the flags that do the work (sided, consent_required)",
    sided?.sided === true && sided?.consent_required === true &&
    unsided?.sided === false && unsided?.consent_required === false &&
    consentOnly?.sided === false && consentOnly?.consent_required === true,
    JSON.stringify({ sided: sided?.sided, unsided: unsided?.sided, consentOnly: consentOnly?.consent_required }));
  if (!sided || !unsided || !consentOnly || !siteRequired) return report();

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

  // ── 1b. THE SCREEN'S READINESS RULES AGREE WITH THE SERVER, CHECKED AGAINST THE SERVER ───────────
  //
  // ⚠ CPR-PROC-HFE-005 s21 REQUIRES THE SCREEN TO PRE-EMPT THESE REFUSALS ("make the wrong action
  // difficult or impossible; do not depend on clinicians repeatedly reading warnings"), and the moment a
  // screen decides anything a procedure engine also decides, there are two rulebooks for one clinical
  // act. The sided-laterality rule is the one where a second opinion is a wrong-site record.
  //
  // ⚠ SO THE MIRROR IS NOT TESTED AGAINST ITSELF. Every verdict below is paired with the LIVE result of
  // the same input through recordProcedure, a few lines above. A hand-written expectation would go green
  // against a client rule and a server rule that had drifted apart together.
  //
  // ⚠ AND THE TWO DIRECTIONS OF DISAGREEMENT ARE NOT EQUALLY SURVIVABLE. Client says ready, server
  // refuses: the refusal still arrives, by name, per item -- annoying and self-correcting. Client says
  // NOT ready when the server would have accepted: the practitioner is blocked with a patient in front
  // of them and no way through. That asymmetry is why every check in procedureReadiness is a copy of one
  // in procedures.ts and none is an invention.
  const draft = (over: Partial<Parameters<typeof procedureReadiness>[0]> = {}) => ({
    label: "probe", site: "", laterality: "not_applicable", consentStatus: "not_recorded",
    status: "PERFORMED", abandonedReason: "", scheduledAt: "", ...over,
  });
  // ⚠ THE SHAPES ARE READ OFF THE CATALOGUE, NOT HAND-WRITTEN. `abscess_incision` is sided AND
  // consent-required; a hand-typed `{ sided: true, consent_required: false }` would have been a test of
  // my own literal rather than of the row the server consults, and would have gone green while
  // disagreeing with the live entry.
  // ⚠ THE WHOLE ROW, NOT FOUR COPIED FIELDS -- AND THE FIRST VERSION COPIED FOUR. It predated migration
  // 297 and kept only id, name, sided and consent_required, so the mirror was handed a procedure with
  // no allowed_lateralities and cheerfully called a bilateral abscess incision ready while the server
  // refused it. 297-3b is the assertion that found it. A shape helper that picks fields is the same
  // defect as a select that omits columns, one layer up.
  const shapeOf = (t: typeof sided) => t as any;
  const sidedShape = shapeOf(sided);
  const consentShape = shapeOf(consentOnly);
  const unsidedShape = shapeOf(unsided);

  // The draft mirrors `noSide` exactly -- consent obtained, so only the missing side can be at fault.
  ok("mirror-1. a sided procedure with no side is NOT ready -- and the server refused exactly that",
    procedureReadiness(draft({ consentStatus: "obtained" }), sidedShape).ready === false
      && noSide.ok === false,
    JSON.stringify(procedureReadiness(draft({ consentStatus: "obtained" }), sidedShape)));
  // ⚠ THE DRAFT CARRIES THE SITE BECAUSE `abscess` DID. Once the mirror was handed the WHOLE catalogue
  // row it started seeing site_rule = 'required' and correctly refused a draft with no site -- while
  // this assertion was still comparing it to a server call that HAD one. A mirror fed different inputs
  // than the server is not a mirror; it is two tests of two different things sharing one name.
  const readySided = draft({ laterality: "left", site: "left axilla", consentStatus: "obtained" });
  ok("mirror-2. with a side and a site it IS ready -- and the server accepted exactly that (control)",
    procedureReadiness(readySided, sidedShape).ready === true && abscess.ok === true,
    JSON.stringify(procedureReadiness(readySided, sidedShape)));
  ok("mirror-3. consent-required with 'not recorded' is NOT ready -- and the server refused it",
    procedureReadiness(draft(), consentShape).ready === false && noConsent.ok === false,
    JSON.stringify(procedureReadiness(draft(), consentShape)));
  // ⚠ THE ONE THAT WOULD BLOCK A LEGITIMATE RECORD IF IT DRIFTED. `refused` is a real recordable event
  // and the server accepts it; a client that treated consent as a yes/no would stop it being recorded.
  ok("mirror-4. consent REFUSED is ready -- and the server accepted it (a patient declining is real)",
    procedureReadiness(draft({ consentStatus: "refused" }), consentShape).ready === true
      && refusedConsent.ok === true,
    JSON.stringify(procedureReadiness(draft({ consentStatus: "refused" }), consentShape)));
  ok("mirror-5. an unsided, no-consent procedure is ready with nothing extra -- as the server agreed",
    procedureReadiness(draft(), unsidedShape).ready === true && dressing.ok === true);

  // s9/s22: EEG and endotracheal intubation must not display laterality at all.
  ok("plan-1. s9: Side is HIDDEN on a procedure the catalogue says has no sides",
    procedureFieldPlan(unsidedShape).side === "hidden"
      && procedureFieldPlan(sidedShape).side === "required");
  // ⚠ AND FREE TEXT IS NOT A STATEMENT THAT A PROCEDURE HAS NO SIDES. Hiding the control on an
  // unrecognised name would silently drop laterality from anything not yet in the catalogue -- a capture
  // loss dressed as a simplification, and on a sided procedure a wrong-site record.
  const freeText = procedureFieldPlan(null);
  ok("plan-2. a procedure typed in by hand hides nothing and demands nothing",
    freeText.governed === false && freeText.side === "optional" && freeText.consent === "optional"
      && procedureReadiness(draft(), null).ready === true,
    JSON.stringify(freeText));

  // ── 1c. MIGRATION 297: APPLICABILITY DRIVEN BY THE DEFINITION ───────────────────────────────────
  //
  // ⚠ THE BACKFILL IS ASSERTED AGAINST THE LIVE ROWS, NOT ASSUMED. 297 is hand-applied once with no
  // rollback, and every rule below rests on it having mapped the two old booleans onto the tri-states
  // the way its header says. If the file was applied to a database whose catalogue had drifted, this is
  // the assertion that says so rather than the wrong-site check quietly weakening.
  ok("297-1. the backfill maps sided and consent_required onto the tri-states, on the LIVE rows",
    sided.laterality_rule === "required" && sided.consent_rule === "required"
      && unsided.laterality_rule === "not_applicable" && unsided.consent_rule === "optional"
      && consentOnly.laterality_rule === "not_applicable" && consentOnly.consent_rule === "required",
    JSON.stringify({ sided: sided.laterality_rule, unsided: unsided.laterality_rule, consent: consentOnly.consent_rule }));

  // s9's configured choices. abscess_incision is seeded left/right -- bilateral is a valid laterality
  // everywhere else and must be refused HERE, which is the whole point of a per-procedure list.
  ok("297-2. the seeded restriction is on the live row (the refusal below is not vacuous)",
    Array.isArray(sided.allowed_lateralities) && sided.allowed_lateralities.join(",") === "left,right",
    JSON.stringify(sided.allowed_lateralities));
  const bilateral = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, procedureTypeId: sided.id,
    laterality: "bilateral", site: "left axilla", consentStatus: "obtained", ...base,
  });
  ok("297-3. s9: a laterality outside the configured list is REFUSED",
    !bilateral.ok && bilateral.code === "LATERALITY_NOT_ALLOWED",
    bilateral.ok ? "was allowed" : `${bilateral.code}: ${bilateral.message}`);
  ok("297-3b. and the screen would not have offered it either (the mirror agrees)",
    procedureReadiness(draft({ laterality: "bilateral", site: "x", consentStatus: "obtained" }), shapeOf(sided)).ready === false);

  // ── s9's SITE RULE, PROVED AGAINST A FIXTURE THIS HARNESS BUILDS ITSELF ─────────────────────────
  //
  // ⚠ THIS USED TO LEAN ON THE SEEDED PLATFORM ROWS AND THAT WAS THE WRONG PLACE TO STAND. Migration
  // 297 shipped site_rule = 'required' on the four wound and skin procedures; the owner ruled it back
  // to 'optional' in 298, and these three assertions would have gone quietly vacuous -- still green,
  // proving nothing, because no row in the catalogue would demand a site any more.
  //
  // A seed is a product decision and it can change tomorrow. THE RULE is what this harness is for. So
  // the fixture is built here, switched on here, and torn down with the workspace -- and 298 relaxing
  // the platform rows now leaves it completely unmoved. 298-1 below asserts the relaxation itself,
  // separately, which is the honest way to test a decision that could be reversed again.
  const siteType = await createProcedureType(admin, {
    workspaceId: wsA, code: "site_required_probe", name: "Site required probe", ...base,
  });
  if (siteType.ok) {
    await setProcedureTypeStatus(admin, { workspaceId: wsA, procedureTypeId: siteType.data.id, status: "published", ...base });
    await admin.from("practice_procedure_type").update({ site_rule: "required" }).eq("id", siteType.data.id);
    const { data: siteRow } = await admin.from("practice_procedure_type")
      .select("id, site_rule").eq("id", siteType.data.id).maybeSingle();
    ok("297-4. the fixture really carries site_rule = required (the refusals below are not vacuous)",
      siteRow?.site_rule === "required", JSON.stringify(siteRow));

    const noSite = await recordProcedure(admin, {
      workspaceId: wsA, encounterId: encId, procedureTypeId: siteType.data.id, ...base,
    });
    ok("297-5. s9: a required SITE is refused when missing",
      !noSite.ok && noSite.code === "SITE_REQUIRED", noSite.ok ? "was allowed" : noSite.code);
    // ⚠ AND A BLANK STRING IS NOT A SITE. Migration 256's scar: `is not null` does not stop "   ".
    const blankSite = await recordProcedure(admin, {
      workspaceId: wsA, encounterId: encId, procedureTypeId: siteType.data.id, site: "   ", ...base,
    });
    ok("297-5b. a site of whitespace is refused too (a blank string is not null)",
      !blankSite.ok && blankSite.code === "SITE_REQUIRED", blankSite.ok ? "was allowed" : blankSite.code);
    // CONTROL. Without it the two refusals above pass just as well if this type refused everything.
    const withSite = await recordProcedure(admin, {
      workspaceId: wsA, encounterId: encId, procedureTypeId: siteType.data.id, site: "left forearm", ...base,
    });
    ok("297-5c. and it records once a site is given (control)", withSite.ok, withSite.ok ? "" : withSite.message);
    ok("297-5d. the screen mirrors the site rule from the same row",
      procedureFieldPlan(siteRow as any).site === "required"
        && procedureReadiness(draft(), siteRow as any).ready === false
        && procedureReadiness(draft({ site: "left forearm" }), siteRow as any).ready === true);
  } else {
    ok("297-4. the fixture really carries site_rule = required (the refusals below are not vacuous)",
      false, siteType.message);
  }

  // ── 298: THE OWNER RELAXED THE SEEDED SITE REQUIREMENT ──────────────────────────────────────────
  //
  // ⚠ ASSERTED BECAUSE IT IS A DECISION, NOT A DEFAULT. 297 shipped these four as `required` -- my
  // judgement, imposed on every practice as a hard block on a screen used with a patient in the room,
  // in a migration whose stated purpose was to make applicability CONFIGURABLE. The owner ruled it
  // back. This assertion is what stops it drifting back in unnoticed, and it names the four rows so a
  // future seed cannot re-tighten one of them quietly.
  ok("298-1. the four seeded wound and skin procedures do NOT demand a site",
    [sided, siteRequired].every(t => t.site_rule === "optional"),
    JSON.stringify({ abscess: sided.site_rule, dressing: siteRequired.site_rule }));
  const { data: stillRequired } = await admin.from("practice_procedure_type")
    .select("code").is("workspace_id", null).eq("site_rule", "required");
  ok("298-1b. and no supplied procedure anywhere demands one",
    (stillRequired ?? []).length === 0,
    JSON.stringify((stillRequired ?? []).map((r: any) => r.code)));

  // ⚠ THE STRICTER-OF-TWO RULE, WHICH IS THE SAFETY DECISION IN THIS WHOLE MIGRATION. A practice-owned
  // entry with sided = true and laterality_rule left at its default proves the OR: the boolean alone
  // still refuses. If this ever goes green because the tri-state was consulted instead, the wrong-site
  // check has become one mis-set column away from silence.
  const legacyShaped = await createProcedureType(admin, {
    workspaceId: wsA, code: "legacy_sided_probe", name: "Legacy sided probe", sided: true, ...base,
  });
  if (legacyShaped.ok) {
    await setProcedureTypeStatus(admin, { workspaceId: wsA, procedureTypeId: legacyShaped.data.id, status: "published", ...base });
    const { data: legacyRow } = await admin.from("practice_procedure_type")
      .select("id, name, sided, laterality_rule").eq("id", legacyShaped.data.id).maybeSingle();
    ok("297-6. a new entry created with sided=true has laterality_rule at its DEFAULT, not 'required'",
      legacyRow?.sided === true && legacyRow?.laterality_rule === "not_applicable",
      JSON.stringify(legacyRow));
    const legacyNoSide = await recordProcedure(admin, {
      workspaceId: wsA, encounterId: encId, procedureTypeId: legacyShaped.data.id, ...base,
    });
    ok("297-7. ⚠ THE BOOLEAN ALONE STILL REFUSES -- the check is an OR, so a stale column cannot silence it",
      !legacyNoSide.ok && legacyNoSide.code === "LATERALITY_REQUIRED",
      legacyNoSide.ok ? "was allowed" : legacyNoSide.code);
    ok("297-7b. and the screen mirrors that, from the same disagreeing row",
      procedureFieldPlan(legacyRow as any).side === "required", JSON.stringify(legacyRow));
  } else {
    ok("297-6. a new entry created with sided=true has laterality_rule at its DEFAULT, not 'required'", false, legacyShaped.message);
  }

  // ⚠ ATTEMPTED, NOT ABANDONED, AND THIS PAIR WAS STALE AND HALF-GREEN. Migration 294 renamed the
  // status and procedure-constants.ts stopped offering ABANDONED, so recordProcedure refuses it by name
  // as "ABANDONED is not a procedure status". The FIRST assertion below kept passing anyway -- it only
  // checked for VALIDATION_ERROR, and got one for a completely different reason than the missing reason
  // it was written to prove. A control that passes for the wrong reason is worse than one that fails.
  const attempted = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, label: "Attempted lumbar puncture", status: "ATTEMPTED", ...base,
  });
  ok("an attempted procedure needs a reason (something happened to the patient either way)",
    !attempted.ok && attempted.code === "VALIDATION_ERROR" && /say why/.test(attempted.message),
    attempted.ok ? "was allowed" : `${attempted.code}: ${attempted.message}`);
  const attemptedOk = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, label: "Attempted lumbar puncture",
    status: "ATTEMPTED", abandonedReason: "patient could not tolerate positioning", ...base,
  });
  ok("an attempted procedure records WITH a reason (control)", attemptedOk.ok, attemptedOk.ok ? "" : attemptedOk.message);

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
  ok("activity separates performed from attempted-not-completed",
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


  // ══ 22. THE 297 SETTINGS WRITERS (2026-08-16) -- the screen the migration shipped without ═══════
  const cfgType = await createProcedureType(admin, {
    workspaceId: wsA, code: "harness_cfg", name: "Harness configurable", ...base,
  });
  if (!cfgType.ok) { ok("22-0 fixture type creates", false, (cfgType as any).message); return report(); }
  const cfg = await configureProcedureType(admin, {
    workspaceId: wsA, procedureTypeId: cfgType.data.id,
    siteRule: "required", lateralityRule: "required", allowedLateralities: ["left", "right"],
    outcomeRequired: true, ...base,
  });
  ok("22-1 a workspace-owned type takes the s20 rules", cfg.ok, JSON.stringify(cfg));
  const cfgList = await listProcedureTypes(admin, wsA, { includeUnpublished: true });
  const cfgRow = cfgList.find((t: any) => t.id === cfgType.data.id);
  ok("22-2 and every reader sees them -- the same columns recordProcedure enforces",
    cfgRow?.site_rule === "required" && cfgRow?.laterality_rule === "required"
      && JSON.stringify(cfgRow?.allowed_lateralities) === '["left","right"]' && cfgRow?.outcome_required === true,
    JSON.stringify(cfgRow ? { s: cfgRow.site_rule, l: cfgRow.laterality_rule, a: cfgRow.allowed_lateralities } : null));
  const platformRow = cfgList.find((t: any) => t.scope === "platform");
  const cfgPlatform = await configureProcedureType(admin, {
    workspaceId: wsA, procedureTypeId: platformRow.id, siteRule: "required", ...base,
  });
  ok("22-3 ⚠ a SUPPLIED procedure's rules are read-only -- refused BY NAME",
    !cfgPlatform.ok && cfgPlatform.code === "PLATFORM_PROCEDURE");
  const badDefault = await configureProcedureType(admin, {
    workspaceId: wsA, procedureTypeId: cfgType.data.id,
    allowedStatuses: ["PERFORMED"], defaultStatus: "CANCELLED", ...base,
  });
  ok("22-4 a default outside the allowed list is refused",
    !badDefault.ok && /allowed statuses/.test(badDefault.ok ? "" : badDefault.message));

  const hide = await setProcedureActivation(admin, {
    workspaceId: wsA, procedureTypeId: platformRow.id, enabled: false, localDisplayName: "Local name", ...base,
  });
  ok("22-5 a supplied procedure CAN be hidden and renamed -- the activation departure",
    hide.ok && hide.data.enabled === false, JSON.stringify(hide));
  const afterHide = await listProcedureTypes(admin, wsA);
  const withDisabled = await listProcedureTypes(admin, wsA, { includeDisabled: true });
  const hiddenRow = withDisabled.find((t: any) => t.id === platformRow.id);
  ok("22-6 ⚠ capture surfaces stop offering it; the SETTINGS view still shows it (or hiding is a trap)",
    !afterHide.some((t: any) => t.id === platformRow.id)
      && hiddenRow?.enabled === false && hiddenRow?.name === "Local name"
      && hiddenRow?.catalogueName === platformRow.catalogueName,
    JSON.stringify({ offered: afterHide.length, hidden: hiddenRow ? hiddenRow.enabled : "missing" }));
  const unhide = await setProcedureActivation(admin, {
    workspaceId: wsA, procedureTypeId: platformRow.id, enabled: true, localDisplayName: null, ...base,
  });
  ok("22-7 offering it again restores the supplied name and the pickers",
    unhide.ok && (await listProcedureTypes(admin, wsA)).some((t: any) => t.id === platformRow.id));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
