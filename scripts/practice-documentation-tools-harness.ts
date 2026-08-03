/**
 * Practice documentation-tools harness -- CPR-130's autosave, smart text, calculators and attachments.
 * Migration 207.
 *
 * WHAT IT PROVES:
 *   1. A DRAFT IS NOT A VERSION. Autosaving twenty times writes NO version history; the deliberate save
 *      writes exactly one. This is the whole reason autosave was refused, and the reason it is now
 *      buildable.
 *   2. A DRAFT IS DELETED THE MOMENT ITS TEXT REACHES A VERSION -- enforced in saveNoteSegment, not left
 *      to whoever remembers to tidy up.
 *   3. A DRAFT IS PRIVATE TO ITS AUTHOR. Two clinicians typing into the same consultation do not
 *      overwrite each other, and neither can read the other's unsaved text -- there is no parameter that
 *      would let them.
 *   4. A SIGNED CONSULTATION TAKES NO DRAFTS, so text cannot accumulate where it can never be saved.
 *   5. SMART TEXT EXPANDS ONLY A STANDALONE SHORTCUT. A rule that rewrote arbitrary substrings of a
 *      clinical note would be the most alarming feature in this product; asserted against a note that
 *      contains the shortcut inside a word.
 *   6. A PERSONAL SHORTCUT SHADOWS A SHARED ONE of the same name.
 *   7. THE CALCULATORS ARE CORRECT against published reference values, and EVERY RESULT CARRIES ITS
 *      INPUTS into the note -- the safety property the whole module turns on.
 *   8. UNITS ARE NEVER GUESSED: the same creatinine in mg/dL and umol/L gives the same eGFR only when
 *      the unit is declared, and the equation refuses a child.
 *   9. AN ATTACHMENT IS REMOVED, NOT ERASED: the bytes go, the row stays with who removed it and why.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-documentation-tools-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { saveNoteSegment, noteHistory } from "../src/lib/practice/documentation";
import {
  saveDraft, myDrafts, discardDraft, listPhrases, createPhrase, deletePhrase, expandPhrases,
  recordAttachment, listAttachments, removeAttachment,
} from "../src/lib/practice/documentation-tools";
import { CALCULATORS, calculatorByKey } from "../src/lib/practice/clinical-calculators";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e22d1";
const OTHER = "00000000-0000-4000-8000-0000000e22d2";
const COLLEAGUE = "00000000-0000-4000-8000-0000000e22d3";

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
    idempotency_key: `harness-doct-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-doct",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-doct", workspace_id: null }, payload(name));
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

const base = { actorId: OWNER, correlationId: "harness-doct" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice documentation-tools harness (CPR-130, migration 207)\n");
  await cleanup();

  // ── 7 and 8. The calculators, before any database is involved ────────────
  //
  // REFERENCE VALUES, not values this code produced. BMI and MAP are arithmetic anybody can check by
  // hand; the eGFR figures are the CKD-EPI 2021 equation evaluated independently.
  const bmi = calculatorByKey("bmi")!.compute({ weight: "70", height: "175" });
  ok("BMI is right (70 kg, 175 cm -> 22.9)", bmi.ok && bmi.value === 22.9, JSON.stringify(bmi));
  ok("EVERY RESULT CARRIES ITS INPUTS -- the safety property",
    bmi.ok && bmi.sentence.includes("70 kg") && bmi.sentence.includes("175 cm"), bmi.ok ? bmi.sentence : "");
  ok("and it offers NO interpretation -- whether 22.9 means anything is a clinical judgement",
    bmi.ok && !/normal|overweight|obese|healthy/i.test(bmi.sentence), bmi.ok ? bmi.sentence : "");

  const bsa = calculatorByKey("bsa")!.compute({ weight: "70", height: "175" });
  ok("BSA (Mosteller) is right (70 kg, 175 cm -> 1.84 m2)", bsa.ok && bsa.value === 1.84, JSON.stringify(bsa));

  const map = calculatorByKey("map")!.compute({ systolic: "120", diastolic: "80" });
  ok("MAP is right (120/80 -> 93)", map.ok && map.value === 93, JSON.stringify(map));
  const inverted = calculatorByKey("map")!.compute({ systolic: "80", diastolic: "120" });
  ok("a diastolic above the systolic is REFUSED, not computed into a plausible number",
    !inverted.ok, JSON.stringify(inverted));

  // ANCHORED TO PUBLISHED VALUES, NOT TO ITSELF. These two are the CKD-EPI 2021 figures the NKF's own
  // calculator reports, so they check the EQUATION rather than merely re-running this implementation.
  //
  // The first draft of this harness asserted two numbers that had not been computed at all, and they
  // were wrong -- the code was right and the expectations were invented. That is the failure mode a
  // clinical calculator harness exists to prevent, so it is recorded here rather than quietly corrected.
  const egfrRef1 = calculatorByKey("egfr")!.compute({ creatinine: "1.00", unit: "mg_dl", age: "50", sex: "male" });
  ok("eGFR matches the published CKD-EPI 2021 value for a 50-year-old man, creatinine 1.0 mg/dL (92)",
    egfrRef1.ok && egfrRef1.value === 92, JSON.stringify(egfrRef1));
  const egfrRef2 = calculatorByKey("egfr")!.compute({ creatinine: "0.80", unit: "mg_dl", age: "60", sex: "female" });
  ok("and for a 60-year-old woman, creatinine 0.8 mg/dL (84)",
    egfrRef2.ok && egfrRef2.value === 84, JSON.stringify(egfrRef2));

  const egfrF = calculatorByKey("egfr")!.compute({ creatinine: "1.60", unit: "mg_dl", age: "62", sex: "female" });
  ok("a reduced result is computed, not clamped (62F, creatinine 1.60 mg/dL -> 36)",
    egfrF.ok && egfrF.value === 36, JSON.stringify(egfrF));

  // The sex terms are not decoration: the same creatinine and age give different answers, which is why
  // the equation asks.
  const sameAsMale = calculatorByKey("egfr")!.compute({ creatinine: "1.60", unit: "mg_dl", age: "62", sex: "male" });
  ok("CONTROL: the sex coefficients change the answer, so they are being applied",
    sameAsMale.ok && egfrF.ok && sameAsMale.value !== egfrF.value,
    JSON.stringify({ female: egfrF.ok && egfrF.value, male: sameAsMale.ok && sameAsMale.value }));

  // 1.60 mg/dL is 141.4 umol/L. Declaring the unit must give the same answer.
  const egfrUmol = calculatorByKey("egfr")!.compute({ creatinine: "141.4", unit: "umol_l", age: "62", sex: "female" });
  ok("UNITS ARE NEVER GUESSED: the same creatinine in umol/L gives the same result when declared",
    egfrUmol.ok && egfrF.ok && egfrUmol.value === egfrF.value,
    JSON.stringify({ umol: egfrUmol.ok && egfrUmol.value, mgdl: egfrF.ok && egfrF.value }));
  const egfrWrongUnit = calculatorByKey("egfr")!.compute({ creatinine: "141.4", unit: "mg_dl", age: "62", sex: "female" });
  ok("CONTROL: the same number read as the WRONG unit gives a wildly different answer, which is why it is asked",
    egfrWrongUnit.ok && egfrF.ok && egfrWrongUnit.value !== egfrF.value,
    JSON.stringify({ asMgdl: egfrWrongUnit.ok && egfrWrongUnit.value }));

  const egfrChild = calculatorByKey("egfr")!.compute({ creatinine: "0.5", unit: "mg_dl", age: "7", sex: "female" });
  ok("the adult equation REFUSES a child rather than returning a wrong answer that looks right",
    !egfrChild.ok, JSON.stringify(egfrChild));
  const egfrNoUnit = calculatorByKey("egfr")!.compute({ creatinine: "1.6", unit: "", age: "62", sex: "female" });
  ok("and it refuses to run without a declared unit", !egfrNoUnit.ok);
  ok("every calculator names its formula in the record",
    CALCULATORS.every(c => c.formula.length > 5), CALCULATORS.map(c => c.key).join(","));
  ok("NO DOSING CALCULATOR EXISTS -- an error there is directly a harm",
    !CALCULATORS.some(c => /dose|dosing|mg\/kg/i.test(`${c.key} ${c.name}`)),
    CALCULATORS.map(c => c.name).join(" | "));

  // ── 5 and 6. Smart text expansion, pure ──────────────────────────────────
  const phrases = [
    { shortcut: ".exam", body: "Chest clear, heart sounds normal." },
    { shortcut: ".exam_full", body: "Full systems examination unremarkable." },
  ];
  const expandedStandalone = expandPhrases("On examination: .exam No further findings.", phrases);
  ok("a standalone shortcut expands",
    expandedStandalone.text.includes("Chest clear") && expandedStandalone.expanded.includes(".exam"),
    expandedStandalone.text);

  const inWord = expandPhrases("The re.exam was normal and pre.exam findings differed.", phrases);
  ok("A SHORTCUT INSIDE A WORD IS LEFT EXACTLY AS TYPED -- rewriting arbitrary substrings of a clinical note is unthinkable",
    inWord.text === "The re.exam was normal and pre.exam findings differed." && inWord.expanded.length === 0,
    inWord.text);

  const longest = expandPhrases(".exam_full today", phrases);
  ok("the longest shortcut wins, so .exam_full is not eaten by .exam",
    longest.text.startsWith("Full systems examination"), longest.text);

  const punctuated = expandPhrases("Findings: .exam, reviewed.", phrases);
  ok("a shortcut followed by punctuation still expands",
    punctuated.text.includes("Chest clear"), punctuated.text);

  // ── The live half ────────────────────────────────────────────────────────
  const wsA = await provision(OWNER, "HARNESS Docs A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Docs B (synthetic)", "b");

  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Kirabo Joan", sex: "female", birthDate: "1991-02-17",
    phone: "0772 555 400", ...base,
  });
  if (!p1.ok) { ok("patient registers", false, p1.message); return report(); }

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: p1.data.id, pathway: "new_walk_in", reasonForVisit: "Cough", ...base,
  });
  if (!enc.ok) { ok("encounter launches", false, enc.message); return report(); }
  const encounterId = enc.data.id;

  // ── 1. Autosave writes no versions ───────────────────────────────────────
  for (let i = 1; i <= 20; i++) {
    await saveDraft(admin, {
      workspaceId: wsA, encounterId, noteType: "subjective",
      body: `Cough for ${i} days, worse at night`, actorId: OWNER,
    });
  }
  // noteHistory returns the byType map ITSELF, not a wrapper around it. The first draft of this harness
  // read `.byType` off it, got undefined, and counted zero versions -- which made this assertion pass
  // for the wrong reason and would have kept passing if autosave had written a hundred. The control
  // below (exactly one version after a deliberate save) is what caught it, and is why it is here.
  const afterAutosaves = await noteHistory(admin, wsA, encounterId);
  const versionCount = Object.values(afterAutosaves).flat().length;
  ok("TWENTY AUTOSAVES WRITE NO VERSION HISTORY AT ALL -- a draft is not a version",
    versionCount === 0, String(versionCount));

  const drafts = await myDrafts(admin, wsA, encounterId, OWNER);
  ok("but the text is there, and only once", drafts.drafts.length === 1 &&
    drafts.drafts[0].body === "Cough for 20 days, worse at night", JSON.stringify(drafts.drafts));
  ok("and it is flagged as differing from what is saved",
    drafts.drafts[0].differsFromSaved === true);

  // ── 2. The deliberate save writes one version and clears the draft ───────
  const saved = await saveNoteSegment(admin, {
    workspaceId: wsA, encounterId, noteType: "subjective",
    body: "Cough for 20 days, worse at night", ...base,
  });
  ok("the deliberate save works", saved.ok, saved.ok ? "" : saved.message);
  const afterSave = await noteHistory(admin, wsA, encounterId);
  ok("and writes EXACTLY ONE version",
    Object.values(afterSave).flat().length === 1,
    String(Object.values(afterSave).flat().length));

  const afterSaveDrafts = await myDrafts(admin, wsA, encounterId, OWNER);
  ok("THE DRAFT IS DELETED THE MOMENT ITS TEXT REACHES A VERSION",
    afterSaveDrafts.drafts.length === 0, JSON.stringify(afterSaveDrafts.drafts));

  // ── 3. A draft is private to its author ──────────────────────────────────
  await saveDraft(admin, {
    workspaceId: wsA, encounterId, noteType: "objective", body: "Mine, unfinished", actorId: OWNER,
  });
  await saveDraft(admin, {
    workspaceId: wsA, encounterId, noteType: "objective", body: "Theirs, also unfinished", actorId: COLLEAGUE,
  });
  const mine = await myDrafts(admin, wsA, encounterId, OWNER);
  const theirs = await myDrafts(admin, wsA, encounterId, COLLEAGUE);
  ok("TWO PEOPLE TYPING INTO THE SAME SEGMENT DO NOT OVERWRITE EACH OTHER",
    mine.drafts[0]?.body === "Mine, unfinished" && theirs.drafts[0]?.body === "Theirs, also unfinished",
    JSON.stringify({ mine: mine.drafts[0]?.body, theirs: theirs.drafts[0]?.body }));
  ok("and neither can read the other's unsaved text",
    mine.drafts.length === 1 && !JSON.stringify(mine.drafts).includes("Theirs"),
    JSON.stringify(mine.drafts.map(d => d.body)));

  const discarded = await discardDraft(admin, { workspaceId: wsA, encounterId, noteType: "objective", actorId: COLLEAGUE });
  ok("a draft can be thrown away", discarded.ok && discarded.data.discarded === true);
  ok("CONTROL: throwing away the colleague's did not touch mine",
    (await myDrafts(admin, wsA, encounterId, OWNER)).drafts.length === 1);

  // ── 4. A signed consultation takes no drafts ─────────────────────────────
  await saveNoteSegment(admin, { workspaceId: wsA, encounterId, noteType: "objective", body: "Chest clear", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId, to: "ACTIVE", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId, to: "COMPLETED", ...base });
  const signedEnc = await transitionEncounter(admin, { workspaceId: wsA, encounterId, to: "SIGNED", ...base });
  ok("the consultation signs", signedEnc.ok, signedEnc.ok ? "" : signedEnc.message);

  const draftOnSigned = await saveDraft(admin, {
    workspaceId: wsA, encounterId, noteType: "assessment", body: "Too late", actorId: OWNER,
  });
  ok("A SIGNED CONSULTATION TAKES NO DRAFTS -- text cannot accumulate where it can never be saved",
    !draftOnSigned.ok && draftOnSigned.code === "ENCOUNTER_LOCKED",
    draftOnSigned.ok ? "saved" : draftOnSigned.code);

  // ── 6. Personal shortcuts shadow shared ones ─────────────────────────────
  const shared = await createPhrase(admin, {
    workspaceId: wsA, shortcut: ".normal", body: "Practice standard: unremarkable.", shared: true, ...base,
  });
  ok("a shared phrase is created", shared.ok, shared.ok ? "" : shared.message);
  const dup = await createPhrase(admin, { workspaceId: wsA, shortcut: ".normal", body: "Again", shared: true, ...base });
  ok("the same shared shortcut twice is refused", !dup.ok && dup.code === "SHORTCUT_IN_USE",
    dup.ok ? "created" : dup.code);

  const personal = await createPhrase(admin, {
    workspaceId: wsA, shortcut: ".normal", body: "My own wording: nothing abnormal found.", ...base,
  });
  ok("CONTROL: the same shortcut as a PERSONAL phrase is allowed", personal.ok, personal.ok ? "" : personal.message);

  const visible = await listPhrases(admin, wsA, OWNER);
  const normal = visible.filter((p: any) => p.shortcut === ".normal");
  ok("A PERSONAL SHORTCUT SHADOWS THE SHARED ONE -- their own words, not the practice's, reach their note",
    normal.length === 1 && normal[0].scope === "personal",
    JSON.stringify(normal.map((p: any) => p.scope)));

  const colleagueView = await listPhrases(admin, wsA, COLLEAGUE);
  ok("a colleague still sees the shared version",
    colleagueView.filter((p: any) => p.shortcut === ".normal")[0]?.scope === "practice",
    JSON.stringify(colleagueView.map((p: any) => [p.shortcut, p.scope])));
  ok("and does not see the personal one at all",
    !colleagueView.some((p: any) => p.body.includes("My own wording")));

  const spaced = await createPhrase(admin, { workspaceId: wsA, shortcut: ".normal exam", body: "x", ...base });
  ok("a shortcut containing a space is refused (it would expand mid-sentence)", !spaced.ok);

  const notMine = personal.ok
    ? await deletePhrase(admin, { workspaceId: wsA, phraseId: personal.data.id, actorId: COLLEAGUE, correlationId: "h" })
    : null;
  ok("somebody else's personal phrase cannot be deleted", notMine?.ok === false && notMine.code === "NOT_YOURS");

  // ── 9. Attachments ───────────────────────────────────────────────────────
  const enc2 = await launchEncounter(admin, {
    workspaceId: wsA, patientId: p1.data.id, pathway: "new_walk_in", reasonForVisit: "Rash", ...base,
  });
  if (!enc2.ok) { ok("second encounter launches", false, enc2.message); return report(); }

  const att = await recordAttachment(admin, {
    workspaceId: wsA, encounterId: enc2.data.id, storagePath: `${wsA}/${enc2.data.id}/probe.png`,
    fileName: "rash.png", mimeType: "image/png", byteSize: 4096, kind: "photograph",
    caption: "Left forearm", ...base,
  });
  ok("an attachment is recorded against the consultation", att.ok, att.ok ? "" : att.message);
  ok("and the patient is carried onto it, so it is never reachable through the wrong record",
    att.ok && att.data.patientId === p1.data.id);

  const onSigned = await recordAttachment(admin, {
    workspaceId: wsA, encounterId, storagePath: "x", fileName: "late.png",
    mimeType: "image/png", byteSize: 10, ...base,
  });
  ok("a SIGNED consultation takes no new attachments -- that is a write to a frozen record",
    !onSigned.ok && onSigned.code === "ENCOUNTER_LOCKED", onSigned.ok ? "added" : onSigned.code);

  if (!att.ok) return report();
  const noReason = await removeAttachment(admin, { workspaceId: wsA, attachmentId: att.data.id, reason: " ", ...base });
  ok("removing one without saying why is refused", !noReason.ok && noReason.code === "REASON_REQUIRED");

  const removed = await removeAttachment(admin, {
    workspaceId: wsA, attachmentId: att.data.id, reason: "Filed against the wrong patient", ...base,
  });
  ok("it can be removed with a reason", removed.ok, removed.ok ? "" : removed.message);

  const live = await listAttachments(admin, wsA, { encounterId: enc2.data.id });
  const all = await listAttachments(admin, wsA, { encounterId: enc2.data.id, includeRemoved: true });
  ok("IT IS REMOVED, NOT ERASED: gone from the list, still in the record with who and why",
    live.length === 0 && all.length === 1 && all[0].removed_reason === "Filed against the wrong patient",
    JSON.stringify({ live: live.length, all: all.length, reason: all[0]?.removed_reason }));
  const twice = await removeAttachment(admin, { workspaceId: wsA, attachmentId: att.data.id, reason: "again", ...base });
  ok("and it cannot be removed twice", !twice.ok && twice.code === "ALREADY_REMOVED");

  // ── 10. Isolation ────────────────────────────────────────────────────────
  const crossDraft = await saveDraft(admin, {
    workspaceId: wsB, encounterId: enc2.data.id, noteType: "subjective", body: "probe", actorId: OTHER,
  });
  ok("another workspace's consultation takes no draft", !crossDraft.ok && crossDraft.code === "NOT_FOUND",
    crossDraft.ok ? "saved" : crossDraft.code);
  const crossAtt = await recordAttachment(admin, {
    workspaceId: wsB, encounterId: enc2.data.id, storagePath: "x", fileName: "p.png",
    mimeType: "image/png", byteSize: 10, actorId: OTHER, correlationId: "h",
  });
  ok("nor an attachment", !crossAtt.ok && crossAtt.code === "NOT_FOUND");
  ok("B sees none of A's phrases", (await listPhrases(admin, wsB, OTHER)).length === 0);
  ok("A's are non-empty (the isolation test is not vacuous)", visible.length > 0);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
