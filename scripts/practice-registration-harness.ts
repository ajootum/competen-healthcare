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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { register, registrationForm, ageForForm } from "../src/lib/practice/registration";
import { composeDisplayName, registerPatient } from "../src/lib/practice/patients";
import { patientRelationships } from "../src/lib/practice/relationships";
import { createTemplate, upsertField, publishTemplate } from "../src/lib/practice/registration-config";
import {
  registrationWorkspace, queueWalkIn, saveDraft, listDrafts, discardDraft, steps,
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

  // ── A BABY HAS NO PHONE. The case that made this form unusable in practice ─
  //
  // A six-month-old registered with a mother's phone in the GUARDIAN block and nothing in their own
  // contact fields. Both save buttons sat disabled with nothing on screen saying why: the minimum
  // dataset demanded a phone or an email for the PATIENT, and a baby has neither.
  const infantNoOwnPhone = await register(admin, a.ctx, {
    givenName: "Elisha", familyName: "Nakato", birthDate: born(0, -180), sex: "male",
    relationships: [{
      relationshipType: "mother", fullName: "Elisha FW", phone: "0701388660",
      email: "parent@example.com", isLegalGuardian: true, mayReceiveInformation: true, isPrimary: true,
    }],
    correlationId: "harness-reg",
  });
  ok("A BABY WITH NO PHONE OF THEIR OWN REGISTERS -- the guardian's contact satisfies the minimum",
    infantNoOwnPhone.ok, infantNoOwnPhone.ok ? "" : `${infantNoOwnPhone.code}: ${infantNoOwnPhone.message}`);

  if (infantNoOwnPhone.ok) {
    const { data: babyContacts } = await admin.from("practice_patient_contact")
      .select("value, contact_type").eq("patient_id", infantNoOwnPhone.data.patientId);
    ok("AND THE NUMBER IS NOT COPIED ONTO THE BABY -- a later reader could not tell whose it was",
      ((babyContacts ?? []) as any[]).length === 0,
      JSON.stringify(babyContacts));
    const babyDetail = await patientRelationships(admin, a.ctx, infantNoOwnPhone.data.patientId);
    ok("it lives on the guardian, where it belongs",
      babyDetail!.relationships.some(r => r.phone === "0701388660"),
      JSON.stringify(babyDetail!.relationships.map(r => r.phone)));
  }

  // AND NOBODY AT ALL IS STILL REFUSED -- the rule was relaxed for children, not removed.
  const noContactAnywhere = await register(admin, a.ctx, {
    givenName: "Nobody", familyName: "Reachable", birthDate: born(0, -180),
    relationships: [{
      relationshipType: "mother", fullName: "Silent Guardian", isLegalGuardian: true,
    }],
    correlationId: "harness-reg",
  });
  ok("CONTROL: a child with a guardian who has NO contact is still refused",
    !noContactAnywhere.ok && noContactAnywhere.code === "CONTACT_REQUIRED",
    noContactAnywhere.ok ? "it registered" : noContactAnywhere.code);
  const adultNoContact = await register(admin, a.ctx, {
    givenName: "Adult", familyName: "Unreachable", birthDate: born(40), correlationId: "harness-reg",
  });
  ok("CONTROL: and an adult with no contact is still refused",
    !adultNoContact.ok && adultNoContact.code === "CONTACT_REQUIRED",
    adultNoContact.ok ? "it registered" : adultNoContact.code);

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

  // ── THE ADAPTIVE WORKFLOW, AND THE CALL SITE THAT NEVER FIRED IT ────────────────────────────────
  //
  // ⚠ CPR-V5-006 s7 asks for adult/paediatric registration to adapt with no separate forms. It ALREADY
  // DID, in steps() -- and the screen had been calling it as steps(mode), with no birth date and no
  // today, since it was written. `minor` was therefore permanently null, and every registration from a
  // newborn to a pensioner showed the same hedged "Guardian or next of kin".
  //
  // That is the worst shape a defect can take here: the engine was right, its own tests would have
  // passed, and the feature simply never reached a user. The same class as the addFacility and
  // practice_configuration findings -- an engine with no door is indistinguishable from a missing
  // feature. NOTHING ASSERTED steps() AT ALL BEFORE THIS.
  const asToday = "2026-08-06";
  const childSteps = steps("full", "2018-04-01", asToday);
  const adultSteps = steps("full", "1979-04-01", asToday);
  const unknownSteps = steps("full", null, asToday);
  const contacts = (ss: ReturnType<typeof steps>) => ss.find(s => s.key === "contacts");

  ok("adaptive-1. a CHILD's contacts step asks for a Guardian, and requires one",
    contacts(childSteps)?.label === "Guardian" && contacts(childSteps)?.required === true,
    JSON.stringify(contacts(childSteps)));
  ok("adaptive-2. an ADULT's asks for Next of kin, and does not require it",
    contacts(adultSteps)?.label === "Next of kin" && !contacts(adultSteps)?.required,
    JSON.stringify(contacts(adultSteps)));
  ok("adaptive-3. an UNKNOWN age hedges rather than guessing -- a wrong guardian claim is worse than none",
    contacts(unknownSteps)?.label === "Guardian or next of kin" && !contacts(unknownSteps)?.required,
    JSON.stringify(contacts(unknownSteps)));
  // CONTROL. Without it, 1-3 pass just as well if steps() returned a fixed list per age and nothing
  // else worked -- and they would pass if the labels differed for a reason having nothing to do with age.
  ok("adaptive-control. the three lists are otherwise IDENTICAL, so it is the AGE that changed the step",
    childSteps.map(s => s.key).join() === adultSteps.map(s => s.key).join()
    && childSteps.map(s => s.key).join() === unknownSteps.map(s => s.key).join()
    && contacts(childSteps)?.label !== contacts(adultSteps)?.label,
    childSteps.map(s => s.key).join());

  // ⚠ AND THE CALL SITE, because every assertion above passed while the screen was broken. A React prop
  // cannot be reached from here, but the thing that was wrong CAN be: steps() was called with one
  // argument. This is a source check, and it is the only assertion in this file that could have caught
  // the actual defect.
  //
  // ⚠ IT SCANS CODE, NOT PROSE ABOUT CODE. The first version matched `steps()` inside the comment that
  // EXPLAINS this defect, and reported the screen as broken while it was correct. A source assertion
  // that reads comments will be wrong every time somebody documents the thing it guards -- which is
  // exactly when documentation is most likely to appear.
  const consoleSrc = readFileSync(
    join(process.cwd(), "src", "app", "practice", "(shell)", "patients", "RegistryConsole.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const stepCalls = [...consoleSrc.matchAll(/steps\(([^)]*)\)/g)].map(m => m[1]);
  ok("adaptive-4. ⚠ the screen calls steps() WITH the birth date and the day, not steps(mode) alone",
    stepCalls.length > 0 && stepCalls.every(a => a.split(",").length === 3),
    JSON.stringify(stepCalls));

  // ── A DUPLICATE CHECK THAT COULD NOT RUN IS NOT A DUPLICATE CHECK THAT PASSED ───────────────────
  //
  // ⚠ registerPatient discarded the error on its identifier-collision read. A failed query left `clash`
  // undefined, the loop fell through, and a SECOND record carrying somebody's hospital number was
  // created -- a split history in the place a clinician least expects one.
  //
  // The database is only a PARTIAL backstop, which is why this cannot be left to it:
  // ux_practice_identifier_live (migration 193) keys on type + value + ISSUER, while the engine check
  // deliberately ignores the issuer. The same number against two different issuers is caught here and
  // nowhere else.
  //
  // Injected through a stub, because a healthy database never takes this path -- which is precisely why
  // it survived. Every read the function reaches before the collision check must answer normally, so the
  // stub fails ONLY the identifier table.
  const failIdentifierReads = {
    from: (table: string) => {
      if (table !== "practice_patient_identifier") return admin.from(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "limit", "order"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: null, error: { message: "simulated collision-check failure" } });
      chain.single = async () => ({ data: null, error: { message: "simulated collision-check failure" } });
      // ⚠ THE STUB ANSWERS insert TOO, AND IT MUST. Without it the deliberate break did not FAIL dup-1
      // and dup-2 -- it threw "admin.from(...).insert is not a function" out of registerPatient and
      // killed the run, so no assertion reported and nothing said which guard had gone. A break that
      // crashes the harness proves less than one that reds a named assertion: you cannot tell the defect
      // you were testing for from an unrelated accident. Same lesson the planner harness learned when a
      // short week threw a TypeError instead of failing 3b.
      chain.insert = () => ({
        select: () => ({ single: async () => ({ data: null, error: { message: "simulated insert failure" } }) }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { message: "simulated insert failure" } }),
      });
      return chain;
    },
  };
  const beforeCount = await admin.from("practice_patient")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  const blind = await registerPatient(failIdentifierReads as never, {
    workspaceId: wsA, displayName: "Blind Duplicate", birthDate: born(30), phone: "+256772009911",
    identifiers: [{ type: "national_id", value: "CM-DUPLICATE-TEST" }],
    actorId: OWNER, correlationId: "harness-reg",
  });
  ok("dup-1. ⚠ a collision check that FAILED refuses the registration rather than proceeding blind",
    !blind.ok && blind.code === "DUPLICATE_CHECK_FAILED", JSON.stringify(blind));
  const afterCount = await admin.from("practice_patient")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("dup-2. ⚠ AND NO PATIENT WAS CREATED -- the refusal is the point, not the message",
    (afterCount.count ?? -1) === (beforeCount.count ?? -2),
    `${beforeCount.count} -> ${afterCount.count}`);

  // CONTROL. Without it, dup-1 and dup-2 pass just as well if registerPatient refused EVERY
  // registration -- which is what this fix looks like when it is one line too broad.
  const stillWorks = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Control Registers Fine", birthDate: born(31), phone: "+256772009912",
    identifiers: [{ type: "national_id", value: "CM-CONTROL-OK" }],
    actorId: OWNER, correlationId: "harness-reg",
  });
  ok("dup-control. the same call against the real client registers, and reports nothing incomplete",
    stillWorks.ok && stillWorks.data.incomplete.length === 0, JSON.stringify(stillWorks));

  // ── AND THE OTHER HALF: A WRITE THAT FAILED IS REPORTED, NOT SWALLOWED ──────────────────────────
  //
  // The identifier inserts discarded their errors too, and that is where the data actually went. When
  // the collision check could not run and the DATABASE caught the duplicate instead, the rejection was
  // thrown away: ok returned, patient created, hospital number silently absent -- and that number is
  // exactly what somebody later searches by.
  //
  // Registered here through the REAL client with a value that genuinely collides, so the unique index
  // does the rejecting rather than a stub pretending to.
  const collide = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Second Person Same Number", birthDate: born(32), phone: "+256772009913",
    identifiers: [{ type: "national_id", value: "CM-CONTROL-OK" }],
    confirmNew: true, actorId: OWNER, correlationId: "harness-reg",
  });
  ok("dup-3. a genuine identifier collision is REFUSED by the engine, naming the existing patient",
    !collide.ok && collide.code === "DUPLICATE_IDENTIFIER" && (collide.candidates?.length ?? 0) === 1,
    JSON.stringify(collide));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
