/**
 * Registration configuration harness -- CPR-PRM-001 s2, s9. Migration 223.
 *
 * WHAT IT PROVES:
 *   1. THE MINIMUM DATASET IS A FLOOR CONFIGURATION CANNOT GO BELOW. A template that hides the name, or
 *      hides BOTH members of an either/or pair, cannot be published -- because the engine would refuse
 *      the registration anyway, and the practice would get an error about a field their own form never
 *      showed them.
 *   2. HIDING ONE OF A PAIR IS FINE while the other survives -- the floor is the requirement, not the
 *      field.
 *   3. A PUBLISHED TEMPLATE IS NOT EDITED IN PLACE. Somebody is filling it in right now.
 *   4. A CONDITION THAT CAN NEVER FIRE IS REFUSED AT PUBLISH: pointing at a field that is not on the
 *      form, or at one that is hidden. Either way a question silently vanishes.
 *   5. A PROTECTED FIELD CANNOT BE MADE CONDITIONAL -- that is hiding it by another route.
 *   6. A CYCLE OF CONDITIONS IS REFUSED. Neither field ever appears and nothing says why.
 *   7. A LIST WITH NOTHING IN IT IS REFUSED.
 *   8. ONE EVALUATOR, USED BY BOTH SIDES: a field whose condition is unmet is not required, and its
 *      value is DISCARDED rather than stored as an answer to a question nobody asked.
 *   9. CUSTOM FIELDS ARE COLLECTED SEPARATELY from core ones.
 *  10. MOST SPECIFIC TEMPLATE WINS, and no match is a legitimate answer.
 *  11. ONE DEFAULT AT A TIME, enforced by a partial unique index as well as the engine.
 *  12. AUTHORING NEEDS practice.settings.manage, with a control.
 *  13. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-registration-config-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import {
  createTemplate, upsertField, validateTemplate, publishTemplate, resolveTemplate,
  listTemplates, validateSubmission, conditionMet, CORE_FIELDS,
} from "../src/lib/practice/registration-config";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// HEX ONLY. "rc01" looks like a label and is not a uuid -- 'r' is not a hex digit, so the insert below
// is refused and, with its error discarded, the whole run dies on a null two lines later.
const OWNER = "00000000-0000-4000-8000-0000000ac001";
const OTHER = "00000000-0000-4000-8000-0000000ac002";

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
  const { data: req, error: reqError } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-rc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-rc",
  }).select("id").single();
  // CHECKED. A discarded error here surfaces as "cannot read properties of null" two lines down, which
  // says nothing about the malformed uuid that actually caused it.
  if (reqError || !req) throw new Error(`provisioning request refused: ${reqError?.message ?? "no row returned"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-rc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
      await admin.from("practice_workspace").delete().eq("id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

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

async function main() {
  console.log("\nRegistration configuration harness (CPR-PRM-001 s2/s9, migration 223)\n");
  await cleanup();

  // ── 8. The evaluator, pure and before any data ─────────────────────────────
  ok("8. THE EVALUATOR HANDLES equals, in AND isPresent",
    conditionMet({ when: "a", equals: "yes" }, { a: "yes" }) &&
    !conditionMet({ when: "a", equals: "yes" }, { a: "no" }) &&
    conditionMet({ when: "a", in: ["x", "y"] }, { a: "y" }) &&
    !conditionMet({ when: "a", in: ["x", "y"] }, { a: "z" }) &&
    conditionMet({ when: "a", isPresent: true }, { a: "something" }) &&
    !conditionMet({ when: "a", isPresent: true }, { a: "" }) &&
    conditionMet({ when: "a", isPresent: false }, {}));
  ok("8b. AN UNKNOWN CONDITION SHAPE MEANS THE FIELD APPLIES -- a vanished question is worse than an extra one",
    conditionMet({ when: "a", somethingNobodyImplemented: 1 } as any, {}) &&
    conditionMet(null, {}) && conditionMet({ nonsense: true } as any, {}));
  ok("8c. and an empty array counts as absent",
    !conditionMet({ when: "a", isPresent: true }, { a: [] }));

  const wsA = await provision(OWNER, "HARNESS RegConfig A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS RegConfig B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── No template is a legitimate answer ─────────────────────────────────────
  ok("10. NO PUBLISHED TEMPLATE RESOLVES TO NOTHING -- which means the built-in form, not an error",
    (await resolveTemplate(admin, a.ctx)) === null);

  // ── Seeding ────────────────────────────────────────────────────────────────
  const t1 = await createTemplate(admin, a.ctx, { name: "General registration", correlationId: "harness-rc" });
  ok("a template is created", t1.ok, t1.ok ? "" : t1.message);
  if (!t1.ok) return report();
  const seeded = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("and is SEEDED with the core fields -- an empty template's first publish would fail on the floor",
    seeded.fields.length === CORE_FIELDS.length, String(seeded.fields.length));

  // ── 1. The floor ───────────────────────────────────────────────────────────
  const hideName = await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "display_name", visible: false, correlationId: "harness-rc",
  });
  ok("1. HIDING THE NAME IS REFUSED AT THE POINT OF EDIT -- nothing else can stand in for it",
    !hideName.ok && hideName.code === "PROTECTED_FIELD",
    hideName.ok ? "it was allowed" : hideName.code);
  const retypeName = await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "display_name", fieldType: "number", correlationId: "harness-rc",
  });
  ok("1b. and so is retyping it", !retypeName.ok && retypeName.code === "PROTECTED_FIELD");

  // ── 2. One of a pair may go ────────────────────────────────────────────────
  const hideEstimate = await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "age_estimate_years", visible: false, correlationId: "harness-rc",
  });
  ok("2. HIDING ONE OF AN EITHER/OR PAIR IS ALLOWED -- a practice that always takes a date of birth",
    hideEstimate.ok, hideEstimate.ok ? "" : hideEstimate.message);
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "birth_date", visible: true, required: true, correlationId: "harness-rc",
  });
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "phone", visible: true, required: true, correlationId: "harness-rc",
  });
  const withOne = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("2b. AND THE TEMPLATE IS PUBLISHABLE, because the requirement survives even though the field did not",
    withOne.publishable, JSON.stringify(withOne.problems));

  // Now hide BOTH of the age pair.
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "birth_date", visible: false, correlationId: "harness-rc",
  });
  const bothGone = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("2c. BUT HIDING BOTH IS REFUSED -- the registration could never be submitted",
    !bothGone.publishable && bothGone.problems.some(p => /Date of birth or Estimated age/i.test(p.problem)),
    JSON.stringify(bothGone.problems.map(p => p.problem)));
  const blocked = await publishTemplate(admin, a.ctx, { templateId: t1.data.id, correlationId: "harness-rc" });
  ok("2d. and publishing is refused with the reason spelled out",
    !blocked.ok && blocked.code === "NOT_PUBLISHABLE" && /Date of birth/i.test(blocked.message),
    blocked.ok ? "it published" : blocked.message);
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "birth_date", visible: true, required: true, correlationId: "harness-rc",
  });

  // ── 4, 5, 6, 7. What validation catches ────────────────────────────────────
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "insurer_name", label: "Insurer", fieldType: "text",
    condition: { when: "has_insurance", equals: true }, correlationId: "harness-rc",
  });
  const danglingCondition = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("4. A CONDITION ON A FIELD THAT IS NOT ON THE FORM IS CAUGHT -- the question would silently vanish",
    !danglingCondition.publishable &&
    danglingCondition.problems.some(p => /not on this form/i.test(p.problem)),
    JSON.stringify(danglingCondition.problems.map(p => p.problem)));

  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "has_insurance", label: "Has insurance", fieldType: "boolean",
    visible: false, correlationId: "harness-rc",
  });
  const hiddenDependency = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("4b. AND A CONDITION ON A HIDDEN FIELD IS CAUGHT TOO -- it could never fire",
    !hiddenDependency.publishable &&
    hiddenDependency.problems.some(p => /hidden/i.test(p.problem)),
    JSON.stringify(hiddenDependency.problems.map(p => p.problem)));
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "has_insurance", label: "Has insurance", fieldType: "boolean",
    visible: true, correlationId: "harness-rc",
  });

  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "phone", visible: true, required: true,
    condition: { when: "has_insurance", equals: true }, correlationId: "harness-rc",
  });
  const conditionalProtected = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("5. A PROTECTED FIELD CANNOT BE MADE CONDITIONAL -- that is hiding it by another route",
    !conditionalProtected.publishable &&
    conditionalProtected.problems.some(p => /cannot be made conditional/i.test(p.problem)),
    JSON.stringify(conditionalProtected.problems.map(p => p.problem)));
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "phone", visible: true, required: true,
    condition: null, correlationId: "harness-rc",
  });

  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "loop_a", label: "Loop A", fieldType: "text",
    condition: { when: "loop_b", equals: "x" }, correlationId: "harness-rc",
  });
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "loop_b", label: "Loop B", fieldType: "text",
    condition: { when: "loop_a", equals: "x" }, correlationId: "harness-rc",
  });
  const cyclic = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("6. A CYCLE OF CONDITIONS IS CAUGHT -- neither field could ever appear",
    !cyclic.publishable && cyclic.problems.some(p => /loop of conditions/i.test(p.problem)),
    JSON.stringify(cyclic.problems.map(p => p.problem)));
  await admin.from("practice_registration_field").delete()
    .eq("template_id", t1.data.id).in("field_key", ["loop_a", "loop_b"]);

  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "referral_source", label: "Referral source",
    fieldType: "select", options: [], correlationId: "harness-rc",
  });
  const emptyList = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("7. A LIST WITH NOTHING IN IT IS CAUGHT",
    !emptyList.publishable && emptyList.problems.some(p => /nothing in it/i.test(p.problem)),
    JSON.stringify(emptyList.problems.map(p => p.problem)));
  await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "referral_source", label: "Referral source", fieldType: "select",
    options: [{ value: "hospital", label: "Hospital" }, { value: "self", label: "Self" }],
    correlationId: "harness-rc",
  });

  const clean = await validateTemplate(admin, a.ctx, t1.data.id);
  ok("CONTROL: with all of that fixed the template validates",
    clean.publishable, JSON.stringify(clean.problems.map(p => p.problem)));

  // ── 3, 11. Publishing ──────────────────────────────────────────────────────
  const published = await publishTemplate(admin, a.ctx, {
    templateId: t1.data.id, makeDefault: true, correlationId: "harness-rc",
  });
  ok("the template publishes", published.ok, published.ok ? "" : published.message);
  const editLive = await upsertField(admin, a.ctx, {
    templateId: t1.data.id, fieldKey: "referral_source", required: true, correlationId: "harness-rc",
  });
  ok("3. A PUBLISHED TEMPLATE IS NOT EDITED IN PLACE -- somebody is filling it in right now",
    !editLive.ok && editLive.code === "PUBLISHED", editLive.ok ? "it was edited" : editLive.code);

  const t2 = await createTemplate(admin, a.ctx, {
    name: "Paediatric registration", specialty: "paediatrics", correlationId: "harness-rc",
  });
  if (!t2.ok) { ok("a second template is created", false, t2.message); return report(); }
  await upsertField(admin, a.ctx, { templateId: t2.data.id, fieldKey: "birth_date", visible: true, required: true, correlationId: "harness-rc" });
  await upsertField(admin, a.ctx, { templateId: t2.data.id, fieldKey: "phone", visible: true, required: true, correlationId: "harness-rc" });
  await upsertField(admin, a.ctx, {
    templateId: t2.data.id, fieldKey: "school_name", label: "School", fieldType: "text",
    correlationId: "harness-rc",
  });
  const published2 = await publishTemplate(admin, a.ctx, {
    templateId: t2.data.id, makeDefault: true, correlationId: "harness-rc",
  });
  ok("a second template publishes as the new default", published2.ok, published2.ok ? "" : published2.message);

  const defaults = (await listTemplates(admin, a.ctx))
    .filter((t: any) => t.is_default && t.status === "published");
  ok("11. ONE DEFAULT AT A TIME -- the previous one was displaced",
    defaults.length === 1 && defaults[0].name === "Paediatric registration",
    JSON.stringify(defaults.map((t: any) => t.name)));
  // THE INDEX IS THE BACKSTOP, proven directly.
  const { error: rawDefault } = await admin.from("practice_registration_template").insert({
    workspace_id: wsA, name: "Sneaky second default", status: "published", is_default: true,
  });
  ok("11b. AND THE DATABASE REFUSES A SECOND, for a writer that bypasses the engine",
    rawDefault !== null, rawDefault?.message ?? "the insert succeeded");

  // ── 10. Most specific wins ─────────────────────────────────────────────────
  const forPaeds = await resolveTemplate(admin, a.ctx, { specialty: "paediatrics" });
  ok("10b. MOST SPECIFIC WINS -- the paediatric template for a paediatric registration",
    forPaeds?.template.name === "Paediatric registration", forPaeds?.template.name);
  const forGeneral = await resolveTemplate(admin, a.ctx, { specialty: "cardiology" });
  ok("10c. and the unscoped one for everything else",
    forGeneral?.template.name === "General registration", forGeneral?.template.name);
  ok("10d. the resolved template carries its fields in display order",
    (forPaeds?.fields.length ?? 0) > 0 &&
    forPaeds!.fields.every((f: any, i: number) => i === 0 || f.display_order >= forPaeds!.fields[i - 1].display_order),
    String(forPaeds?.fields.length));

  // ── 8, 9. Submission ───────────────────────────────────────────────────────
  const fields = forGeneral!.fields;
  const withoutInsurance = validateSubmission(fields, {
    display_name: "Test Person", birth_date: "1990-01-01", phone: "0772 000 000",
    has_insurance: false, insurer_name: "Typed anyway",
  });
  ok("8d. A FIELD WHOSE CONDITION IS UNMET IS NOT APPLICABLE",
    withoutInsurance.ok && !withoutInsurance.applicable.includes("insurer_name"),
    JSON.stringify(withoutInsurance.applicable));
  ok("8e. AND ITS VALUE IS DISCARDED -- storing it would be an answer to a question nobody asked",
    !("insurer_name" in withoutInsurance.customFields),
    JSON.stringify(withoutInsurance.customFields));

  await admin.from("practice_registration_field")
    .update({ required: true }).eq("template_id", t1.data.id).eq("field_key", "insurer_name");
  const refreshed = await resolveTemplate(admin, a.ctx, { specialty: "cardiology" });
  const withInsurance = validateSubmission(refreshed!.fields, {
    display_name: "Test Person", birth_date: "1990-01-01", phone: "0772 000 000",
    has_insurance: true,
  });
  ok("8f. AND WHEN THE CONDITION IS MET, IT IS REQUIRED",
    !withInsurance.ok && withInsurance.missing.some(m => m.key === "insurer_name"),
    JSON.stringify(withInsurance.missing));
  const complete = validateSubmission(refreshed!.fields, {
    display_name: "Test Person", birth_date: "1990-01-01", phone: "0772 000 000",
    has_insurance: true, insurer_name: "AAR", referral_source: "hospital",
  });
  ok("9. CUSTOM FIELDS ARE COLLECTED SEPARATELY from core ones",
    complete.ok && complete.customFields.insurer_name === "AAR" &&
    complete.customFields.referral_source === "hospital" &&
    !("display_name" in complete.customFields) && !("phone" in complete.customFields),
    JSON.stringify(complete.customFields));
  const missingCore = validateSubmission(refreshed!.fields, { birth_date: "1990-01-01", phone: "0772 000 000" });
  ok("9b. and a missing protected field is reported by its label, not its key",
    !missingCore.ok && missingCore.missing.some(m => m.key === "display_name" && m.label === "Full name"),
    JSON.stringify(missingCore.missing));

  // ── 12. Capability ─────────────────────────────────────────────────────────
  const noSettings = await withoutCapability(wsA, OWNER, "practice.settings.manage");
  const refusedCreate = await createTemplate(admin, noSettings, {
    name: "Should not land", correlationId: "harness-rc",
  });
  ok("12. AUTHORING A TEMPLATE NEEDS practice.settings.manage",
    !refusedCreate.ok && refusedCreate.code === "FORBIDDEN");
  const stillResolves = await resolveTemplate(admin, noSettings, {});
  ok("12b. CONTROL: using one does not -- the refusal is about authoring, not registering",
    stillResolves !== null);

  // ── 13. Cross-workspace isolation ──────────────────────────────────────────
  const crossList = await listTemplates(admin, b.ctx);
  ok("13. ANOTHER PRACTICE SEES NONE OF THIS ONE'S TEMPLATES", crossList.length === 0, String(crossList.length));
  const crossResolve = await resolveTemplate(admin, b.ctx, { specialty: "paediatrics" });
  ok("13b. and resolves nothing from them", crossResolve === null);
  const crossField = await upsertField(admin, b.ctx, {
    templateId: t2.data.id, fieldKey: "sneaky", label: "Sneaky", correlationId: "harness-rc",
  });
  ok("13c. nor can it add a field to one", !crossField.ok && crossField.code === "NOT_FOUND");
  // NON-VACUOUS: workspace B works on its own.
  const bTemplate = await createTemplate(admin, b.ctx, { name: "Their own form", correlationId: "harness-rc" });
  ok("13d. CONTROL: workspace B authors its own templates perfectly well", bTemplate.ok,
    bTemplate.ok ? "" : bTemplate.message);

  // ── The core select options ARE the database's CHECK constraint ────────────
  //
  // A template offering a value the column refuses builds a form whose submission fails, and the
  // registration desk cannot tell which of the choices on their own screen was the impossible one. So
  // every option is written to a real patient row, and the database is the judge.
  const { data: probePatient } = await admin.from("practice_patient").insert({
    workspace_id: wsA, display_name: "Option Probe", sex: "unspecified", age_estimate_years: 30,
  }).select("id").single();
  if (probePatient) {
    const sexOptions = (CORE_FIELDS.find(f => f.key === "sex")!.options as { value: string }[]).map(o => o.value);
    const contactOptions = (CORE_FIELDS.find(f => f.key === "preferred_contact_method")!.options as { value: string }[]).map(o => o.value);
    const refusals: string[] = [];
    for (const v of sexOptions) {
      const { error } = await admin.from("practice_patient").update({ sex: v }).eq("id", probePatient.id);
      if (error) refusals.push(`sex=${v}`);
    }
    for (const v of contactOptions) {
      const { error } = await admin.from("practice_patient").update({ preferred_contact_method: v }).eq("id", probePatient.id);
      if (error) refusals.push(`contact=${v}`);
    }
    ok("EVERY CORE SELECT OPTION IS ACCEPTED BY THE COLUMN IT WRITES TO",
      refusals.length === 0, refusals.join(", "));
    // CONTROL: the database really is checking, so the assertion above is not passing on an unconstrained column.
    const { error: bogus } = await admin.from("practice_patient")
      .update({ sex: "not_a_real_option" }).eq("id", probePatient.id);
    ok("CONTROL: and a value outside the list IS refused, so that check is real",
      bogus !== null, bogus?.message ?? "the update succeeded");
    await admin.from("practice_patient").delete().eq("id", probePatient.id);
  } else {
    ok("the option probe patient is created", false);
  }

  ok("the protected core fields are the ones the minimum dataset needs",
    CORE_FIELDS.filter(f => f.protected).map(f => f.key).sort().join(",") ===
    "age_estimate_years,birth_date,display_name,email,phone",
    CORE_FIELDS.filter(f => f.protected).map(f => f.key).sort().join(","));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
