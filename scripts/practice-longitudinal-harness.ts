/**
 * Longitudinal patient record harness -- CPR-ENC-003, on migration 238.
 *
 * WHAT IT PROVES, and the two assertions the whole file exists for:
 *
 *   ⚠ 1. "NO KNOWN ALLERGIES" IS PRINTED ONLY WHEN SOMEBODY SAID SO.
 *        An empty allergy list means nobody has asked. Rendering that as "no known allergies" tells a
 *        prescriber a patient is safe when nothing is known -- and it would do so most confidently for
 *        the newest records, which are exactly the patients whose history is least known. Every state
 *        is asserted, INCLUDING the control that a `none_known` patient DOES read as none known: without
 *        it, a function that returned "not recorded" for everything would pass the safety assertions.
 *
 *   ⚠ 2. NOTHING DERIVES A MILESTONE.
 *        A whole encounter lifecycle is run -- launch, activate, note, diagnosis, treatment, procedure,
 *        investigation, referral, outcome, complete, sign -- and the milestone table is counted after
 *        it. It must be EMPTY. Then one is recorded explicitly and the count becomes one, so the
 *        assertion is about derivation rather than about the table being unreachable. A source scan
 *        backs it up: exactly one file in the codebase inserts into practice_patient_milestone.
 *
 * ALSO: the timeline's three states and its per-source failures; the journey filters; blood group;
 * cross-workspace isolation; anon denial.
 *
 *   npx --yes tsx scripts/practice-longitudinal-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment, setEncounterOutcome } from "../src/lib/practice/encounters";
import { recordProcedure } from "../src/lib/practice/procedures";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import {
  recordInvestigation, reviewInvestigation, recordReferral, updateReferralStatus, addDecision,
} from "../src/lib/practice/encounter-workspace";
import {
  patientSnapshot, clinicalTimeline, journeyCounts, recordMilestone, listMilestones,
  recordAllergyReview, addAllergy, setBloodGroup, problemHistory, treatmentHistory,
  procedureHistory, outcomeHistory, followUpHistory, LONGITUDINAL_CAPABILITIES, crossFacilityCare,
} from "../src/lib/practice/longitudinal";
import { allergyLine, bloodGroupLine, JOURNEY_FILTER_CODES, MILESTONE_KIND_CODES } from "../src/lib/practice/longitudinal-constants";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0f61";
const USER_B = "00000000-0000-4000-8000-0000000e0f62";

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
    idempotency_key: `harness-long-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-long",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-long", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-long" };

/** A client whose reads of ONE table fail and whose reads of everything else are real. */
function failingOn(table: string, message: string) {
  return {
    from: (t: string) => {
      if (t !== table) return admin.from(t);
      const chain: Record<string, unknown> = {};
      const result = { data: null, error: { message }, count: null };
      for (const m of ["select", "eq", "in", "order", "not", "is", "neq", "lt", "gt", "gte", "lte"]) chain[m] = () => chain;
      chain.limit = async () => result;
      chain.maybeSingle = async () => result;
      chain.single = async () => result;
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
  };
}

/**
 * Source with its COMMENTS REMOVED.
 *
 * Needed because this build's comments quote the very sentence the scan is hunting for -- the warning
 * that says "never print this from an empty list" contains the string "No known allergies", and a naive
 * grep flags the warning as the offence. Only block comments and whole-line `//` / `*` lines are
 * stripped, so string literals containing `//` (URLs) are left intact.
 */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

async function main() {
  console.log("\nLongitudinal patient record harness (CPR-ENC-003, migration 238)\n");
  await cleanup();

  // ── 0. Migration gate ─────────────────────────────────────────────────────
  const gate = await admin.from("practice_patient").select("allergy_status, blood_group").limit(1);
  ok("migration 238 is applied (allergy_status and blood_group are on practice_patient)", !gate.error,
    gate.error ? `${gate.error.message} -- run supabase/migrations/238-practice-encounter-longitudinal.sql` : "");
  const msGate = await admin.from("practice_patient_milestone").select("id").limit(1);
  ok("migration 238's milestone table is present", !msGate.error, msGate.error?.message ?? "");
  if (gate.error || msGate.error) { console.log("\n  Stopping: migration 238 is not applied.\n"); return report(); }

  // ── 1. ⚠ THE ALLERGY THREE-STATE, AS A PURE FUNCTION ──────────────────────
  //
  // The fixtures are arranged so that the WRONG answer is the one a careless implementation gives: an
  // empty list under `not_recorded` is exactly the shape that would print "No known allergies" if the
  // sentence were chosen from the list length.
  const nobodyAsked = allergyLine({ status: "not_recorded", count: 0, unavailable: false });
  ok("allergy-1. ⚠ an EMPTY list with status `not_recorded` does NOT read as no known allergies",
    nobodyAsked.tone === "unknown" && nobodyAsked.safeToRead === false && !/no known/i.test(nobodyAsked.text),
    JSON.stringify(nobodyAsked));

  const nullStatus = allergyLine({ status: null, count: 0, unavailable: false });
  ok("allergy-2. a NULL status is treated as not recorded, not as reassurance",
    nullStatus.tone === "unknown" && !/no known/i.test(nullStatus.text), JSON.stringify(nullStatus));

  // ⚠ THE CONTROL. Without it, a function that returned "not recorded" for every input would pass every
  // assertion above -- and the field would be safe and useless.
  const declaredNone = allergyLine({ status: "none_known", count: 0, unavailable: false, reviewedAt: "2026-08-01T09:00:00Z" });
  ok("allergy-3. CONTROL: a patient explicitly marked `none_known` DOES read as no known allergies",
    declaredNone.tone === "none" && declaredNone.safeToRead === true && /no known allergies/i.test(declaredNone.text),
    JSON.stringify(declaredNone));
  ok("allergy-4. and it carries WHEN somebody said so", /2026-08-01/.test(declaredNone.text), declaredNone.text);

  const listed = allergyLine({ status: "recorded", count: 2, unavailable: false });
  ok("allergy-5. a patient with recorded allergies reads as having them and is never `safeToRead`",
    listed.tone === "present" && listed.safeToRead === false && /2 recorded/.test(listed.text), JSON.stringify(listed));

  const contradiction = allergyLine({ status: "recorded", count: 0, unavailable: false });
  ok("allergy-6. `recorded` with an empty list is reported as a contradiction, not downgraded to reassurance",
    contradiction.tone === "unknown" && contradiction.safeToRead === false && !/no known/i.test(contradiction.text),
    JSON.stringify(contradiction));

  const unreadable = allergyLine({ status: "none_known", count: null, unavailable: true });
  ok("allergy-7. ⚠ a FAILED read is its own answer, even when the status column said none known",
    unreadable.tone === "unreadable" && unreadable.safeToRead === false && !/no known/i.test(unreadable.text),
    JSON.stringify(unreadable));

  const listUnreadable = allergyLine({ status: "recorded", count: null, unavailable: false });
  ok("allergy-8. `recorded` whose LIST could not be read says so rather than counting nought",
    listUnreadable.tone === "unreadable", JSON.stringify(listUnreadable));

  ok("allergy-9. blood group: null is \"not recorded\", never a blank that reads as fine",
    bloodGroupLine({ value: null, unavailable: false }).tone === "unknown"
    && /not recorded/i.test(bloodGroupLine({ value: null, unavailable: false }).text));
  ok("allergy-10. CONTROL: a known blood group comes back as itself",
    bloodGroupLine({ value: "O+", unavailable: false }).text === "O+");

  // ── 2. THE SOURCE RULE ────────────────────────────────────────────────────
  //
  // The sentence must come from allergyLine and from nowhere else. A component that looked at the list
  // length and chose its own words would be a second place, and the second place is the one that gets
  // it wrong.
  const tree = walk(join(process.cwd(), "src", "app", "practice"));
  const handRolled = tree.filter(f => /No known allergies/i.test(withoutComments(readFileSync(f, "utf8"))));
  ok("src-1. ⚠ no page in the Practice tree writes the words \"No known allergies\" itself",
    handRolled.length === 0, handRolled.join(", "));
  ok("src-2. control: the scan is reading real files", tree.length > 20, `${tree.length} files`);
  // The scan must be able to SEE the sentence when it is there in code, or src-1 passes for nothing.
  ok("src-2b. control: the comment-stripping scan still finds the sentence where it IS code",
    /No known allergies/i.test(withoutComments(
      readFileSync(join(process.cwd(), "src/lib/practice/longitudinal-constants.ts"), "utf8"))));

  // ⚠ WHERE THE SENTENCE MAY LIVE, NAMED RATHER THAN COUNTED.
  //   longitudinal-constants.ts  produces it, from the allergy_status column, in one pure function.
  //   calendar.ts                NAMES it in its disclosure register, as a line the calendar drawer
  //                              deliberately does not print. Naming a refusal is not making the claim.
  // Any third file is a second place that decides what a prescriber reads, and the second place is the
  // one that gets it wrong.
  const libFiles = walk(join(process.cwd(), "src", "lib", "practice"));
  const sentenceOwners = libFiles
    .filter(f => /No known allergies/i.test(withoutComments(readFileSync(f, "utf8"))))
    .map(f => f.split(/[\\/]/).pop() ?? f)
    .sort();
  ok("src-3. the sentence lives in exactly two named places: the function that produces it, and the register that refuses it",
    sentenceOwners.length === 2
    && sentenceOwners.includes("longitudinal-constants.ts")
    && sentenceOwners.includes("calendar.ts"),
    sentenceOwners.join(", "));

  // ⚠ AND THE MILESTONE WRITER. One inserter, in one file.
  const allSrc = libFiles
    .concat(walk(join(process.cwd(), "src", "app", "api", "v1", "practice")))
    .concat(tree);
  const milestoneWriters = allSrc.filter(f =>
    /from\("practice_patient_milestone"\)[\s\S]{0,120}\.insert\(/.test(readFileSync(f, "utf8")));
  ok("src-4. ⚠ exactly ONE file inserts into practice_patient_milestone, and it is longitudinal.ts",
    milestoneWriters.length === 1 && /longitudinal\.ts$/.test(milestoneWriters[0]),
    milestoneWriters.join(", "));

  // ── The live half ─────────────────────────────────────────────────────────
  const wsA = await provision(USER_A, "HARNESS Longitudinal A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Longitudinal B (synthetic)", "b");
  const ctxARes = await resolveWorkspaceContext(admin, USER_A, wsA);
  const ctxBRes = await resolveWorkspaceContext(admin, USER_B, wsB);
  if (!ctxARes.ok || !ctxBRes.ok) { ok("workspace contexts resolve", false); return report(); }
  const ctxA: WorkspaceContext = ctxARes.ctx;
  const ctxB: WorkspaceContext = ctxBRes.ctx;

  const invented = LONGITUDINAL_CAPABILITIES.filter(c => !["patient.view", "patient.edit", "encounter.list", "followup.view"].includes(c));
  ok("cap-0. the exported capability list is the one this harness checks", invented.length === 0, invented.join(","));
  const { data: seeded } = await admin.from("practice_role_capabilities").select("capability_code");
  const known = new Set(((seeded ?? []) as { capability_code: string }[]).map(c => c.capability_code));
  ok("cap-1. every capability the longitudinal engine gates on exists in practice_role_capabilities",
    LONGITUDINAL_CAPABILITIES.every(c => known.has(c)),
    LONGITUDINAL_CAPABILITIES.filter(c => !known.has(c)).join(", "));

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Sarah", birthDate: "2017-04-01", sex: "female",
    phone: "0772 555 310", ...base,
  });
  if (!pa.ok) { ok("patient registration for the harness succeeded", false, pa.message); return report(); }
  const patient = pa.data.id;

  // ── 3. A NEW PATIENT READS AS "NOBODY HAS ASKED" ──────────────────────────
  const fresh = await patientSnapshot(admin, ctxA, patient);
  ok("snap-1. ⚠ a brand new patient's allergy line says nobody has asked, not \"no known allergies\"",
    fresh.allergies.tone === "unknown" && fresh.allergies.safeToRead === false
    && !/no known/i.test(fresh.allergies.text) && fresh.allergyList.items.length === 0,
    JSON.stringify(fresh.allergies));
  ok("snap-2. and their blood group reads as not recorded",
    fresh.bloodGroup.tone === "unknown" && /not recorded/i.test(fresh.bloodGroup.text), fresh.bloodGroup.text);

  const review = await recordAllergyReview(admin, ctxA, { patientId: patient, status: "none_known", ...base });
  const afterAsking = await patientSnapshot(admin, ctxA, patient);
  ok("snap-3. CONTROL: once a practitioner records `none known`, the screen DOES say so",
    review.ok && afterAsking.allergies.tone === "none" && afterAsking.allergies.safeToRead === true
    && /no known allergies/i.test(afterAsking.allergies.text),
    review.ok ? JSON.stringify(afterAsking.allergies) : review.message);

  const allergy = await addAllergy(admin, ctxA, { patientId: patient, substance: "Penicillin", reaction: "rash", severity: "moderate", ...base });
  const afterAllergy = await patientSnapshot(admin, ctxA, patient);
  ok("snap-4. adding an allergy moves the status off `none known` in the same act",
    allergy.ok && afterAllergy.allergies.tone === "present" && afterAllergy.allergies.safeToRead === false,
    allergy.ok ? JSON.stringify(afterAllergy.allergies) : allergy.message);

  const backToNone = await recordAllergyReview(admin, ctxA, { patientId: patient, status: "none_known", ...base });
  ok("snap-5. ⚠ `none known` is REFUSED while an allergy is listed (reassurance over evidence)",
    !backToNone.ok && backToNone.code === "ALLERGIES_LISTED", backToNone.ok ? "was allowed" : backToNone.code);

  const blood = await setBloodGroup(admin, ctxA, { patientId: patient, bloodGroup: "O+", ...base });
  const badBlood = await setBloodGroup(admin, ctxA, { patientId: patient, bloodGroup: "Z-", ...base });
  const afterBlood = await patientSnapshot(admin, ctxA, patient);
  ok("snap-6. a blood group records, and an invented one is refused",
    blood.ok && !badBlood.ok && afterBlood.bloodGroup.text === "O+", JSON.stringify({ b: blood.ok, bad: badBlood.ok }));

  // A caller who cannot see patients gets `permitted: false`, which is not "this patient has nothing".
  const blindCtx: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "patient.view") };
  const noPermission = await patientSnapshot(admin, blindCtx, patient);
  ok("snap-7. a caller without patient.view gets permitted:false and an UNREADABLE allergy line",
    noPermission.permitted === false && noPermission.allergies.tone === "unreadable"
    && !/no known/i.test(noPermission.allergies.text),
    JSON.stringify({ p: noPermission.permitted, a: noPermission.allergies.tone }));

  // ── 4. ⚠ A WHOLE ENCOUNTER LIFECYCLE WRITES NO MILESTONE ──────────────────
  const enc = await launchEncounter(admin, { workspaceId: wsA, patientId: patient, pathway: "booked", reasonForVisit: "seizure review", ...base });
  if (!enc.ok) { ok("an encounter launches", false, enc.message); return report(); }
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "ACTIVE", ...base });
  const dx = await recordDiagnosis(admin, { workspaceId: wsA, encounterId: enc.data.id, label: "Epilepsy", certainty: "confirmed", isPrimary: true, problemLabel: "Epilepsy", ...base });
  await recordTreatment(admin, { workspaceId: wsA, encounterId: enc.data.id, treatmentType: "medication", label: "Levetiracetam", dose: "750mg", frequency: "BD", ...base });
  const procedure = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: enc.data.id, label: "Ventriculoperitoneal shunt",
    consentStatus: "obtained", status: "PERFORMED", ...base,
  });
  // ⚠ EVERY WRITE ENGINE IS EXERCISED HERE, and that is the point rather than thoroughness for its own
  // sake. life-2 below asserts that none of them derived a milestone -- and an engine the lifecycle
  // never calls is an engine the assertion cannot see. addDecision was missing from this list, and a
  // deliberate break that made addDecision write a milestone left life-2 GREEN: the right answer and the
  // wrong answer coincided, and the assertion passed for nothing.
  const investigation = await recordInvestigation(admin, { workspaceId: wsA, encounterId: enc.data.id, label: "EEG (routine)", ...base });
  if (investigation.ok) {
    await reviewInvestigation(admin, {
      workspaceId: wsA, encounterId: enc.data.id, investigationId: investigation.data.id,
      summary: "Abnormal - continue medication", ...base,
    });
  }
  const referral = await recordReferral(admin, { workspaceId: wsA, encounterId: enc.data.id, referredTo: "Dr Okello", reason: "second opinion", ...base });
  if (referral.ok) await updateReferralStatus(admin, { workspaceId: wsA, referralId: referral.data.id, status: "accepted", ...base });
  const decision = await addDecision(admin, { workspaceId: wsA, encounterId: enc.data.id, decision: "Continue levetiracetam 750mg BD", ...base });
  await createFollowUp(admin, {
    workspaceId: wsA, patientId: patient, originEncounterId: enc.data.id,
    reason: "Review seizure control", kind: "review", intervalCode: "3m", ...base,
  });
  await setEncounterOutcome(admin, { workspaceId: wsA, encounterId: enc.data.id, outcome: "improved", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "COMPLETED", ...base });
  const signed = await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "SIGNED", ...base });

  ok("life-1. the whole lifecycle ran (diagnosis, procedure, decision, referral and signature all landed)",
    dx.ok && procedure.ok && decision.ok && referral.ok && investigation.ok && signed.ok,
    [dx, procedure, decision, referral, investigation, signed]
      .filter(r => !r.ok).map(r => (r as { message: string }).message).join(" | "));

  const { count: derived, error: msErr } = await admin.from("practice_patient_milestone")
    .select("id", { count: "exact", head: true }).eq("patient_id", patient);
  ok("life-2. ⚠ NOTHING DERIVED A MILESTONE from a complete, signed encounter",
    !msErr && (derived ?? -1) === 0, msErr ? msErr.message : `${derived} milestone(s) appeared`);

  const explicit = await recordMilestone(admin, ctxA, {
    patientId: patient, kind: "surgery_performed", label: "VP shunt inserted",
    occurredOn: "2026-03-15", encounterId: enc.data.id, ...base,
  });
  const after = await listMilestones(admin, ctxA, patient);
  ok("life-3. CONTROL: an EXPLICIT call does write one (the table is reachable, so life-2 means something)",
    explicit.ok && after.items.length === 1 && after.items[0].label === "VP shunt inserted",
    explicit.ok ? JSON.stringify(after.items) : explicit.message);
  ok("life-4. and it carries the name of whoever recorded it",
    after.items[0]?.createdBy === USER_A, JSON.stringify(after.items[0]));

  const inventedKind = await recordMilestone(admin, ctxA, {
    patientId: patient, kind: "doing_nicely", label: "x", occurredOn: "2026-03-15", ...base,
  });
  ok("life-5. a milestone kind outside the closed list is refused",
    !inventedKind.ok && inventedKind.code === "VALIDATION_ERROR", inventedKind.ok ? "was allowed" : inventedKind.code);
  ok("life-6. the closed list is the specification's eight plus `other`",
    MILESTONE_KIND_CODES.length === 9 && MILESTONE_KIND_CODES.includes("significant_improvement")
    && MILESTONE_KIND_CODES.includes("relapse"), MILESTONE_KIND_CODES.join(","));

  const noDate = await recordMilestone(admin, ctxA, { patientId: patient, kind: "relapse", label: "x", occurredOn: "soon", ...base });
  ok("life-7. a milestone without a real date is refused",
    !noDate.ok && noDate.code === "VALIDATION_ERROR", noDate.ok ? "was allowed" : noDate.code);

  const foreign = await recordMilestone(admin, ctxB, {
    patientId: patient, kind: "relapse", label: "x", occurredOn: "2026-03-15", ...base,
  });
  ok("life-8. workspace B cannot record a milestone against workspace A's patient",
    !foreign.ok && foreign.code === "NOT_FOUND", foreign.ok ? "was allowed" : foreign.code);

  const noEditCtx: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "patient.edit") };
  const unauthorised = await recordMilestone(admin, noEditCtx, {
    patientId: patient, kind: "relapse", label: "x", occurredOn: "2026-03-15", ...base,
  });
  ok("life-9. a caller without patient.edit cannot record one",
    !unauthorised.ok && unauthorised.code === "FORBIDDEN", unauthorised.ok ? "was allowed" : unauthorised.code);

  // ── 5. THE TIMELINE ───────────────────────────────────────────────────────
  const timeline = await clinicalTimeline(admin, ctxA, patient);
  const kinds = new Set<string>(timeline.events.map(e => e.kind));
  ok("tl-1. the timeline merges every stream the specification lists",
    ["encounters", "procedures", "investigations", "referrals", "follow_ups", "milestones"].every(k => kinds.has(k)),
    [...kinds].join(","));
  ok("tl-2. nothing failed and nothing was denied on a full-capability read",
    timeline.unavailable === false && timeline.permitted === true
    && timeline.sourcesUnavailable.length === 0 && timeline.sourcesDenied.length === 0,
    JSON.stringify({ u: timeline.sourcesUnavailable, d: timeline.sourcesDenied }));

  const encEvent = timeline.events.find(e => e.kind === "encounters");
  ok("tl-3. the encounter event carries its diagnoses, its treatment and its outcome",
    !!encEvent && /Epilepsy/.test(encEvent.detail ?? "") && /Levetiracetam/.test(encEvent.detail ?? "")
    && encEvent.tags.some(t => /outcome: improved/.test(t)),
    JSON.stringify({ d: encEvent?.detail, t: encEvent?.tags }));

  // ⚠ AN OUTCOME THAT WAS NEVER RECORDED MUST NOT APPEAR AS ONE.
  const enc2 = await launchEncounter(admin, { workspaceId: wsA, patientId: patient, pathway: "walk_in_followup", reasonForVisit: "no outcome recorded", ...base });
  const timeline2 = await clinicalTimeline(admin, ctxA, patient);
  const noOutcomeEvent = timeline2.events.find(e => e.kind === "encounters" && e.title === "no outcome recorded");
  ok("tl-4. ⚠ an encounter with NO outcome shows no outcome tag (a missing outcome is not \"stable\")",
    enc2.ok && !!noOutcomeEvent && !noOutcomeEvent.tags.some(t => /outcome/.test(t)),
    JSON.stringify(noOutcomeEvent?.tags));

  // ⚠ THE MOST DANGEROUS EMPTY LIST IN THIS PRODUCT.
  const blindTimeline = await clinicalTimeline(failingOn("practice_encounter", "simulated encounter failure") as never, ctxA, patient);
  ok("tl-5. ⚠ a failed ENCOUNTER read reports unavailable and does NOT read as a patient with no history",
    blindTimeline.unavailable === true && blindTimeline.permitted === true && blindTimeline.events.length === 0
    && /simulated encounter failure/.test(blindTimeline.detail ?? ""),
    JSON.stringify(blindTimeline));

  // A failed SIDE stream is reported by name and does not empty the timeline -- a different claim.
  const partial = await clinicalTimeline(failingOn("practice_referral", "simulated referral failure") as never, ctxA, patient);
  ok("tl-6. a failed REFERRAL read names the source and leaves the encounters intact",
    partial.unavailable === false && partial.sourcesUnavailable.includes("referrals")
    && partial.events.some(e => e.kind === "encounters")
    && !partial.events.some(e => e.kind === "referrals"),
    JSON.stringify({ u: partial.sourcesUnavailable, n: partial.events.length }));

  const noFollowUpCtx: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "followup.view") };
  const denied = await clinicalTimeline(admin, noFollowUpCtx, patient);
  ok("tl-7. a stream the caller may not see is `denied`, not `unavailable` (different sentence, different action)",
    denied.sourcesDenied.includes("follow_ups") && !denied.sourcesUnavailable.includes("follow_ups")
    && !denied.events.some(e => e.kind === "follow_ups"),
    JSON.stringify({ d: denied.sourcesDenied, u: denied.sourcesUnavailable }));

  const noEncounterCtx: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "encounter.list") };
  const blocked = await clinicalTimeline(admin, noEncounterCtx, patient);
  ok("tl-8. a caller without encounter.list gets permitted:false, not unavailable",
    blocked.permitted === false && blocked.unavailable === false, JSON.stringify({ p: blocked.permitted, u: blocked.unavailable }));

  const foreignTimeline = await clinicalTimeline(admin, ctxB, patient);
  ok("tl-9. workspace B reads an EMPTY timeline for workspace A's patient",
    foreignTimeline.events.length === 0 && foreignTimeline.unavailable === false, `${foreignTimeline.events.length}`);

  ok("tl-10. every journey filter code matches a kind the engine can emit, or is `all`",
    JOURNEY_FILTER_CODES.filter(c => c !== "all" && c !== "problems" && c !== "treatments")
      .every(c => kinds.has(c)),
    `${[...kinds].join(",")} vs ${JOURNEY_FILTER_CODES.join(",")}`);

  // ── 6. THE HISTORIES ──────────────────────────────────────────────────────
  const [probs, treats, procs, outs, fups] = await Promise.all([
    problemHistory(admin, ctxA, patient), treatmentHistory(admin, ctxA, patient),
    procedureHistory(admin, ctxA, patient), outcomeHistory(admin, ctxA, patient),
    followUpHistory(admin, ctxA, patient),
  ]);
  ok("hist-1. every longitudinal history returns its rows",
    probs.items.length === 1 && treats.items.length === 1 && procs.items.length === 1
    && outs.items.length === 1 && fups.items.length === 1,
    JSON.stringify({ p: probs.items.length, t: treats.items.length, pr: procs.items.length, o: outs.items.length, f: fups.items.length }));
  ok("hist-2. ⚠ the outcome history holds ONLY encounters where an outcome was chosen",
    outs.items.length === 1 && outs.items[0].outcome === "improved", JSON.stringify(outs.items));

  const blindProblems = await problemHistory(failingOn("practice_problem", "simulated problem failure") as never, ctxA, patient);
  ok("hist-3. a failed history read says unavailable rather than returning an empty history",
    blindProblems.unavailable === true && blindProblems.items.length === 0 && blindProblems.permitted === true,
    JSON.stringify(blindProblems));

  const counts = await journeyCounts(admin, ctxA, patient);
  ok("hist-4. the journey counts are counts and dates, nothing derived",
    counts.encounters === 2 && counts.closed === 1 && !!counts.firstSeen && !!counts.lastSeen,
    JSON.stringify(counts));
  const blindCounts = await journeyCounts(failingOn("practice_encounter", "boom") as never, ctxA, patient);
  ok("hist-5. and a failed count is null, not nought",
    blindCounts.unavailable === true && blindCounts.encounters === null, JSON.stringify(blindCounts));

  // ── 7. ANON ───────────────────────────────────────────────────────────────
  const TABLES = ["practice_patient_milestone", "practice_patient_allergy"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("rls-1. the service role sees rows in both new patient tables (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("rls-2. anon reads 0 rows from both", leaked === 0, `${leaked} table(s) leaked`);


  // ── tl-P. THE FACILITY STORY: CPR-OPT-001 D15 ──────────────────────────────────────────────────
  //
  // ⚠ THE ONE THING NO SINGLE-SITE EMR CAN SHOW, AND THE PRODUCT STORED IT WITHOUT SHOWING IT.
  // The backlog: "the timeline should READ 'Aga Khan - 12 Mar -> Nairobi Hospital - 4 Jun'. That
  // visual is the product demo. Today it is a column, not a story."
  //
  // ⚠ THE FIXTURE NEEDS TWO FACILITIES OR IT PROVES NOTHING. One hospital and every chip reads the
  // same, so an implementation that stamped a constant would pass. Two, and the wrong answer and the
  // right answer are different strings on different rows.
  // ⚠ facility_type, NOT type -- AND THE `!` I FIRST WROTE HERE TURNED THAT TYPO INTO A TypeError.
  // practice_facility (migration 222) names the column facility_type; practice_location names its own
  // one `type`. The insert was refused for an unknown column, the error was discarded, and `facAga!.id`
  // crashed with "Cannot read properties of null" -- the third time this session a non-null assertion
  // has turned a discarded error into a crash instead of a sentence. Captured and asserted now.
  const facAgaRes = await admin.from("practice_facility")
    .insert({ workspace_id: wsA, name: "Aga Khan University Hospital", facility_type: "hospital" })
    .select("id").single();
  const facNboRes = await admin.from("practice_facility")
    .insert({ workspace_id: wsA, name: "Nairobi Hospital", facility_type: "hospital" })
    .select("id").single();
  ok("tl-P-fixture-a. two facilities record",
    !!facAgaRes.data?.id && !!facNboRes.data?.id,
    facAgaRes.error?.message ?? facNboRes.error?.message ?? "");
  if (!facAgaRes.data || !facNboRes.data) return report();
  const locAgaRes = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Paediatric clinic 2", type: "hospital", active: true, facility_id: facAgaRes.data.id })
    .select("id").single();
  const locNboRes = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Outpatients", type: "hospital", active: true, facility_id: facNboRes.data.id })
    .select("id").single();
  ok("tl-P-fixture-b. and a location inside each",
    !!locAgaRes.data?.id && !!locNboRes.data?.id,
    locAgaRes.error?.message ?? locNboRes.error?.message ?? "");
  if (!locAgaRes.data || !locNboRes.data) return report();

  // ⚠ EACH VISIT MUST BE CLOSED BEFORE THE NEXT CAN OPEN, AND MY FIRST FIXTURE IGNORED THAT.
  // launchEncounter RESUMES rather than creates when the patient already has a live encounter -- its
  // own "Resume before create" rule -- so two back-to-back launches returned the SAME row, both
  // location stamps landed on it, and the last one won. The symptom was the unplaced encounter wearing
  // "Nairobi Hospital", which is the fixture describing a patient who was never at two hospitals.
  //
  // Completing between visits is also what actually happens: a patient seen in March and again in June
  // has a closed March consultation.
  const closeLive = async () => {
    const { data: live } = await admin.from("practice_encounter").select("id, status")
      .eq("workspace_id", wsA).eq("patient_id", patient).in("status", ["DRAFT", "ACTIVE", "PAUSED"]);
    for (const l of ((live ?? []) as any[])) {
      if (l.status === "DRAFT") await transitionEncounter(admin, { workspaceId: wsA, encounterId: l.id, to: "ACTIVE", ...base });
      await transitionEncounter(admin, { workspaceId: wsA, encounterId: l.id, to: "COMPLETED", ...base });
    }
  };
  await closeLive();
  const encAga = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patient, pathway: "booked", reasonForVisit: "seen at Aga Khan", ...base,
  });
  ok("tl-P-fixture-c. the Aga Khan visit is a NEW encounter, not a resumed one",
    encAga.ok && encAga.data.resumed === false, JSON.stringify(encAga));
  await closeLive();
  const encNbo = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patient, pathway: "booked", reasonForVisit: "seen at Nairobi", ...base,
  });
  ok("tl-P-fixture-d. and so is the Nairobi visit -- two visits, two rows",
    encNbo.ok && encNbo.data.resumed === false && encNbo.data.id !== (encAga.ok ? encAga.data.id : ""),
    JSON.stringify(encNbo));
  // Stamped directly: launchEncounter inherits the place from the running ACTIVITY, and this fixture is
  // testing the RESOLVER rather than the inheritance -- which practice-activity-harness already owns.
  if (encAga.ok) await admin.from("practice_encounter").update({ location_id: locAgaRes.data.id }).eq("id", encAga.data.id);
  if (encNbo.ok) await admin.from("practice_encounter").update({ location_id: locNboRes.data.id }).eq("id", encNbo.data.id);

  const placed = await clinicalTimeline(admin, ctxA, patient);
  const agaEvent = placed.events.find(e => e.title === "seen at Aga Khan");
  const nboEvent = placed.events.find(e => e.title === "seen at Nairobi");
  ok("tl-P1. ⚠ each consultation carries WHERE IT HAPPENED, and the two read differently",
    agaEvent?.tags.includes("Aga Khan University Hospital") === true
    && nboEvent?.tags.includes("Nairobi Hospital") === true,
    JSON.stringify({ aga: agaEvent?.tags, nbo: nboEvent?.tags }));
  // ⚠ THE FACILITY, NOT THE ROOM. "Clinic 2" does not distinguish one hospital from another on a
  // peripatetic week, and a chip reading it would be worse than no chip.
  ok("tl-P2. the chip names the FACILITY rather than the room inside it",
    agaEvent?.tags.includes("Paediatric clinic 2") === false,
    JSON.stringify(agaEvent?.tags));
  // ⚠ THE PLACE LEADS, because it is what a practitioner scans the week by.
  ok("tl-P3. and it is the FIRST chip, ahead of the pathway and the mode",
    agaEvent?.tags[0] === "Aga Khan University Hospital", JSON.stringify(agaEvent?.tags));
  // ⚠ AND A CONSULTATION NOBODY PLACED GETS NO CHIP AT ALL -- not "unknown", not "no facility". The
  // original encounter in this fixture has no location, and a placeholder on every row of a
  // single-site practice is noise that teaches people to stop reading the chips.
  const unplaced = placed.events.find(e => e.kind === "encounters" && e.title === "no outcome recorded");
  ok("tl-P4. ⚠ a consultation nobody placed carries NO place chip, rather than an invented one",
    !!unplaced && !unplaced.tags.some(t => /unknown|no facility|unplaced/i.test(t))
    && unplaced.tags.length === 2,
    JSON.stringify(unplaced?.tags));
  // ⚠ CONTROL: a FAILED place read is not the same as an unplaced consultation, and says so.
  const blindPlaces = await clinicalTimeline(
    failingOn("practice_facility", "simulated facility failure") as never, ctxA, patient);
  ok("tl-P5. ⚠ a failed PLACE read is named, so the screen can say the places are missing",
    blindPlaces.sourcesUnavailable.includes("places"),
    JSON.stringify(blindPlaces.sourcesUnavailable));

  // ── tl-X. CROSS-FACILITY CARE: CPR-OPT-001 D17, SURFACED AND NOT JUDGED ────────────────────────
  //
  // ⚠⚠ THE ASSERTION THAT MATTERS MOST HERE IS AN ABSENCE. The backlog asks for "you started X at
  // Hospital A; Hospital B has them on Y" and this is the easiest place in the product to invent a
  // clinical claim -- deciding two treatments CONFLICT is a judgement about medicine, and nothing here
  // is qualified to make it. Same drug at two doses may be a taper. Two drugs for one problem may be
  // deliberate. So tl-X4 asserts that no field ANYWHERE in the payload carries that vocabulary, which
  // is what stops a screen rendering a flag nobody is entitled to.
  const cross = await crossFacilityCare(admin, ctxA, patient);
  ok("tl-X1. ⚠ the same patient is shown as seen at MORE THAN ONE place -- what no single-site EMR can do",
    cross.permitted && !cross.unavailable && cross.multiSite === true && cross.places.length === 2,
    JSON.stringify({ multi: cross.multiSite, places: cross.places.map(pl => pl.facility) }));
  ok("tl-X2. each place carries what was recorded there, and when it was first and last seen",
    cross.places.every(pl => /^\d{4}-\d{2}-\d{2}$/.test(pl.firstSeen) && /^\d{4}-\d{2}-\d{2}$/.test(pl.lastSeen)
      && pl.encounters > 0),
    JSON.stringify(cross.places.map(pl => ({ f: pl.facility, n: pl.encounters, first: pl.firstSeen, last: pl.lastSeen }))));
  // ⚠ MOST RECENT FIRST -- the place a practitioner is asking about is usually the last one.
  ok("tl-X3. the places are ordered by when the patient was last seen there",
    cross.places.length < 2 || cross.places[0].lastSeen >= cross.places[1].lastSeen,
    JSON.stringify(cross.places.map(pl => [pl.facility, pl.lastSeen])));
  // ⚠ THE WHOLE PAYLOAD, SERIALISED, MUST NOT CONTAIN A JUDGEMENT. A field added later called
  // `conflict` or `severity` would fail this without anybody having to remember the rule.
  ok("tl-X4. ⚠⚠ NOTHING IN THE PAYLOAD JUDGES -- no conflict, discrepancy, severity, mismatch or flag",
    !/conflict|discrepan|severity|mismatch|flagged|warning|risk/i.test(JSON.stringify(cross)),
    JSON.stringify(cross).slice(0, 160));
  // ⚠ CARE THE PRODUCT CANNOT PLACE IS COUNTED, NEVER DROPPED. Grouping by place silently loses every
  // consultation with no facility, and a panel showing two hospitals while omitting a third of the
  // record is worse than no panel. This fixture HAS unplaced consultations, so the count is non-zero
  // and the assertion is not vacuous.
  ok("tl-X5. ⚠ consultations the product cannot place are COUNTED and disclosed, not omitted",
    cross.unplacedEncounters > 0 && typeof cross.unplacedTreatments === "number",
    JSON.stringify({ enc: cross.unplacedEncounters, tx: cross.unplacedTreatments }));
  // ⚠ A FAILED READ MUST NOT READ AS "SEEN AT ONE HOSPITAL". Every consultation would resolve to null,
  // multiSite would be false, and the panel would vanish -- which is the answer a single-site patient
  // gets, and the two are not the same fact.
  const crossBlind = await crossFacilityCare(
    failingOn("practice_facility", "simulated facility failure") as never, ctxA, patient);
  ok("tl-X6. ⚠ a failed place read says UNAVAILABLE rather than quietly reporting one site",
    crossBlind.unavailable === true && crossBlind.multiSite === false && crossBlind.detail !== null,
    JSON.stringify({ u: crossBlind.unavailable, m: crossBlind.multiSite, d: crossBlind.detail }));
  // ⚠ AND A CALLER WHO MAY NOT SEE CONSULTATIONS IS REFUSED, not shown an empty practice.
  const crossDenied = await crossFacilityCare(admin, noEncounterCtx, patient);
  ok("tl-X7. a caller without encounter.list is refused rather than told the patient has no history",
    crossDenied.permitted === false && crossDenied.unavailable === false,
    JSON.stringify(crossDenied));

  // ⚠ AND A SCREEN ACTUALLY READS IT. The engine carrying a payload proves nothing about the page a
  // practitioner looks at -- that gap is the defect this session has now found four times, most
  // recently on the duplicate-candidate list. Checked as SOURCE because the patient record renders
  // only behind a signed-in practice session this harness has no way to mint.
  const recordPage = readFileSync(join(process.cwd(),
    "src", "app", "practice", "(shell)", "encounters", "record", "[patientId]", "page.tsx"), "utf8");
  ok("tl-X8. the patient record loads crossFacilityCare and renders it only when multiSite",
    /crossFacilityCare\(admin, shell\.ctx, patientId\)/.test(recordPage)
    && /crossFacility\.multiSite &&/.test(recordPage),
    "the panel is not wired, or renders for a single-site patient");
  // ⚠ THE COPY MUST NOT JUDGE EITHER. tl-X4 holds the payload to that; a screen can still write the
  // sentence the engine refused to carry, and this is what stops it.
  ok("tl-X9. ⚠⚠ and the PANEL COPY judges no more than the payload does",
    !/conflict|discrepan|mismatch|check this|attention|warning/i.test(
      (recordPage.match(/Seen at \{crossFacility[\s\S]{0,2600}?<\/section>/) ?? [""])[0]),
    "the panel renders a judgement the engine deliberately does not make");
  // ⚠ AND THE FAILED-READ BRANCH IS ON THE PAGE. Without it a broken place read renders as nothing at
  // all, which is what a single-site patient sees -- the exact confusion tl-X6 exists to prevent.
  ok("tl-X10. the page distinguishes a failed place read from a single-site patient",
    /crossFacility.permitted && crossFacility.unavailable/.test(recordPage),
    "a failed read would render as an absent panel");

  await cleanup();
  const { count: left } = await admin.from("practice_patient_milestone")
    .select("*", { count: "exact", head: true }).eq("patient_id", patient);
  ok("synthetic data cleaned up (cascade)", (left ?? 0) === 0, `${left}`);

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
