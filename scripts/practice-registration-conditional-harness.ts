/**
 * Conditional registration fields, ON SCREEN -- CPR-PRM-001 s9.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS TO KEEP CLOSED.
 *
 * `conditionMet` had exactly one caller in the product: validateSubmission. So a conditional field was
 * VALIDATED conditionally -- only required when its condition held -- and then RENDERED unconditionally.
 * A practice that configured "ask for the guardian's name only when the patient is a minor" showed that
 * question to everybody, every time, and the condition's only visible effect was on whether the answer
 * was compulsory.
 *
 * WHAT IT PROVES:
 *   1. ONE EVALUATOR. registration-config's `conditionMet` is the same function object as
 *      registration-condition's -- not a copy, not a re-implementation.
 *   2. THE PURE MODULE HAS NO IMPORTS AT ALL, so it cannot drag the server into a browser bundle. That
 *      is the only reason it is a separate file.
 *   3. THE REAL FORM COMPONENT draws a conditional field when its condition holds and does NOT draw it
 *      when it does not -- both directions, rendered through the component itself.
 *   4. NON-VACUITY: an unconditional custom field is drawn in both of those renders, and the core
 *      identity/contact sections survive. "Absent" is not "the form rendered nothing".
 *   5. A CONDITION NAMING A FIELD THAT DOES NOT EXIST hides that one field and nothing else. A CYCLE of
 *      conditions terminates and hides only the fields in it.
 *   6. WHAT THE FORM DRAWS AND WHAT THE SERVER CONSIDERS APPLICABLE ARE THE SAME SET, for the same
 *      values, over fields read back from the database.
 *   7. A WITHDRAWN QUESTION'S ANSWER IS CLEARED -- and the hazard that makes clearing necessary rather
 *      than tidy is demonstrated first: a kept answer makes the SERVER demand a field that is not on
 *      the screen.
 *   8. The sentence said when an answer is thrown away.
 *
 *   npx --yes tsx scripts/practice-registration-conditional-harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  conditionMet as evaluatorFromConfig, createTemplate, upsertField, publishTemplate,
  resolveTemplate, validateSubmission, validateTemplate,
} from "../src/lib/practice/registration-config";
import {
  conditionMet as evaluatorFromPureModule, resolveApplicable, clearedNotice,
} from "../src/lib/practice/registration-condition";
import RegistrationForm from "../src/app/practice/(shell)/patients/RegistrationForm";

loadEnvConfig(process.cwd());

/* eslint-disable @typescript-eslint/no-explicit-any */

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// HEX ONLY -- 'r' and 'z' are not hex digits, and a malformed uuid dies as a null two lines later.
const OWNER = "00000000-0000-4000-8000-0000000cd001";

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error: reqError } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-cond-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-cond",
  }).select("id").single();
  if (reqError || !req) throw new Error(`provisioning request refused: ${reqError?.message ?? "no row returned"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-cond", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  // ⚠ practice_audit_event is append-only since migration 247 and cannot be deleted. Nothing here
  // asserts over it, so nothing here is scoped to a run id either.
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

// ── The form's own starting state, written out ────────────────────────────────────────────────────
//
// RegistrationForm opens with every box empty and sex on "unspecified". These are the values its
// conditions are evaluated against on first render, and they are what the assertions below expect the
// SERVER to be given for the same form. Kept as data so a render assertion and an engine assertion can
// be made to agree rather than each asserting its own idea of "empty".
const INITIAL_FORM_VALUES: Record<string, unknown> = {
  display_name: undefined, sex: "unspecified", birth_date: undefined,
  age_estimate_years: undefined, phone: undefined, email: undefined,
};

const coreRow = (k: string, label: string, type: string, required: boolean) => ({
  field_key: k, label, field_type: type, is_core: true, visible: true, required, options: [], condition: null,
});
const customRow = (k: string, label: string, condition: unknown, extra: Record<string, unknown> = {}) => ({
  field_key: k, label, field_type: "text", is_core: false, visible: true, required: false,
  options: [], condition, ...extra,
});

const render = (fields: any[]) => renderToStaticMarkup(React.createElement(RegistrationForm, {
  form: { template: { name: "Harness template" }, fields },
  majorityAge: 18, today: "2026-01-01", onRegistered: () => {},
} as any));

async function main() {
  console.log("\nConditional registration fields on screen (CPR-PRM-001 s9)\n");

  // ── 1, 2. One evaluator, and a file that cannot pull the server into a bundle ───────────────────
  ok("1. ONE EVALUATOR: the config module re-exports the pure one rather than keeping a copy",
    evaluatorFromConfig === evaluatorFromPureModule);

  const pureSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/practice/registration-condition.ts"), "utf8");
  const importLines = pureSrc.split("\n").filter(l => /^\s*import[\s{*]/.test(l) || /\brequire\s*\(/.test(l));
  ok("2. THE PURE MODULE IMPORTS NOTHING -- a client component can reach it without reaching node:crypto or next/headers",
    importLines.length === 0, importLines.join(" | "));

  // ── 2b. What the submit button sends ───────────────────────────────────────────────────────────
  //
  // ⚠ HONESTLY LABELLED: A SOURCE CHECK, because pressing a button needs a DOM and there is none here.
  // The rule it guards is real -- the payload must carry the whitelist of questions on screen, not the
  // raw state map -- and the alternative to a source check is no check at all. Comments are STRIPPED
  // first, so this cannot pass on prose that merely mentions the identifier.
  const formSrc = fs.readFileSync(
    path.join(process.cwd(), "src/app/practice/(shell)/patients/RegistrationForm.tsx"), "utf8");
  const formCode = formSrc.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
    .filter(l => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  ok("2b. THE PAYLOAD CARRIES THE APPLICABLE ANSWERS, not the raw state map (source check -- no DOM here)",
    /custom:\s*applicableCustom/.test(formCode) && !/\bcustom,\s*confirmNew/.test(formCode),
    formCode.includes("applicableCustom") ? "shape changed" : "applicableCustom is gone");
  // ONE WRITE PATH. An input that set the state directly would opt out of the clearing without anybody
  // noticing -- the drift this whole change exists to prevent, in miniature.
  const directWriters = (formCode.match(/onChange=\{[^}]*set(?:P|Custom)\(/g) ?? []);
  ok("2c. EVERY INPUT WRITES THROUGH `edit` -- none reaches setP or setCustom directly (source check)",
    directWriters.length === 0, directWriters.join(" | "));

  // ── 3, 4. The real component, both directions ──────────────────────────────────────────────────
  //
  // `sex` starts on "unspecified", so the SAME initial state can satisfy one condition and fail
  // another. That is what makes both directions testable through a component whose state nothing here
  // can drive.
  const applies = render([
    coreRow("display_name", "Full name", "text", true),
    coreRow("birth_date", "Date of birth", "date", true),
    customRow("insurer_name", "Which insurer", { when: "sex", in: ["unspecified", "male"] }),
    customRow("referral_source", "How did they hear of us", null),
  ]);
  const doesNotApply = render([
    coreRow("display_name", "Full name", "text", true),
    coreRow("birth_date", "Date of birth", "date", true),
    customRow("insurer_name", "Which insurer", { when: "sex", equals: "female" }),
    customRow("referral_source", "How did they hear of us", null),
  ]);

  ok("3. THE FIELD IS DRAWN WHEN ITS CONDITION HOLDS",
    applies.includes("Which insurer"));
  ok("3b. AND IS ABSENT WHEN IT DOES NOT -- the defect this harness exists for",
    !doesNotApply.includes("Which insurer"));
  ok("4. NON-VACUITY: an unconditional custom field is drawn in BOTH renders",
    applies.includes("How did they hear of us") && doesNotApply.includes("How did they hear of us"));
  ok("4b. and the form itself is still a form in the render where the field vanished",
    doesNotApply.includes("Date of birth") && doesNotApply.includes("Guardian") &&
    doesNotApply.includes("Register only"));

  // visible=false still wins, condition or no condition.
  const hidden = render([
    coreRow("display_name", "Full name", "text", true),
    customRow("insurer_name", "Which insurer", { when: "sex", in: ["unspecified"] }, { visible: false }),
    customRow("referral_source", "How did they hear of us", null),
  ]);
  ok("4c. AND `visible: false` still hides a field whose condition holds",
    !hidden.includes("Which insurer") && hidden.includes("How did they hear of us"));

  // ── 5. Broken conditions must not blank the form ───────────────────────────────────────────────
  const dangling = render([
    coreRow("display_name", "Full name", "text", true),
    customRow("insurer_name", "Which insurer", { when: "no_such_field", isPresent: true }),
    customRow("referral_source", "How did they hear of us", null),
  ]);
  ok("5. A CONDITION NAMING A FIELD THAT DOES NOT EXIST hides that field -- exactly as the server treats it",
    !dangling.includes("Which insurer"));
  ok("5b. AND NOTHING ELSE. The other question, and the form, are still there",
    dangling.includes("How did they hear of us") && dangling.includes("Register only"));

  // A cycle cannot reach a published template -- validateTemplate refuses it -- but a renderer that
  // hangs on one takes the tab with it, so it is asserted rather than assumed. Reaching this line at
  // all is half the assertion.
  const cyclic = render([
    coreRow("display_name", "Full name", "text", true),
    customRow("cyc_a", "Loop A", { when: "cyc_b", equals: "x" }),
    customRow("cyc_b", "Loop B", { when: "cyc_a", equals: "x" }),
    customRow("referral_source", "How did they hear of us", null),
  ]);
  ok("5c. A CYCLE OF CONDITIONS TERMINATES, hides only the fields in the loop, and leaves the rest of the form",
    !cyclic.includes("Loop A") && !cyclic.includes("Loop B") &&
    cyclic.includes("How did they hear of us") && cyclic.includes("Register only"));

  // ── 6. The render and the engine agree, field for field ────────────────────────────────────────
  const mixed = [
    coreRow("display_name", "Full name", "text", true),
    coreRow("birth_date", "Date of birth", "date", true),
    customRow("shown_always", "Always asked", null),
    customRow("shown_now", "Asked while sex is unspecified", { when: "sex", equals: "unspecified" }),
    customRow("hidden_now", "Asked only for a named sex", { when: "sex", in: ["male", "female"] }),
    customRow("needs_dob", "Asked once a date of birth is given", { when: "birth_date", isPresent: true }),
  ];
  const mixedMarkup = render(mixed);
  const engineApplicable = new Set(validateSubmission(mixed, INITIAL_FORM_VALUES).applicable);
  const disagreements = mixed
    .filter(f => !f.is_core)
    .filter(f => mixedMarkup.includes(f.label) !== engineApplicable.has(f.field_key))
    .map(f => `${f.field_key}: drawn=${mixedMarkup.includes(f.label)} engine=${engineApplicable.has(f.field_key)}`);
  ok("6. WHAT THE FORM DRAWS IS WHAT THE SERVER CALLS APPLICABLE, field for field, for the same values",
    disagreements.length === 0, disagreements.join("; "));
  // NON-VACUOUS: the set is a mixture, not "all" or "none".
  ok("6b. CONTROL: and that set is genuinely mixed -- two drawn, two not",
    mixedMarkup.includes("Always asked") && mixedMarkup.includes("Asked while sex is unspecified") &&
    !mixedMarkup.includes("Asked only for a named sex") &&
    !mixedMarkup.includes("Asked once a date of birth is given"));

  // ── 8. The sentence ────────────────────────────────────────────────────────────────────────────
  ok("8. NOTHING CLEARED, NOTHING SAID", clearedNotice([]) === null);
  ok("8b. one field, named",
    clearedNotice(["Insurer"]) === "Insurer no longer applies, so what was typed there has been cleared.");
  ok("8c. and several, listed",
    clearedNotice(["Insurer", "Policy number", "Excess"]) ===
    "Insurer, Policy number and Excess no longer apply, so what was typed there has been cleared.");

  // ── 7. The stale answer, over fields read back from the database ───────────────────────────────
  await cleanup();
  const wsA = await provision(OWNER, "HARNESS Conditional (synthetic)", "a");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  if (!a.ok) { ok("workspace context resolves", false); return report(); }

  const t = await createTemplate(admin, a.ctx, { name: "Insurance registration", correlationId: "harness-cond" });
  if (!t.ok) { ok("a template is created", false, t.message); return report(); }
  for (const f of [
    { fieldKey: "birth_date", visible: true, required: true },
    { fieldKey: "phone", visible: true, required: true },
    { fieldKey: "has_insurance", label: "Has insurance", fieldType: "boolean", visible: true, required: false, condition: null },
    { fieldKey: "insurer_name", label: "Insurer", fieldType: "text", visible: true, required: true, condition: { when: "has_insurance", equals: true } as any },
    { fieldKey: "policy_number", label: "Policy number", fieldType: "text", visible: true, required: true, condition: { when: "insurer_name", isPresent: true } as any },
  ]) {
    const r = await upsertField(admin, a.ctx, { templateId: t.data.id, correlationId: "harness-cond", ...(f as any) });
    if (!r.ok) { ok(`field ${f.fieldKey} is added`, false, r.message); return report(); }
  }
  const check = await validateTemplate(admin, a.ctx, t.data.id);
  ok("the chained-condition template is publishable", check.publishable,
    JSON.stringify(check.problems.map(p => p.problem)));
  const pub = await publishTemplate(admin, a.ctx, { templateId: t.data.id, makeDefault: true, correlationId: "harness-cond" });
  ok("and publishes", pub.ok, pub.ok ? "" : pub.message);

  const resolvedTemplate = await resolveTemplate(admin, a.ctx, {});
  if (!resolvedTemplate) { ok("the template resolves for a registration", false); return report(); }
  const liveFields = resolvedTemplate.fields;

  // Somebody ticked "has insurance", named the insurer, then UNTICKED it. The insurer answer is the
  // stale one.
  const typedThenWithdrawn: Record<string, unknown> = {
    display_name: "Stale Answer", birth_date: "1990-01-01", phone: "0772 000 000",
    has_insurance: false, insurer_name: "AAR",
  };

  // FIRST, THE HAZARD IS SHOWN TO BE REAL. Sent as typed, the server does not merely store an answer
  // nobody was asked for -- it uses it, decides Policy number applies, finds it empty, and refuses the
  // registration for a field that is not on the screen.
  const asTyped = validateSubmission(liveFields, typedThenWithdrawn);
  ok("7. THE HAZARD IS REAL: a kept answer makes the SERVER demand a field the form is not showing",
    !asTyped.ok && asTyped.missing.some(m => m.key === "policy_number"),
    JSON.stringify({ ok: asTyped.ok, missing: asTyped.missing.map(m => m.key) }));

  // THEN, WHAT THE FORM ACTUALLY SENDS. resolveApplicable clears the withdrawn answer, the cascade
  // withdraws Policy number with it, and the registration is accepted.
  const asSent = resolveApplicable(liveFields, typedThenWithdrawn);
  ok("7b. THE FORM CLEARS THE WITHDRAWN ANSWER rather than carrying it",
    !("insurer_name" in asSent.values), JSON.stringify(asSent.values));
  ok("7c. AND THE CASCADE FOLLOWS: what depended on it is withdrawn too",
    !asSent.applicable.some((f: any) => f.field_key === "insurer_name") &&
    !asSent.applicable.some((f: any) => f.field_key === "policy_number"),
    asSent.applicable.map((f: any) => f.field_key).join(","));
  ok("7d. and it reports WHAT WAS THROWN AWAY -- the insurer, which was answered; not the policy number, which was not",
    asSent.cleared.map((f: any) => f.field_key).join(",") === "insurer_name",
    asSent.cleared.map((f: any) => f.field_key).join(","));
  const afterClearing = validateSubmission(liveFields, asSent.values);
  ok("7e. SO THE SERVER ACCEPTS WHAT THE FORM SENDS -- the two now agree",
    afterClearing.ok && !afterClearing.applicable.includes("policy_number"),
    JSON.stringify({ ok: afterClearing.ok, missing: afterClearing.missing.map(m => m.key) }));

  // 6c. The two are the same set for the values the form would send, over live rows.
  const clientSet = asSent.applicable.map((f: any) => f.field_key).sort().join(",");
  const serverSet = [...afterClearing.applicable].sort().join(",");
  ok("6c. AND OVER LIVE ROWS, the form's applicable set and the engine's are identical",
    clientSet === serverSet, `${clientSet} vs ${serverSet}`);

  // CONTROL: with insurance actually ticked, both fields come back and the requirement bites.
  const withInsurance = resolveApplicable(liveFields, {
    display_name: "Real Answer", birth_date: "1990-01-01", phone: "0772 000 000",
    has_insurance: true, insurer_name: "AAR",
  });
  ok("7f. CONTROL: tick it and both questions return -- the clearing is conditional, not a delete-all",
    withInsurance.applicable.some((f: any) => f.field_key === "insurer_name") &&
    withInsurance.applicable.some((f: any) => f.field_key === "policy_number") &&
    withInsurance.cleared.length === 0,
    withInsurance.applicable.map((f: any) => f.field_key).join(","));
  const stillMissing = validateSubmission(liveFields, withInsurance.values);
  ok("7g. and the server still refuses the empty policy number -- clearing has not disarmed anything",
    !stillMissing.ok && stillMissing.missing.some(m => m.key === "policy_number"),
    JSON.stringify(stillMissing.missing.map(m => m.key)));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
