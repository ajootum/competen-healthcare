/**
 * Registration act harness -- CPR-PRM-001 s4, s5, s6, s9. Migration 225.
 *
 * WHAT IT PROVES:
 *   1. NAME PARTS COMPOSE THE WHOLE, and a MONONYM still registers -- "Nakato" alone is a name, not a
 *      missing surname, and a form that demands three parts cannot register a real person.
 *   2. THE PARTS ARE STORED as well as the composed whole, so a report can group by family name.
 *   3. AGE IS YEARS, MONTHS AND DAYS (s4), from the same function the form uses.
 *   4. A CHILD CANNOT BE REGISTERED WITHOUT A GUARDIAN, and the refusal happens BEFORE the patient
 *      exists -- a half-made record of a child is worse than none, because it looks finished.
 *   5. A GUARDIAN WHO CANNOT HOLD AUTHORITY DOES NOT SATISFY THE RULE.
 *   6. MULTIPLE RELATIONSHIPS ARE ATTACHED, with the second contact kept.
 *   7. REASON FOR VISIT AND AN APPOINTMENT ARE PART OF THE SAME ACT (s5's "Register & Book"), and the
 *      reason lands on the appointment rather than on the person.
 *   8. A FAILED BOOKING IS REPORTED, NOT SWALLOWED -- the patient still exists and the desk is told.
 *   9. THE TEMPLATE'S OWN REQUIRED FIELDS ARE ENFORCED at registration.
 *  10. THE ORDER OF WRITES IS THE SAFE ONE: nothing is created at all when the guardian rule fails.
 *  11. Duplicate detection still runs, and its candidates still reach the caller.
 *
 *   npx --yes tsx scripts/practice-registration-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { register, registrationForm, ageForForm } from "../src/lib/practice/registration";
import { composeDisplayName } from "../src/lib/practice/patients";
import { patientRelationships } from "../src/lib/practice/relationships";
import { createTemplate, upsertField, publishTemplate } from "../src/lib/practice/registration-config";
import {
  registrationWorkspace, queueWalkIn, saveDraft, listDrafts, discardDraft,
} from "../src/lib/practice/registration-workspace";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ea001";
const COLLEAGUE = "00000000-0000-4000-8000-0000000ea002";

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
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-reg-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-reg",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-reg", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    await admin.from("practice_workspace").delete().eq("id", w.id);
  }
  // Drafts and queue entries carry `on delete cascade` to the workspace, so the loop above takes them
  // with it. No second pass -- one that ran after the delete would be reading an empty list and looking
  // like it did something.
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  await admin.from("practice_audit_event").delete().eq("actor_id", OWNER);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const born = (years: number, offsetDays = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function main() {
  console.log("\nRegistration act harness (CPR-PRM-001 s4/s5/s6/s9, migration 225)\n");
  await cleanup();

  // ── 1. Composition, pure ───────────────────────────────────────────────────
  ok("1. THREE PARTS COMPOSE A WHOLE",
    composeDisplayName({ givenName: "Grace", middleName: "Nakato", familyName: "Okello" }) === "Grace Nakato Okello");
  ok("1b. TWO PARTS ARE FINE -- most people have no middle name",
    composeDisplayName({ givenName: "Grace", familyName: "Okello" }) === "Grace Okello");
  ok("1c. AND ONE IS A WHOLE NAME -- a mononym is not a missing surname",
    composeDisplayName({ givenName: "Nakato" }) === "Nakato" &&
    composeDisplayName({ familyName: "Nakato" }) === "Nakato");
  ok("1d. spacing is not a name", composeDisplayName({ givenName: "  ", middleName: "" }) === "");

  const wsA = await provision(OWNER, "HARNESS Registration A (synthetic)", "a");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  if (!a.ok) { ok("workspace context resolves", false); return report(); }

  const form = await registrationForm(admin, a.ctx);
  ok("the form reports today, the majority age and no template yet",
    !!form.today && form.majorityAge === 18 && form.template === null,
    JSON.stringify({ t: form.today, m: form.majorityAge }));

  // ── 3. Age ─────────────────────────────────────────────────────────────────
  // NEGATIVE, because born() adds the offset: a baby born 45 days ago is 45 days BEFORE today. The
  // first version of this used +45, which is a birth date in the future -- correctly rejected as null.
  const infant = await ageForForm(admin, a.ctx, born(0, -45));
  ok("3. AN INFANT READS IN MONTHS AND DAYS, not '0 years'",
    !!infant.age && /months/.test(infant.age.label) && infant.isMinor === true,
    infant.age?.label);
  const grown = await ageForForm(admin, a.ctx, born(40));
  ok("3b. and an adult reads in years, and is not a minor",
    grown.age?.years === 40 && grown.isMinor === false, grown.age?.label);

  // ── 4, 10. A child without a guardian ──────────────────────────────────────
  const orphaned = await register(admin, a.ctx, {
    givenName: "Baby", familyName: "Nakato", birthDate: born(4), phone: "+256772000001",
    correlationId: "harness-reg",
  });
  ok("4. A CHILD CANNOT BE REGISTERED WITHOUT A GUARDIAN",
    !orphaned.ok && orphaned.code === "GUARDIAN_REQUIRED",
    orphaned.ok ? "it registered" : orphaned.code);
  const { count: afterRefusal } = await admin.from("practice_patient")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("10. AND NOTHING WAS CREATED AT ALL -- a half-made record of a child looks finished",
    afterRefusal === 0, String(afterRefusal));

  // ── 5. Somebody who cannot hold authority ──────────────────────────────────
  const wrongKind = await register(admin, a.ctx, {
    givenName: "Baby", familyName: "Nakato", birthDate: born(4), phone: "+256772000001",
    relationships: [{ relationshipType: "interpreter", fullName: "Sarah Translator", isLegalGuardian: true }],
    correlationId: "harness-reg",
  });
  ok("5. AN INTERPRETER MARKED AS GUARDIAN DOES NOT SATISFY THE RULE",
    !wrongKind.ok && wrongKind.code === "GUARDIAN_REQUIRED",
    wrongKind.ok ? "it registered" : wrongKind.code);

  // ── 2, 6. A child WITH a guardian ──────────────────────────────────────────
  const child = await register(admin, a.ctx, {
    givenName: "Baby", middleName: "Grace", familyName: "Nakato",
    sex: "female", birthDate: born(4), phone: "+256772000001",
    relationships: [
      {
        relationshipType: "mother", fullName: "Sarah Nakato", phone: "+256772000010",
        secondaryPhone: "+256772000011", email: "sarah@example.com",
        isLegalGuardian: true, mayReceiveInformation: true, isPrimary: true,
      },
      {
        relationshipType: "father", fullName: "Peter Mukasa", phone: "+256772000012",
        isLegalGuardian: true, mayReceiveInformation: true,
      },
      { relationshipType: "interpreter", fullName: "Sarah Translator", phone: "+256772000013" },
    ],
    reasonForVisit: "Cough for three days, worse at night",
    correlationId: "harness-reg",
  });
  ok("4b. CONTROL: WITH A GUARDIAN THE CHILD REGISTERS", child.ok, child.ok ? "" : child.message);
  if (!child.ok) return report();

  ok("6. ALL THREE RELATIONSHIPS ARE ATTACHED", child.data.relationships === 3,
    String(child.data.relationships));
  ok("6b. and nothing was reported incomplete", child.data.incomplete.length === 0,
    JSON.stringify(child.data.incomplete));

  const detail = await patientRelationships(admin, a.ctx, child.data.patientId);
  ok("6c. THE SECOND CONTACT IS KEPT -- a guardian with two phones is ordinary",
    detail!.relationships.some(r => /\+256772000011/.test(r.note ?? "")),
    JSON.stringify(detail!.relationships.map(r => r.note)));
  ok("6d. and the expectation is now satisfied, naming the guardian",
    detail!.expectation.required === "guardian" && detail!.expectation.satisfied === true &&
    /Sarah Nakato/.test(detail!.expectation.reason),
    detail!.expectation.reason);
  ok("6e. exactly one contact is marked to ring first",
    detail!.relationships.filter(r => r.is_primary && r.live).length === 1);

  const { data: patientRow } = await admin.from("practice_patient")
    .select("display_name, given_name, middle_name, family_name")
    .eq("id", child.data.patientId).maybeSingle();
  ok("2. THE PARTS ARE STORED AS WELL AS THE WHOLE",
    patientRow?.display_name === "Baby Grace Nakato" && patientRow?.given_name === "Baby" &&
    patientRow?.middle_name === "Grace" && patientRow?.family_name === "Nakato",
    JSON.stringify(patientRow));

  // ── 1e. A mononym registers ────────────────────────────────────────────────
  const mononym = await register(admin, a.ctx, {
    givenName: "Nakato", birthDate: born(30), phone: "+256772000002", correlationId: "harness-reg",
  });
  ok("1e. A PATIENT KNOWN BY ONE NAME REGISTERS UNDER IT", mononym.ok && mononym.data.displayName === "Nakato",
    mononym.ok ? mononym.data.displayName : mononym.message);

  // ── 7. Register and book ───────────────────────────────────────────────────
  const when = new Date(Date.now() + 3 * 86400_000);
  when.setUTCHours(9, 0, 0, 0);
  const booked = await register(admin, a.ctx, {
    givenName: "Daniel", familyName: "Opio", birthDate: born(52), phone: "+256772000003",
    reasonForVisit: "Follow-up on blood pressure",
    appointmentAt: when.toISOString(),
    correlationId: "harness-reg",
  });
  ok("7. REGISTER AND BOOK IS ONE ACT (s5)", booked.ok && !!booked.data.appointmentId,
    booked.ok ? String(booked.data.appointmentId) : booked.message);
  if (booked.ok && booked.data.appointmentId) {
    const { data: appt } = await admin.from("practice_appointment")
      .select("reason, patient_id, patient_name, scheduled_at")
      .eq("id", booked.data.appointmentId).maybeSingle();
    ok("7b. THE REASON LANDS ON THE APPOINTMENT, not on the person -- it is about the visit",
      appt?.reason === "Follow-up on blood pressure" && appt?.patient_id === booked.data.patientId,
      JSON.stringify(appt));
    const { data: patient } = await admin.from("practice_patient")
      .select("*").eq("id", booked.data.patientId).maybeSingle();
    ok("7c. and no reason column was invented on the patient",
      !("reason_for_visit" in (patient ?? {})) && !("reason" in (patient ?? {})));
  }

  // ── 8. A failed booking is reported ────────────────────────────────────────
  const badTime = await register(admin, a.ctx, {
    givenName: "Esther", familyName: "Adeke", birthDate: born(29), phone: "+256772000004",
    appointmentAt: "not a timestamp at all", correlationId: "harness-reg",
  });
  ok("8. A FAILED BOOKING DOES NOT LOSE THE PATIENT", badTime.ok && !!badTime.data.patientId,
    badTime.ok ? "" : badTime.message);
  ok("8b. AND IS REPORTED RATHER THAN SWALLOWED -- a desk that thinks it booked is the worst outcome",
    badTime.ok && badTime.data.appointmentId === null &&
    badTime.data.incomplete.some(i => i.step === "appointment"),
    badTime.ok ? JSON.stringify(badTime.data.incomplete) : "");

  // ── 9. The template's own required fields ──────────────────────────────────
  const t = await createTemplate(admin, a.ctx, { name: "With insurance", correlationId: "harness-reg" });
  if (t.ok) {
    await upsertField(admin, a.ctx, { templateId: t.data.id, fieldKey: "birth_date", visible: true, required: true, correlationId: "harness-reg" });
    await upsertField(admin, a.ctx, { templateId: t.data.id, fieldKey: "phone", visible: true, required: true, correlationId: "harness-reg" });
    await upsertField(admin, a.ctx, {
      templateId: t.data.id, fieldKey: "insurer_name", label: "Insurer", fieldType: "text",
      required: true, correlationId: "harness-reg",
    });
    const published = await publishTemplate(admin, a.ctx, { templateId: t.data.id, makeDefault: true, correlationId: "harness-reg" });
    ok("a template requiring an extra field is published", published.ok, published.ok ? "" : published.message);

    const missingCustom = await register(admin, a.ctx, {
      givenName: "Joan", familyName: "Kirabo", birthDate: born(33), phone: "+256772000005",
      correlationId: "harness-reg",
    });
    ok("9. THE TEMPLATE'S REQUIRED FIELD IS ENFORCED AT REGISTRATION",
      !missingCustom.ok && missingCustom.code === "TEMPLATE_INCOMPLETE" && /Insurer/.test(missingCustom.message),
      missingCustom.ok ? "it registered" : missingCustom.message);
    const withCustom = await register(admin, a.ctx, {
      givenName: "Joan", familyName: "Kirabo", birthDate: born(33), phone: "+256772000005",
      custom: { insurer_name: "AAR" }, correlationId: "harness-reg",
    });
    ok("9b. CONTROL: supplying it lets the registration through", withCustom.ok,
      withCustom.ok ? "" : withCustom.message);
    const formWithTemplate = await registrationForm(admin, a.ctx);
    ok("9c. and the form now reports the template and its fields",
      formWithTemplate.template?.name === "With insurance" &&
      formWithTemplate.fields.some((f: any) => f.field_key === "insurer_name"),
      formWithTemplate.template?.name);
  } else ok("a template is created", false, t.message);

  // ── The workspace: the panel, the queue and drafts (CPR-REG-002) ───────────
  const w = await registrationWorkspace(admin, a.ctx);
  ok("THE OPERATIONAL PANEL COUNTS WHAT EXISTS",
    w.counts.totalPatients >= 4 && typeof w.counts.registeredToday === "number",
    JSON.stringify(w.counts));
  ok("AND COMPUTES NO UTILISATION -- capacity is recorded nowhere, so the figure would be real over invented",
    (w.clinic as any).utilisationComputed === false &&
    !/"utilisation"\s*:\s*\d/.test(JSON.stringify(w)),
    JSON.stringify(w.clinic));
  const serialisedPanel = JSON.stringify(w);
  ok("and the panel carries no percentage-shaped value at all",
    !/:\s*"?\d{1,3}(\.\d+)?\s*%/.test(serialisedPanel));
  ok("the refusals are stated, each with a reason -- photo, scan, utilisation, encryption, AI",
    w.refused.length === 5 &&
    w.refused.every(r => r.detail.length > 60) &&
    ["utilisation", "photo", "scan_id", "encryption_claim", "ai_suggestions"]
      .every(k => w.refused.some(r => r.key === k)),
    w.refused.map(r => r.key).join(","));
  ok("and the observations panel is arithmetic, not a model",
    w.observations.length === 3 && w.observations.every(o => typeof o.text === "string"),
    JSON.stringify(w.observations.map(o => o.text)));

  // Register and queue.
  const queued = await queueWalkIn(admin, a.ctx, {
    patientId: booked.ok ? booked.data.patientId : "", correlationId: "harness-reg",
  });
  ok("A WALK-IN CAN BE PUT IN TODAY'S QUEUE", queued.ok, queued.ok ? "" : queued.message);
  const { data: queueRow } = await admin.from("practice_queue_entry")
    .select("patient_id, patient_name, status").eq("id", queued.ok ? queued.data.id : "").maybeSingle();
  ok("AND THE ENTRY NAMES THE PATIENT, so the waiting list can be opened rather than just read",
    queueRow?.patient_id === (booked.ok ? booked.data.patientId : null) &&
    queueRow?.status === "WAITING",
    JSON.stringify(queueRow));
  ok("and it carries the REGISTRY's name, never a caller's spelling",
    queueRow?.patient_name === "Daniel Opio", queueRow?.patient_name);
  const twiceQueued = await queueWalkIn(admin, a.ctx, {
    patientId: booked.ok ? booked.data.patientId : "", correlationId: "harness-reg",
  });
  ok("QUEUEING SOMEBODY TWICE IS NOT AN ERROR, and does not make the waiting list lie about the room",
    twiceQueued.ok && (twiceQueued as any).data.alreadyWaiting === true,
    JSON.stringify(twiceQueued));
  const { count: queueCount } = await admin.from("practice_queue_entry")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", wsA).eq("patient_id", booked.ok ? booked.data.patientId : "");
  ok("so there is one entry, not two", queueCount === 1, String(queueCount));

  const panelAfterQueue = await registrationWorkspace(admin, a.ctx);
  ok("and the waiting list on the panel shows them, with a link to their record",
    panelAfterQueue.queue.length === 1 && !!panelAfterQueue.queue[0].href,
    JSON.stringify(panelAfterQueue.queue));

  // Drafts.
  const draft = await saveDraft(admin, a.ctx, {
    payload: { givenName: "Half", familyName: "Finished", phone: "+256772000099" },
    correlationId: "harness-reg",
  });
  ok("A HALF-FILLED REGISTRATION CAN BE KEPT AS A DRAFT", draft.ok, draft.ok ? "" : draft.message);
  const drafts = await listDrafts(admin, a.ctx);
  ok("and it is labelled from what was typed, so it is recognisable without opening it",
    drafts.length === 1 && drafts[0].label === "Half Finished", JSON.stringify(drafts[0]?.label));
  ok("and its age is reported -- an old draft is somebody's details nobody is minding",
    typeof drafts[0].daysOld === "number", String(drafts[0]?.daysOld));
  const updated = await saveDraft(admin, a.ctx, {
    id: draft.ok ? draft.data.id : "", payload: { givenName: "Half", familyName: "Finished", phone: "+256772000099", email: "x@y.z" },
    correlationId: "harness-reg",
  });
  ok("saving again UPDATES it rather than leaving a trail of copies of the same person",
    updated.ok && (await listDrafts(admin, a.ctx)).length === 1);
  // A DRAFT IS ITS AUTHOR'S. It holds identifiable details about somebody who is not yet a patient,
  // collected in a conversation only the person who started it was part of.
  const { data: colleagueMembership } = await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: COLLEAGUE, role_code: "practice_assistant", status: "active",
  }).select("id").single();
  if (colleagueMembership) {
    await admin.from("practice_role_assignment").insert(
      ["patient.create", "patient.list"].map(c => ({
        membership_id: colleagueMembership.id, capability_code: c, source: "explicit_grant", created_by: OWNER,
      })),
    );
    const colleague = await resolveWorkspaceContext(admin, COLLEAGUE, wsA);
    if (colleague.ok) {
      const theirList = await listDrafts(admin, colleague.ctx);
      ok("A COLLEAGUE CANNOT SEE SOMEBODY ELSE'S DRAFT", theirList.length === 0, String(theirList.length));
      const theirUpdate = await saveDraft(admin, colleague.ctx, {
        id: draft.ok ? draft.data.id : "", payload: { givenName: "Hijacked" }, correlationId: "harness-reg",
      });
      ok("nor overwrite one", !theirUpdate.ok && theirUpdate.code === "NOT_FOUND",
        theirUpdate.ok ? "it was overwritten" : theirUpdate.code);
      const theirDiscard = await discardDraft(admin, colleague.ctx, { id: draft.ok ? draft.data.id : "" });
      ok("nor discard one", !theirDiscard.ok && theirDiscard.code === "NOT_FOUND");
      // CONTROL: the draft is still there and still says what its author typed.
      const stillMine = await listDrafts(admin, a.ctx);
      ok("CONTROL: and it is untouched, still holding what its author typed",
        stillMine.length === 1 && (stillMine[0].payload as any).givenName === "Half",
        JSON.stringify((stillMine[0]?.payload as any)?.givenName));
    }
  }

  const discarded = await discardDraft(admin, a.ctx, { id: draft.ok ? draft.data.id : "" });
  ok("and its author can discard it", discarded.ok && (await listDrafts(admin, a.ctx)).length === 0);

  // ── 11. Duplicate detection still runs ─────────────────────────────────────
  const twin = await register(admin, a.ctx, {
    givenName: "Daniel", familyName: "Opio", birthDate: born(52), phone: "+256772000009",
    custom: { insurer_name: "AAR" }, correlationId: "harness-reg",
  });
  ok("11. DUPLICATE DETECTION STILL RUNS THROUGH THE NEW ACT",
    !twin.ok && Array.isArray((twin as any).candidates) && (twin as any).candidates.length > 0,
    twin.ok ? "it registered silently" : `${twin.code}`);
  const confirmed = await register(admin, a.ctx, {
    givenName: "Daniel", familyName: "Opio", birthDate: born(52), phone: "+256772000009",
    custom: { insurer_name: "AAR" }, confirmNew: true, correlationId: "harness-reg",
  });
  ok("11b. CONTROL: and confirming a namesake still registers them", confirmed.ok,
    confirmed.ok ? "" : confirmed.message);

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
