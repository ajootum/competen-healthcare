/**
 * Practice clinical-documentation harness -- CPR-130, exercised against the live database through the
 * same engine the API uses.
 *
 * WHAT IT PROVES:
 *   1. TEMPLATE LIBRARY. The platform starter set is present and visible to a workspace; a workspace can
 *      author its own; a workspace may not shadow a platform code or change a platform template; and an
 *      UNPUBLISHED template cannot reach a consultation.
 *   2. APPLYING A TEMPLATE NEVER DESTROYS CLINICAL TEXT. The single most important rule in the module:
 *      fill_empty leaves written segments untouched WHILE filling the empty ones in the same call, so
 *      "it did not overwrite" cannot be an artefact of it having done nothing. `replace` overwrites, and
 *      the replaced text is still recoverable from the history.
 *   3. VERSIONING. Every distinct save is a version, numbered monotonically; a no-op save adds none; the
 *      history reconstructs what the note said before; and a version row cannot be rewritten even by a
 *      raw statement that bypasses the engine.
 *   4. DOCUMENTS COMPOSE FROM REAL CONTENT. A document built from an encounter contains what the
 *      encounter actually holds and OMITS the sections it does not -- the standing rule that an empty
 *      heading is a false statement about a consultation.
 *   5. SIGN AND LOCK, ENFORCED BY THE DATABASE (migration 195 s7). The engine refuses edits after
 *      signature; a RAW update that bypasses the engine entirely is refused by the trigger. 195's header
 *      promises this file asserts that by name, so a section that did not apply is visible rather than
 *      assumed.
 *   6. AMENDMENT IS A CHAIN, NOT AN EDIT. Amending produces a linked successor, moves the original to
 *      AMENDED, leaves the original's text byte-for-byte intact, and refuses a second amendment of the
 *      same version.
 *   7. RELEASE requires a signature; workspace isolation is non-vacuous; anon reads 0 rows from all five
 *      new tables.
 *
 * CONTROLS: every refusal is paired with the same operation succeeding somewhere it should, so a green
 * "refused" can never be an artefact of a malformed call.
 *
 *   npx --yes tsx scripts/practice-documentation-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment } from "../src/lib/practice/encounters";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  listTemplates, getTemplate, createTemplate, setTemplateStatus,
  saveNoteSegment, noteHistory, applyTemplate,
  composeFromEncounter, createDocument, updateDocument, transitionDocument, amendDocument,
  recordRelease, getDocument, listDocuments,
} from "../src/lib/practice/documentation";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0d41";
const USER_B = "00000000-0000-4000-8000-0000000e0d42";

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
    idempotency_key: `harness-doc-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-doc",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-doc", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-doc" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice clinical-documentation harness (CPR-130, migration 195)\n");
  await cleanup();

  const wsA = await provision(USER_A, "HARNESS Documentation A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Documentation B (synthetic)", "b");

  // ── 0. Is migration 195 actually deployed? ────────────────────────────────
  // Reported first, so every failure below reads as "the migration is missing" rather than as a mystery.
  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  ok("the function registry probe returns rows (the trigger checks are not vacuous)", fns.length > 0,
    reg.error?.message ?? `${fns.length} functions`);
  ok("practice_clinical_document_signed_guard() is deployed (migration 195 s7)",
    fns.some(f => f.fn_name === "practice_clinical_document_signed_guard"),
    "NOT FOUND -- signed documents are engine-protected only");
  ok("practice_note_version_immutable() is deployed (migration 195 s7)",
    fns.some(f => f.fn_name === "practice_note_version_immutable"),
    "NOT FOUND -- note versions are rewritable by anything that bypasses the engine");

  // ── 1. The template library ───────────────────────────────────────────────
  const supplied = await listTemplates(admin, wsA);
  const suppliedCodes = supplied.map(t => t.code);
  ok("the platform starter templates are present and visible to a workspace (migration 195 s6)",
    ["general_consultation", "followup_review", "referral_letter", "sick_note"].every(c => suppliedCodes.includes(c)),
    suppliedCodes.join(", ") || "none -- section 6 did not apply");
  // `.every()` over an empty list is true, so both of these assert a non-empty subject first. Without
  // that they pass loudest exactly when the migration has not been applied at all.
  ok("every supplied template is scoped as platform, not as somebody's workspace",
    supplied.length > 0 && supplied.every(t => t.scope === "platform"),
    `${supplied.length} template(s): ${JSON.stringify(supplied.map(t => t.scope))}`);

  const general = supplied.find(t => t.code === "general_consultation");
  const sections = (general ? (await getTemplate(admin, wsA, general.id))?.sections ?? [] : []) as any[];
  ok("a supplied encounter-note template carries its four SOAP sections",
    sections.length === 4, `${sections.length} section(s)`);
  ok("a template's prompts are separate from the text it writes (guidance never becomes the record)",
    sections.length === 4 && sections.every(s => s.prompt && s.default_body === ""),
    JSON.stringify(sections.map(s => ({ p: !!s.prompt, b: s.default_body }))));

  const shadow = await createTemplate(admin, {
    workspaceId: wsA, code: "general_consultation", title: "My own general consultation",
    sections: [{ noteType: "subjective", heading: "History" }], ...base,
  });
  ok("a workspace may NOT shadow a platform template's code", !shadow.ok && shadow.code === "CODE_RESERVED",
    shadow.ok ? "was allowed" : shadow.code);

  const mine = await createTemplate(admin, {
    workspaceId: wsA, code: "antenatal_first_visit", title: "Antenatal first visit",
    description: "Booking visit.", kind: "encounter_note",
    sections: [
      { noteType: "subjective", heading: "Obstetric history", prompt: "Gravidity, parity, previous outcomes." },
      { noteType: "plan", heading: "Booking plan", defaultBody: "Bloods requested:" },
    ],
    ...base,
  });
  // CONTROL for the refusal above: the same call with a free code succeeds, so CODE_RESERVED is about the
  // code and not about createTemplate being broken.
  ok("a workspace CAN author its own template (control for the refusal above)", mine.ok, mine.ok ? "" : mine.message);
  if (!mine.ok) return report();

  const badSections = await createTemplate(admin, {
    workspaceId: wsA, code: "empty_one", title: "Nothing at all", sections: [], ...base,
  });
  ok("a template with no sections is refused (it would apply nothing)",
    !badSections.ok && badSections.code === "VALIDATION_ERROR", badSections.ok ? "was allowed" : badSections.code);

  const platformWrite = general ? await setTemplateStatus(admin, {
    workspaceId: wsA, templateId: general.id, status: "retired", ...base,
  }) : null;
  ok("a workspace may NOT retire a platform template",
    !!platformWrite && !platformWrite.ok && platformWrite.code === "PLATFORM_TEMPLATE",
    platformWrite?.ok ? "was allowed" : platformWrite?.code ?? "no platform template to try");

  const bTouchesA = await setTemplateStatus(admin, { workspaceId: wsB, templateId: mine.data.id, status: "published", ...base });
  ok("workspace B may not publish workspace A's template", !bTouchesA.ok && bTouchesA.code === "NOT_FOUND",
    bTouchesA.ok ? "was allowed" : bTouchesA.code);
  ok("getTemplate is workspace-scoped (B cannot read A's template)",
    (await getTemplate(admin, wsB, mine.data.id)) === null);

  // ── 2. Applying a template ────────────────────────────────────────────────
  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Achieng Sarah", birthDate: "1988-03-14", sex: "female",
    phone: "0772 555 220", ...base,
  });
  if (!pa.ok) { ok("patient registration for the harness succeeded", false, pa.message); return report(); }
  const patientA = pa.data.id;

  const launched = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "new_walk_in", reasonForVisit: "headache for 3 days", ...base,
  });
  if (!launched.ok) { ok("encounter launch for the harness succeeded", false, launched.message); return report(); }
  const encId = launched.data.id;
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "ACTIVE", ...base });

  const unpublished = await applyTemplate(admin, { workspaceId: wsA, encounterId: encId, templateId: mine.data.id, ...base });
  ok("an UNPUBLISHED template cannot reach a consultation",
    !unpublished.ok && unpublished.code === "TEMPLATE_NOT_PUBLISHED", unpublished.ok ? "was applied" : unpublished.code);

  const published = await setTemplateStatus(admin, { workspaceId: wsA, templateId: mine.data.id, status: "published", ...base });
  ok("publishing a workspace template works and bumps its version (control)",
    published.ok && published.data.version === 2, published.ok ? `v${published.data.version}` : published.message);

  // The text that must survive. Written BEFORE the template is applied.
  const typed = "throbbing, worse in the morning, no visual aura";
  await saveNoteSegment(admin, { workspaceId: wsA, encounterId: encId, noteType: "subjective", body: typed, ...base });

  const applied = await applyTemplate(admin, { workspaceId: wsA, encounterId: encId, templateId: mine.data.id, mode: "fill_empty", ...base });
  ok("applying a template reports what it filled and what it left alone",
    applied.ok && applied.data.skipped.includes("subjective") && applied.data.applied.includes("plan"),
    applied.ok ? JSON.stringify(applied.data) : applied.message);

  const { data: afterApply } = await admin.from("practice_encounter_note")
    .select("note_type, body").eq("encounter_id", encId);
  const bodyOf = (t: string) => ((afterApply ?? []) as any[]).find(n => n.note_type === t)?.body ?? "";
  ok("THE WRITTEN SEGMENT IS UNTOUCHED (fill_empty never overwrites clinical text)",
    bodyOf("subjective") === typed, JSON.stringify(bodyOf("subjective")));
  // The control that makes the assertion above mean something: the SAME call did write somewhere.
  ok("the EMPTY segment was filled by the same call (the rule is not just inaction)",
    bodyOf("plan").includes("Booking plan") && bodyOf("plan").includes("Bloods requested:"),
    JSON.stringify(bodyOf("plan")));

  const replaced = await applyTemplate(admin, { workspaceId: wsA, encounterId: encId, templateId: mine.data.id, mode: "replace", ...base });
  ok("replace mode is available when it is asked for explicitly", replaced.ok, replaced.ok ? "" : replaced.message);
  const { data: afterReplace } = await admin.from("practice_encounter_note")
    .select("note_type, body").eq("encounter_id", encId).eq("note_type", "subjective").maybeSingle();
  ok("replace mode does overwrite", !String(afterReplace?.body ?? "").includes("throbbing"), String(afterReplace?.body ?? ""));

  const historyAfterReplace = await noteHistory(admin, wsA, encId);
  ok("EVEN THE DESTRUCTIVE PATH IS RECOVERABLE: the replaced text is still in the history",
    (historyAfterReplace.subjective ?? []).some((v: any) => v.body === typed),
    JSON.stringify((historyAfterReplace.subjective ?? []).map((v: any) => v.version)));

  // ── 3. Versioning ─────────────────────────────────────────────────────────
  const v1 = await saveNoteSegment(admin, { workspaceId: wsA, encounterId: encId, noteType: "assessment", body: "tension headache", ...base });
  const noop = await saveNoteSegment(admin, { workspaceId: wsA, encounterId: encId, noteType: "assessment", body: "tension headache", ...base });
  const v2 = await saveNoteSegment(admin, { workspaceId: wsA, encounterId: encId, noteType: "assessment", body: "tension headache, query analgesic overuse", source: "dictation", ...base });

  ok("a save records a version", v1.ok && v1.data.changed && v1.data.version === 1, v1.ok ? `v${v1.data.version}` : v1.message);
  ok("a NO-OP save records nothing (the history stays readable)",
    noop.ok && noop.data.changed === false && noop.data.version === 1, noop.ok ? JSON.stringify(noop.data) : noop.message);
  ok("a changed save records the next version", v2.ok && v2.data.version === 2, v2.ok ? `v${v2.data.version}` : v2.message);

  const history = await noteHistory(admin, wsA, encId);
  const assessment = history.assessment ?? [];
  ok("the history holds exactly the two committed versions of that segment", assessment.length === 2, `${assessment.length}`);
  ok("the history reconstructs what the note said BEFORE (unanswerable before CPR-130)",
    assessment.find((v: any) => v.version === 1)?.body === "tension headache",
    JSON.stringify(assessment.map((v: any) => v.body)));
  ok("dictated text is recorded as dictated, typed text as typed",
    assessment.find((v: any) => v.version === 2)?.source === "dictation" &&
    assessment.find((v: any) => v.version === 1)?.source === "typed",
    JSON.stringify(assessment.map((v: any) => v.source)));

  const versionRow = assessment.find((v: any) => v.version === 1);
  const rewriteVersion = await admin.from("practice_encounter_note_version")
    .update({ body: "a different history" }).eq("id", versionRow.id);
  ok("the DATABASE refuses to rewrite a note version (migration 195 s7 trigger)",
    !!rewriteVersion.error, rewriteVersion.error?.message ?? "the update succeeded");
  const { data: stillThere } = await admin.from("practice_encounter_note_version").select("body").eq("id", versionRow.id).single();
  ok("the version still holds its original text", stillThere?.body === "tension headache", String(stillThere?.body));

  // ── 4. Documents compose from real content ────────────────────────────────
  const dx = await recordDiagnosis(admin, {
    workspaceId: wsA, encounterId: encId, label: "Tension-type headache", certainty: "provisional", isPrimary: true, ...base,
  });
  ok("a diagnosis for the harness records", dx.ok, dx.ok ? "" : dx.message);
  await recordTreatment(admin, {
    workspaceId: wsA, encounterId: encId, treatmentType: "medication", label: "Paracetamol",
    dose: "1 g", route: "oral", frequency: "8-hourly", ...base,
  });

  const composedBody = await composeFromEncounter(admin, wsA, encId);
  ok("composing pulls in the encounter's real note text", composedBody.includes("tension headache, query analgesic overuse"), composedBody.slice(0, 120));
  ok("composing pulls in the encounter's real diagnoses and treatments",
    composedBody.includes("Tension-type headache") && composedBody.includes("Paracetamol"), composedBody.slice(0, 200));
  ok("composing OMITS a section the encounter has nothing for (no empty headings)",
    !composedBody.includes("Examination and findings"), composedBody.slice(0, 300));

  const noTitle = await createDocument(admin, { workspaceId: wsA, patientId: patientA, title: "  ", ...base });
  ok("a document with no title is refused", !noTitle.ok && noTitle.code === "VALIDATION_ERROR", noTitle.ok ? "was allowed" : noTitle.code);

  const otherPatient = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Mukasa John", birthDate: "1971-01-09", sex: "male", phone: "0772 555 221", ...base,
  });
  const mismatch = otherPatient.ok ? await createDocument(admin, {
    workspaceId: wsA, patientId: otherPatient.data.id, encounterId: encId, title: "Referral", ...base,
  }) : null;
  ok("a document may not be filed against another patient's encounter",
    !!mismatch && !mismatch.ok && mismatch.code === "ENCOUNTER_PATIENT_MISMATCH",
    mismatch?.ok ? "was allowed" : mismatch?.code ?? "no second patient");

  const doc = await createDocument(admin, {
    workspaceId: wsA, patientId: patientA, encounterId: encId, docType: "referral_letter",
    title: "Referral to neurology", addressedTo: "Dr Okello, Mulago", composeFrom: true, ...base,
  });
  ok("a document is created from the consultation (control for the refusals above)", doc.ok, doc.ok ? "" : doc.message);
  if (!doc.ok) return report();
  const docId = doc.data.id;

  const empty = await createDocument(admin, { workspaceId: wsA, patientId: patientA, title: "Blank note", ...base });
  const signEmpty = empty.ok ? await transitionDocument(admin, { workspaceId: wsA, documentId: empty.data.id, to: "FINAL", ...base }) : null;
  const signEmpty2 = empty.ok && signEmpty?.ok
    ? await transitionDocument(admin, { workspaceId: wsA, documentId: empty.data.id, to: "SIGNED", ...base }) : null;
  ok("an EMPTY document cannot be signed (a signature on nothing at all)",
    !!signEmpty2 && !signEmpty2.ok && signEmpty2.code === "EMPTY_DOCUMENT",
    signEmpty2?.ok ? "was allowed" : signEmpty2?.code ?? "setup failed");

  // ── 5. Sign and lock ──────────────────────────────────────────────────────
  const edit = await updateDocument(admin, { workspaceId: wsA, documentId: docId, body: `${composedBody}\n\nPlease review.`, ...base });
  ok("a draft document can be edited (control)", edit.ok, edit.ok ? "" : edit.message);

  const straightToSigned = await transitionDocument(admin, { workspaceId: wsA, documentId: docId, to: "SIGNED", ...base });
  ok("a DRAFT cannot jump straight to SIGNED (ready and signed are two decisions)",
    !straightToSigned.ok && straightToSigned.code === "ILLEGAL_TRANSITION",
    straightToSigned.ok ? "was allowed" : straightToSigned.code);

  const toAmendedDirectly = await transitionDocument(admin, { workspaceId: wsA, documentId: docId, to: "AMENDED", ...base });
  ok("nothing may transition straight into AMENDED (it would supersede a document with nothing)",
    !toAmendedDirectly.ok && toAmendedDirectly.code === "USE_AMEND",
    toAmendedDirectly.ok ? "was allowed" : toAmendedDirectly.code);

  const releaseUnsigned = await recordRelease(admin, { workspaceId: wsA, documentId: docId, channel: "printed", ...base });
  ok("an unsigned document cannot be issued to anyone",
    !releaseUnsigned.ok && releaseUnsigned.code === "NOT_SIGNED", releaseUnsigned.ok ? "was allowed" : releaseUnsigned.code);

  await transitionDocument(admin, { workspaceId: wsA, documentId: docId, to: "FINAL", ...base });
  const signed = await transitionDocument(admin, { workspaceId: wsA, documentId: docId, to: "SIGNED", ...base });
  ok("a document with content signs", signed.ok, signed.ok ? "" : signed.message);

  const { data: signedRow } = await admin.from("practice_clinical_document").select("body, signed_at, signed_by").eq("id", docId).single();
  const signedBody = String(signedRow?.body ?? "");
  ok("signing stamps who and when", !!signedRow?.signed_at && signedRow?.signed_by === USER_A, JSON.stringify(signedRow?.signed_by));

  const postEdit = await updateDocument(admin, { workspaceId: wsA, documentId: docId, body: "rewritten after issue", ...base });
  ok("the engine refuses an edit after signature",
    !postEdit.ok && postEdit.code === "DOCUMENT_LOCKED", postEdit.ok ? "was allowed" : postEdit.code);

  // THE GUARANTEE MIGRATION 195 PROMISES: bypass the engine completely.
  const rawEdit = await admin.from("practice_clinical_document")
    .update({ body: "rewritten straight at the table" }).eq("id", docId);
  ok("the DATABASE refuses a raw edit of a signed document (migration 195 s7 trigger)",
    !!rawEdit.error && /signed/i.test(rawEdit.error.message), rawEdit.error?.message ?? "the update succeeded");

  const rawAmendWithEdit = await admin.from("practice_clinical_document")
    .update({ status: "AMENDED", body: "rewritten under cover of an amendment" }).eq("id", docId);
  ok("the DATABASE refuses an amendment that also rewrites the original content",
    !!rawAmendWithEdit.error && /signed/i.test(rawAmendWithEdit.error.message), rawAmendWithEdit.error?.message ?? "the update succeeded");

  // CONTROL: the same raw statement on a DRAFT succeeds, so the refusals above are the trigger doing its
  // job rather than the update being malformed.
  const rawOnDraft = empty.ok ? await admin.from("practice_clinical_document")
    .update({ body: "a draft is still editable at the table" }).eq("id", empty.data.id) : { error: { message: "setup failed" } };
  ok("a raw edit of a DRAFT document succeeds (the trigger is not refusing everything)",
    !rawOnDraft.error, rawOnDraft.error?.message ?? "");

  // ── 6. Amendment is a chain ───────────────────────────────────────────────
  const noReason = await amendDocument(admin, { workspaceId: wsA, documentId: docId, reason: "  ", ...base });
  ok("an amendment must say why", !noReason.ok && noReason.code === "VALIDATION_ERROR", noReason.ok ? "was allowed" : noReason.code);

  const amended = await amendDocument(admin, {
    workspaceId: wsA, documentId: docId, reason: "wrong clinic named in the address", ...base,
  });
  ok("amending a signed document creates a successor (control)", amended.ok, amended.ok ? "" : amended.message);
  if (!amended.ok) return report();

  ok("the successor is version 2 and starts as a fresh draft", amended.data.version === 2, `v${amended.data.version}`);

  const chain = await getDocument(admin, wsA, amended.data.id);
  ok("the successor links back to what it amends", chain?.predecessor?.id === docId, JSON.stringify(chain?.predecessor));
  ok("the successor carries the amendment reason",
    chain?.document.amendment_reason === "wrong clinic named in the address", String(chain?.document.amendment_reason));

  const original = await getDocument(admin, wsA, docId);

  /**
   * ⚠ A HARD-CODED FAILURE DETAIL IS AN INVENTED MEASUREMENT -- 2026-08-28.
   *
   * The body assertion below used to carry the constant detail string "the signed body was modified",
   * printed whenever the comparison failed -- INCLUDING when getDocument returned null and no body was
   * ever read. That is exactly what happened on staging: getDocument's select names content_model and
   * style_id, both added by migration 357, which staging lacks. PostgREST answered "column ... does not
   * exist", getDocument fail-softed to null, and six assertions cascaded -- one of them announcing that
   * a SIGNED CLINICAL DOCUMENT'S BODY HAD BEEN MODIFIED, on a database where nothing was read at all.
   * That sentence was escalated as an integrity defect before anyone noticed it was a string literal.
   *
   * So: the null case is now its own named assertion, and every detail string below reports what was
   * actually observed rather than asserting the scariest interpretation of a false comparison.
   */
  ok("getDocument can read both ends of the chain (its select matches this database's schema)",
    !!chain && !!original,
    `chain ${chain ? "read" : "NULL"}, original ${original ? "read" : "NULL"} -- getDocument fail-softs to `
    + `null when its select names a column this database lacks (content_model/style_id arrived in migration 357)`);

  ok("the original moved to AMENDED", original?.document.status === "AMENDED",
    original ? String(original.document.status) : "unknown -- getDocument returned null");
  ok("THE ORIGINAL'S TEXT IS UNCHANGED (a copy of it is out in the world)",
    original?.document.body === signedBody,
    original
      ? (original.document.body === signedBody ? "" : "the stored body DIFFERS from the signed text")
      : "unknown -- getDocument returned null, the body was never read, and this failure says nothing about the text");
  ok("the original points forward to its successor", original?.successor?.id === amended.data.id, JSON.stringify(original?.successor));

  const secondAmend = await amendDocument(admin, { workspaceId: wsA, documentId: docId, reason: "again", ...base });
  ok("the same version cannot be amended twice (the chain cannot fork)",
    !secondAmend.ok && ["ALREADY_AMENDED", "NOT_SIGNED"].includes(secondAmend.code),
    secondAmend.ok ? "was allowed" : secondAmend.code);

  // ── 7. Release, isolation, anon ───────────────────────────────────────────
  await transitionDocument(admin, { workspaceId: wsA, documentId: amended.data.id, to: "FINAL", ...base });
  await transitionDocument(admin, { workspaceId: wsA, documentId: amended.data.id, to: "SIGNED", ...base });
  const released = await recordRelease(admin, {
    workspaceId: wsA, documentId: amended.data.id, channel: "handed_over", recipient: "the patient", ...base,
  });
  ok("a signed document can be recorded as issued (control for the refusal in section 5)",
    released.ok, released.ok ? "" : released.message);

  const withRelease = await getDocument(admin, wsA, amended.data.id);
  ok("the release is readable on the document", (withRelease?.releases ?? []).length === 1, `${(withRelease?.releases ?? []).length}`);

  ok("getDocument is workspace-scoped (B cannot read A's document)", (await getDocument(admin, wsB, docId)) === null);
  const listA = await listDocuments(admin, wsA, {});
  const listB = await listDocuments(admin, wsB, {});
  ok("A's document register is non-empty (the isolation test is not vacuous)", listA.length >= 2, `${listA.length}`);
  ok("B's document register does not contain A's documents", listB.length === 0, `${listB.length}`);
  ok("the register carries the patient's name without a query per row",
    listA.every((d: any) => d.patient_name !== null), JSON.stringify(listA.map((d: any) => d.patient_name)));

  const TABLES = ["practice_note_template", "practice_note_template_section",
    "practice_encounter_note_version", "practice_clinical_document", "practice_clinical_document_release"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in every documentation table (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("anon reads 0 rows from every documentation table", leaked === 0, `${leaked} table(s) leaked`);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
