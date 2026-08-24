/**
 * CPR-DOC-AUTO-001 s17 -- THE ACCEPTANCE TESTS, AND WHY MOST OF THEM NEED NO DATABASE.
 *
 * Section 17 lists twelve PASS conditions. The four that matter most -- grounded generation, no
 * invention, disclosure control, and regeneration not broadening scope -- are all the same question
 * asked four ways: does anything appear in this document that was not a selected fact or something the
 * practitioner typed?
 *
 * That question is answerable HERE, without a practice, because every composer is a pure function. It
 * receives facts and returns text. So the test can hand it three facts and read the output for a
 * fourth. Against a real database the same test would be a guess: you would be reading a letter about
 * a real patient and trying to decide whether a phrase came from a row you did not select.
 *
 * ⚠ THE STRUCTURAL TESTS IN SECTION 6 ARE THE ONES THAT KEEP THIS TRUE. Purity is not a property the
 * behavioural tests can see -- a composer that quietly grew a database read would still pass every test
 * above, because the fixtures would not exercise the new path. Section 6 asserts the SHAPE: that
 * document-compose.ts imports nothing capable of reading a record, and holds no clock. If somebody has
 * to change those assertions to land a feature, that is the conversation this file exists to force.
 *
 * LAYOUT. Sections 1-8 are the referral letter and the rules every document inherits; 9-10 the two
 * Phase 2 patient documents; 11 the claim that they all share ONE pipeline, which is the claim most
 * likely to quietly stop being true as types are added; 12-14 Phase 3's four documents, the disclosure
 * default they forced open, and what the registry refuses to offer at all.
 *
 * SECTION 15 ASSERTS AN ABSENCE, and it is the one to read before extending this file. Section 5's
 * eighth priority is the sick-leave and fitness certificate, and section 14 forbids free-generating a
 * statutory document without an approved controlled template. There is no generator for it, and 15a-c
 * pin that. Adding one later should mean deleting a test with section 14 written on it, in front of
 * whoever owns that decision -- not quietly finding nothing in the way.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from "node:fs";
import path from "node:path";
import {
  composeReferralLetter, composeVisitSummary, composePatientInstructions, composeClinicalSummary,
  composeInvestigationRequest, composeFollowUpInstructions, composeMedicationList, recipientLine,
  type Recipient,
} from "../src/lib/practice/document-compose";
import { DOC_TYPES } from "../src/lib/practice/document-constants";
import { DOC_TYPE_OPTIONS } from "../src/lib/practice/documents-workspace-constants";
import { verifyGrounded, phrasingPayload } from "../src/lib/practice/document-phrasing";
import { AI_NOTICE } from "../src/lib/practice/ai-assistant";
import { renderPlainText, type DocumentBlock } from "../src/lib/practice/document-compose";
import { PREVIEW_DOCUMENTS, previewDocument } from "../src/lib/practice/document-preview";
import {
  LOCKED_LAYOUT_NOTICE, PLATFORM_BASELINE, PRESETS, ROLE_FOR_CATEGORY, SECTION_ROLES, presetTokens,
  resolveStyle, validateDocumentOverride, validateTokens,
} from "../src/lib/practice/document-style";
import {
  resolveSelection, defaultSelection, selectableFacts, CURRENT_STATE_CATEGORIES, FACT_CATEGORIES,
  doseWithUnit,
  type FactGroup, type SelectableFact,
} from "../src/lib/practice/document-facts";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/**
 * Strip comments before searching source.
 *
 * ⚠ BLOCKS FIRST, THEN LINES, AND \r IS MATCHED EXPLICITLY. A line-comment pattern anchored on \n is
 * inert on a CRLF file -- this codebase has shipped a stripper that silently did nothing on exactly the
 * files it was pointed at. The self-check below fires if that regression returns.
 */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n\r]*/g, "$1");

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
//
// Labels are deliberately unusual strings. A fact labelled "Diabetes" could appear in output by
// coincidence -- through a heading, a template word, a scaffold line -- and the test would pass for the
// wrong reason. "ZZ-CURRENT-DX" cannot.

const fact = (over: Partial<SelectableFact> & { key: string; label: string }): SelectableFact => ({
  category: "diagnosis", sourceTable: "practice_diagnosis", sourceId: over.key.split(":")[1] ?? "x",
  detail: null, scope: "current_encounter", recordedOn: "2026-08-23", defaultSelected: true, ...over,
});

const CURRENT_DX = fact({ key: "practice_diagnosis:11111111-1111-1111-1111-111111111111", label: "ZZ-CURRENT-DX", detail: "confirmed" });
const CURRENT_RX = fact({ key: "practice_treatment:22222222-2222-2222-2222-222222222222", label: "ZZ-CURRENT-RX", category: "treatment", sourceTable: "practice_treatment", detail: "oral - 5 days" });
const HISTORIC_DX = fact({ key: "practice_diagnosis:33333333-3333-3333-3333-333333333333", label: "ZZ-HISTORIC-DX", scope: "historical", defaultSelected: false });
const HISTORIC_MED = fact({ key: "practice_medication:44444444-4444-4444-4444-444444444444", label: "ZZ-HISTORIC-MED", category: "medication", sourceTable: "practice_medication", scope: "historical", defaultSelected: false });

const RECIPIENT: Recipient = {
  kind: "clinician", displayName: "Dr Okello", specialty: "Cardiology",
  facility: "Mulago Hospital", address: "PO Box 7051\nKampala",
};

const PATIENT = { name: "Aisha Nakato", identifier: "26-000141", sex: "female", age: "34" };

const baseInput = (facts: SelectableFact[]) => ({
  today: "2026-08-23", recipient: RECIPIENT, patient: PATIENT,
  reason: "ZZ-TYPED-REASON", requestedAction: "ZZ-TYPED-ACTION",
  facts, practitionerName: "Dr Grace Aine", practiceName: "Competen Clinic",
});

const groupsOf = (facts: SelectableFact[]): FactGroup[] => {
  const byCategory = new Map<string, SelectableFact[]>();
  for (const f of facts) byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f]);
  return [...byCategory].map(([category, fs_]) => ({
    category: category as FactGroup["category"], title: category, facts: fs_, truncated: false, unreadable: null,
  }));
};

/**
 * A PostgREST stub. Each from() returns its OWN chain.
 *
 * ⚠ A SINGLE SHARED `table` VARIABLE IS THE RECORDED BUG HERE. selectableFacts builds all eight queries
 * inside one Promise.all -- every from() runs before any await -- so a stub holding one table name
 * resolves all eight as whichever table was named last, and assertions about medication quietly read
 * diagnoses.
 */
function stubAdmin(rows: Record<string, any[]>, errorOn: string | null = null) {
  return {
    from(table: string) {
      // ⚠ THE PREDICATES ARE REALLY APPLIED, NOT SWALLOWED. A stub whose in()/gte()/lte() return the
      // chain unchanged would let every status- and date-filter assertion below pass while the filter
      // did nothing -- the registry could offer a CANCELLED follow-up and the test would still be
      // green. Each predicate is recorded and evaluated in then().
      const preds: ((r: any) => boolean)[] = [];
      const chain: any = {
        select() { return chain; },
        eq(col: string, val: any) { preds.push(r => r[col] === val); return chain; },
        in(col: string, vals: any[]) { preds.push(r => vals.includes(r[col])); return chain; },
        gte(col: string, val: string) { preds.push(r => String(r[col] ?? "") >= val); return chain; },
        lte(col: string, val: string) { preds.push(r => String(r[col] ?? "") <= val); return chain; },
        lt(col: string, val: string) { preds.push(r => String(r[col] ?? "") < val); return chain; },
        ilike() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() {
          if (errorOn === table) return Promise.resolve({ data: null, error: { message: "stub failure" } });
          const hit = (rows[table] ?? []).find(r => preds.every(p => p(r)));
          return Promise.resolve({ data: hit ?? null, error: null });
        },
        then(resolve: any) {
          if (errorOn === table) return resolve({ data: null, error: { message: "stub failure" } });
          return resolve({ data: (rows[table] ?? []).filter(r => preds.every(p => p(r))), error: null });
        },
      };
      return chain;
    },
  } as any;
}

const WS = "ws-1", PAT = "pat-1", ENC = "enc-1";
const ctx = { workspaceId: WS, userId: "user-1" } as any;

async function main() {
  console.log("\nCPR-DOC-AUTO-001 s17 -- DOCUMENT AUTOMATION ACCEPTANCE\n");

  // ── 0. the stripper works on this repo's files ──────────────────────────────────────────────────
  const crlfProbe = "code(); // comment\r\nkept();\r\n";
  ok("0a. the comment stripper is not inert on CRLF",
    !strip(crlfProbe).includes("comment") && strip(crlfProbe).includes("kept"));
  ok("0b. the comment stripper removes block comments",
    !strip("/* hidden */ visible").includes("hidden"));

  // ── 1. GROUNDED GENERATION, and NO INVENTION ────────────────────────────────────────────────────
  //
  // s17: "Every clinical assertion in generated output is supported by selected source data or explicit
  // practitioner input" and "Missing facts are omitted rather than fabricated."
  const composed = composeReferralLetter(baseInput([CURRENT_DX, CURRENT_RX]));

  ok("1a. a selected fact appears in the letter", composed.body.includes("ZZ-CURRENT-DX"));
  ok("1b. a selected fact's recorded detail appears as recorded",
    composed.body.includes("oral - 5 days"));
  ok("1c. what the practitioner typed appears", composed.body.includes("ZZ-TYPED-REASON") && composed.body.includes("ZZ-TYPED-ACTION"));

  // THE GROUNDING TEST ITSELF. Remove everything the letter is entitled to contain -- the fixed
  // scaffold, the selected facts, the typed input, the addressing block -- and nothing clinical may be
  // left. Any residue is text the composer authored about a patient, which is what s10 forbids.
  const entitled = [
    "2026-08-23", "Dr Okello", "Cardiology", "Mulago Hospital", "PO Box 7051", "Kampala",
    "Dear Dr Okello,", "Re:", "Aisha Nakato", "26-000141", "female", "34",
    "Reason for referral", "ZZ-TYPED-REASON", "Requested action", "ZZ-TYPED-ACTION",
    "Diagnoses", "Treatment given", "ZZ-CURRENT-DX", "confirmed", "ZZ-CURRENT-RX", "oral - 5 days",
    "Yours sincerely,", "Dr Grace Aine", "Competen Clinic",
  ];
  // LONGEST FIRST. Removing "Dr Okello" before "Dear Dr Okello," leaves the bare word "Dear" behind,
  // and the assertion then fails on its own stripping order rather than on anything the composer wrote.
  let residue = composed.body;
  for (const piece of [...entitled].sort((a, b) => b.length - a.length)) residue = residue.split(piece).join("");
  // Scaffold punctuation is the composer's own formatting, not a clinical assertion.
  residue = residue.replace(/[\s\-(),:]/g, "");
  ok("1d. GROUNDING -- nothing in the letter is unaccounted for by a fact or typed input",
    residue === "", `residue: ${JSON.stringify(residue.slice(0, 120))}`);

  // s17 "no invention": a patient with no identifier recorded.
  const noId = composeReferralLetter({ ...baseInput([CURRENT_DX]), patient: { ...PATIENT, identifier: null } });
  ok("1e. a missing identifier is omitted, not printed as a placeholder",
    !noId.body.includes("[[") && !noId.body.includes("not recorded") && !/Re: Aisha Nakato -\s+-/.test(noId.body));
  ok("1f. the rest of the Re: line survives the omission",
    noId.body.includes("Re: Aisha Nakato - female, 34"));

  // ── 2. DISCLOSURE CONTROL ────────────────────────────────────────────────────────────────────────
  //
  // s17: "Unselected historical facts do not appear."
  ok("2a. an unselected historical fact does not appear",
    !composed.body.includes("ZZ-HISTORIC-DX") && !composed.body.includes("ZZ-HISTORIC-MED"));

  // CONTROL. If historical facts could never be rendered at all, 2a would pass for the wrong reason.
  const withHistory = composeReferralLetter(baseInput([CURRENT_DX, HISTORIC_DX]));
  ok("2b. CONTROL -- a historical fact DOES appear once selected",
    withHistory.body.includes("ZZ-HISTORIC-DX"));

  ok("2c. s9 default -- only current-encounter facts are pre-selected",
    JSON.stringify(defaultSelection(groupsOf([CURRENT_DX, CURRENT_RX, HISTORIC_DX, HISTORIC_MED])))
      === JSON.stringify([CURRENT_DX.key, CURRENT_RX.key]));

  // ── 3. PATIENT ISOLATION ─────────────────────────────────────────────────────────────────────────
  //
  // s17: "No content from another patient/template instance leaks."
  const foreign = resolveSelection(groupsOf([CURRENT_DX]), [CURRENT_DX.key, "practice_diagnosis:99999999-9999-9999-9999-999999999999"]);
  ok("3a. a key outside the offered set is not resolved",
    foreign.selected.length === 1 && foreign.selected[0].key === CURRENT_DX.key);
  ok("3b. and it is REPORTED rather than dropped", foreign.unknown.length === 1);

  // ⚠ THE OFFERED SET MUST CONTAIN SOMETHING DELIBERATELY LEFT OUT, or this proves nothing.
  //
  // Every other fixture here offers exactly the facts it then selects, which makes "honour the
  // selection" and "return everything offered" indistinguishable -- gutting the wanted-set check left
  // this harness fully green. A fact that is offered and NOT chosen is the only shape that can tell
  // those two apart, and it is the shape s9 disclosure control is actually about.
  const partial = resolveSelection(groupsOf([CURRENT_DX, HISTORIC_DX]), [CURRENT_DX.key]);
  ok("3b-i. an OFFERED but unselected fact is excluded",
    partial.selected.length === 1 && partial.selected[0].key === CURRENT_DX.key,
    `selected ${partial.selected.length}: ${partial.selected.map(f => f.label).join(", ")}`);
  ok("3b-ii. and excluding it is not reported as an unknown key", partial.unknown.length === 0);

  // Order is the record's, not the client's -- so a submitted sequence cannot reorder a letter.
  const reordered = resolveSelection(groupsOf([CURRENT_DX, CURRENT_RX]), [CURRENT_RX.key, CURRENT_DX.key]);
  ok("3c. fact order comes from the record, not the submitted array",
    reordered.selected[0].key === CURRENT_DX.key);

  // An encounter belonging to a different patient must not become "current".
  const isolation = await selectableFacts(stubAdmin({
    practice_patient: [{ id: PAT, workspace_id: WS }],
    practice_encounter: [{ id: ENC, workspace_id: WS, patient_id: "someone-else", started_at: "2026-08-23T09:00:00Z", reason_for_visit: "ZZ-FOREIGN-REASON" }],
  }), ctx, { patientId: PAT, encounterId: ENC });
  ok("3d. an encounter belonging to another patient is refused as the current one",
    isolation !== null && isolation.encounterId === null);
  ok("3e. and none of its content is offered as a fact",
    JSON.stringify(isolation?.groups ?? []).includes("ZZ-FOREIGN-REASON") === false);

  const foreignPatient = await selectableFacts(stubAdmin({ practice_patient: [] }), ctx, { patientId: "not-ours" });
  ok("3f. a patient outside the workspace returns null, not an empty offer", foreignPatient === null);

  // ── 4. PROVENANCE ────────────────────────────────────────────────────────────────────────────────
  //
  // s15. The engine writes practice_document_fact from usedFactKeys, so this is what makes the
  // disclosure record match the letter rather than the request.
  ok("4a. every fact that appears is reported as used",
    composed.usedFactKeys.length === 2 && composed.usedFactKeys.includes(CURRENT_DX.key) && composed.usedFactKeys.includes(CURRENT_RX.key));
  ok("4b. a fact that does not appear is not reported as used",
    !composed.usedFactKeys.includes(HISTORIC_DX.key));

  // Every category the registry can produce must have somewhere to go. A category with no section
  // would be silently dropped from a letter while still being offered for selection.
  const oneOfEach: SelectableFact[] = [
    fact({ key: "practice_encounter:e", label: "ZZ-E", category: "encounter", sourceTable: "practice_encounter" }),
    CURRENT_DX, CURRENT_RX,
    fact({ key: "practice_procedure:p", label: "ZZ-P", category: "procedure", sourceTable: "practice_procedure" }),
    fact({ key: "practice_encounter_investigation:i", label: "ZZ-I", category: "investigation", sourceTable: "practice_encounter_investigation" }),
    fact({ key: "practice_medication:m", label: "ZZ-M", category: "medication", sourceTable: "practice_medication" }),
    fact({ key: "practice_follow_up:f", label: "ZZ-F", category: "follow_up", sourceTable: "practice_follow_up" }),
  ];
  const everything = composeReferralLetter(baseInput(oneOfEach));
  ok("4c. every fact category has a section -- none is silently dropped",
    everything.usedFactKeys.length === oneOfEach.length,
    `${everything.usedFactKeys.length} of ${oneOfEach.length}`);

  // ── 5. REGENERATION DOES NOT BROADEN SCOPE ───────────────────────────────────────────────────────
  const again = composeReferralLetter(baseInput([CURRENT_DX, CURRENT_RX]));
  ok("5a. the same selection composes byte-identically", again.body === composed.body);
  const narrowed = composeReferralLetter(baseInput([CURRENT_DX]));
  ok("5b. a narrowed selection discloses strictly less",
    narrowed.usedFactKeys.length === 1 && !narrowed.body.includes("ZZ-CURRENT-RX"));

  // ── 6. THE SHAPE THAT KEEPS SECTION 1 TRUE ───────────────────────────────────────────────────────
  const composeSrc = read("src/lib/practice/document-compose.ts");
  const composeCode = strip(composeSrc);
  const imports = [...composeCode.matchAll(/^import\s+([\s\S]*?)from\s+"([^"]+)"/gm)].map(m => m[2]);
  // ⚠ AN ALLOWLIST, AND EVERY MEMBER IS CHECKED TOO. The first version pinned "exactly one import",
  // which went red the moment the composer legitimately needed the semantic roles from
  // document-style. Pinning a count says nothing about purity: one import of a database client would
  // have passed it. What matters is that nothing the composer imports can reach a record, so each
  // allowed module is opened and checked for a client of its own.
  const COMPOSER_MAY_IMPORT = ["@/lib/practice/document-facts", "@/lib/practice/document-style"];
  ok("6a. the composer imports only modules that cannot reach a record",
    imports.every(i => COMPOSER_MAY_IMPORT.includes(i)),
    `imports: ${imports.join(", ")}`);
  // ⚠ ONLY A VALUE IMPORT CAN CARRY BEHAVIOUR. document-facts DOES reach the database -- selectableFacts
  // takes an admin client -- but the composer imports only TYPES from it, which are erased at compile
  // time and cannot execute. Checking the whole module would have failed on a module the composer
  // provably cannot call into. So: type imports are free, and every VALUE import is opened and checked.
  const valueImports = [...composeCode.matchAll(/^import\s+(?!type\s)([\s\S]*?)from\s+"([^"]+)"/gm)]
    .map(m => m[2]);
  ok("6a-i. every module the composer imports for its VALUES is itself unable to reach a record",
    valueImports.every(m => {
      const src = strip(read(m.replace("@/", "src/") + ".ts"));
      return !/@supabase\/supabase-js/.test(src) && !/\bfrom\s*\(/.test(src) && !/\badmin\b/.test(src);
    }),
    `value imports: ${valueImports.join(", ") || "(none)"}`);
  ok("6b. the composer cannot read a record",
    !/\bfrom\s*\(/.test(composeCode) && !/\bfetch\s*\(/.test(composeCode) && !/\badmin\b/.test(composeCode));
  ok("6c. the composer holds no clock -- the practice day is passed in",
    !/Date\.now\(\)/.test(composeCode) && !/new Date\(/.test(composeCode));

  // s19: "Blank/manual document authoring remains available for exceptions."
  ok("6d. the manual document route still exists",
    fs.existsSync(path.join(root, "src/app/api/v1/practice/documents/route.ts")));
  ok("6e. and generation did not become the only path",
    strip(read("src/app/api/v1/practice/documents/route.ts")).includes("createDocument("));

  // s19: no second document repository.
  const engineCode = strip(read("src/lib/practice/document-automation.ts"));
  ok("6f. generated documents go through the one storage entry point",
    engineCode.includes("createDocument(") && !/insert\(\{[^}]*practice_clinical_document/.test(engineCode));
  ok("6g. the engine never signs or issues",
    !/status:\s*"SIGNED"/.test(engineCode) && !/signed_at/.test(engineCode));

  // The provenance guard's cascade allowance -- without it a signed document becomes undeletable.
  const mig = read("supabase/migrations/353-document-disclosed-facts.sql");
  ok("6h. the signed-facts guard keeps a cascade path",
    /pg_trigger_depth\(\)\s*<\s*2/.test(mig));

  // ── 7. HONEST ABSENCE ────────────────────────────────────────────────────────────────────────────
  //
  // A failed read must not render as "this patient has none recorded".
  const withFailure = await selectableFacts(
    stubAdmin({ practice_patient: [{ id: PAT, workspace_id: WS }] }, "practice_medication"),
    ctx, { patientId: PAT });
  const medGroup = withFailure?.groups.find(g => g.category === "medication");
  ok("7a. a failed category read is marked unreadable", medGroup?.unreadable != null);
  const dxGroup = withFailure?.groups.find(g => g.category === "diagnosis");
  ok("7b. CONTROL -- a healthy category alongside it is NOT marked unreadable",
    dxGroup != null && dxGroup.unreadable === null);

  // ── 8. THE RECIPIENT IS RENDERED ONCE ────────────────────────────────────────────────────────────
  //
  // Migration 352 keeps practice_referral.referred_to as the rendered recipient. That promise holds
  // only while the letter and the referral row use the same renderer.
  ok("8a. the recipient line is what the letter addresses",
    composed.body.includes(recipientLine(RECIPIENT)));
  ok("8b. a service is addressed as a colleague, not by a person's name",
    composeReferralLetter({ ...baseInput([CURRENT_DX]), recipient: { kind: "specialty", displayName: "Cardiology" } })
      .body.includes("Dear Colleague,"));
  ok("8c. the title names the patient",
    composed.title === "Referral letter - Aisha Nakato");

  // ── 9. VISIT SUMMARY (Phase 2, s5 priority 2) ────────────────────────────────────────────────────
  //
  // s17: "Current encounter generates without manual re-entry." The composer takes no typed input at
  // all, which is what makes that testable rather than aspirational.
  const summary = composeVisitSummary({
    today: "2026-08-23", visitDate: "2026-08-22", patient: PATIENT,
    facts: [CURRENT_DX, CURRENT_RX], practitionerName: "Dr Grace Aine", practiceName: "Competen Clinic",
  });

  ok("9a. the visit summary carries the consultation's facts",
    summary.body.includes("ZZ-CURRENT-DX") && summary.body.includes("ZZ-CURRENT-RX"));
  ok("9b. it names the patient and the day of the visit",
    summary.body.includes("Visit summary for Aisha Nakato - 26-000141") && summary.body.includes("Date of visit: 2026-08-22"));

  // A PATIENT DOCUMENT IS NOT A LETTER TO A COLLEAGUE. No recipient, no salutation, and the headings
  // come from the patient set -- if the clinician headings leaked in, the patient would be reading
  // "Treatment given" and "Follow-up arranged" about themselves.
  ok("9c. it addresses nobody and salutes nobody",
    !summary.body.includes("Dear") && !summary.body.includes("Yours sincerely"));
  ok("9d. it uses the patient headings, not the clinician ones",
    summary.body.includes("What we found") && !summary.body.includes("Diagnoses"));
  ok("9e. and the facts under them are unchanged -- only the heading differs",
    summary.body.includes("- ZZ-CURRENT-DX (confirmed)"));

  const summaryEntitled = [
    "2026-08-23", "Visit summary for Aisha Nakato - 26-000141", "Date of visit: 2026-08-22",
    "What we found", "ZZ-CURRENT-DX", "confirmed", "Treatment", "ZZ-CURRENT-RX", "oral - 5 days",
    "Seen by Dr Grace Aine", "Competen Clinic",
  ];
  let sResidue = summary.body;
  for (const piece of [...summaryEntitled].sort((a, b) => b.length - a.length)) sResidue = sResidue.split(piece).join("");
  ok("9f. GROUNDING -- nothing in the visit summary is unaccounted for",
    sResidue.replace(/[\s\-(),:]/g, "") === "", `residue: ${JSON.stringify(sResidue.slice(0, 120))}`);
  ok("9g. the title names the document and the patient", summary.title === "Visit summary - Aisha Nakato");

  // ── 10. PATIENT INSTRUCTIONS (Phase 2, s5 priority 3) ────────────────────────────────────────────
  const instructions = composePatientInstructions({
    today: "2026-08-23", patient: PATIENT, instructions: "ZZ-TYPED-INSTRUCTION",
    facts: [CURRENT_RX], practitionerName: "Dr Grace Aine", practiceName: "Competen Clinic",
  });

  ok("10a. what the practitioner typed appears", instructions.body.includes("ZZ-TYPED-INSTRUCTION"));
  ok("10b. and it LEADS, before the recorded facts",
    instructions.body.indexOf("ZZ-TYPED-INSTRUCTION") < instructions.body.indexOf("ZZ-CURRENT-RX"));
  ok("10c. the selected treatment appears under a patient heading",
    instructions.body.includes("Treatment") && instructions.body.includes("ZZ-CURRENT-RX"));

  const instructionsEntitled = [
    "2026-08-23", "Instructions for Aisha Nakato - 26-000141", "What to do", "ZZ-TYPED-INSTRUCTION",
    "Treatment", "ZZ-CURRENT-RX", "oral - 5 days", "Prepared by Dr Grace Aine", "Competen Clinic",
  ];
  let iResidue = instructions.body;
  for (const piece of [...instructionsEntitled].sort((a, b) => b.length - a.length)) iResidue = iResidue.split(piece).join("");
  ok("10d. GROUNDING -- nothing in the instructions is unaccounted for",
    iResidue.replace(/[\s\-(),:]/g, "") === "", `residue: ${JSON.stringify(iResidue.slice(0, 120))}`);

  // A sheet with no typed instruction is still legitimate -- the ticked facts carry it.
  const ticksOnly = composePatientInstructions({
    today: "2026-08-23", patient: PATIENT, instructions: null,
    facts: [CURRENT_RX], practitionerName: null, practiceName: null,
  });
  ok("10e. with nothing typed, no empty 'What to do' heading is printed",
    !ticksOnly.body.includes("What to do") && ticksOnly.body.includes("ZZ-CURRENT-RX"));

  // ── 11. ONE PIPELINE, AND THE VOCABULARY THAT MIRRORS IT ─────────────────────────────────────────
  //
  // s6/s19/s20. Three document types now exist. The claim that they share one engine is only worth
  // anything if it is checked -- a fourth generator that quietly calls createDocument itself would
  // still work, and would still be the "collection of one-off letter forms" s20 forbids.
  const engineSrc = strip(read("src/lib/practice/document-automation.ts"));
  const generators = [...engineSrc.matchAll(/export async function (generate\w+)/g)].map(m => m[1]);

  // ⚠ THE DELIVERED SET IS NAMED, NOT COUNTED, and the first version of this counted.
  //
  // "generators.length === 3" was correct in Phase 2 and wrong the moment Phase 3 added four more --
  // it failed on correct code and told me nothing about what had changed. Naming them catches the
  // thing worth catching (a generator disappearing) and makes adding one a deliberate edit here
  // rather than a number to bump. Everything below stays RELATIONAL to generators.length, so those
  // assertions never need touching again.
  const EXPECTED = [
    "generateReferralLetter", "generateVisitSummary", "generatePatientInstructions",
    "generateClinicalSummary", "generateInvestigationRequest", "generateFollowUpInstructions",
    "generateMedicationList",
  ];
  ok("11a. every document s5 priorities 1-7 names has a generator",
    EXPECTED.every(e => generators.includes(e)),
    `missing: ${EXPECTED.filter(e => !generators.includes(e)).join(", ")}`);
  ok("11b. exactly one call site stores a document",
    (engineSrc.match(/createDocument\(/g) ?? []).length === 1);
  ok("11c. every generator ends at the shared store()",
    (engineSrc.match(/return store\(|await store\(|stored = await store\(/g) ?? []).length === generators.length);
  ok("11d. and every generator starts at the shared prepare()",
    (engineSrc.match(/await prepare\(/g) ?? []).length === generators.length);

  // ⚠ THE VOCABULARY FAN-OUT. Migration 354 widened the doc_type CHECK, and the label for a type lives
  // in THREE separate lists. A type the engine writes but a list does not name renders blank in the
  // documents workspace and cannot be filtered for -- the same shape as a catalogue insert shipped
  // without its backfill.
  // ⚠ THE WRITE SITE, NOT EVERY MENTION. Since CPR-DOC-CONFIG-001 each generator names its type twice:
  // once passing it to prepare(), which is a READ used to resolve family and type overrides, and once
  // passing it to store(), which is the write. Counting both reported fourteen types for seven
  // generators.
  //
  // The discriminator is the trailing comma: prepare's docType CLOSES its object literal
  // (`docType: "x" })`), store's is followed by more properties. A first attempt excluded matches
  // preceded by "...args, " instead, which missed the two generators that pass alsoCurrent as well --
  // a needle chosen from three examples that did not hold for the other four.
  const written = [...engineSrc.matchAll(/docType: "(\w+)",/g)].map(m => m[1]);
  ok("11e. each generator writes exactly one document type, and no two share one",
    written.length === generators.length && new Set(written).size === written.length,
    `${written.length} types for ${generators.length} generators: ${written.join(", ")}`);

  const intelligenceBlock = strip(read("src/lib/practice/intelligence.ts"))
    .split("const DOCUMENT_TYPES")[1]?.split("];")[0] ?? "";
  const missing = written.filter(t =>
    !DOC_TYPES.some(([v]) => v === t)
    || !DOC_TYPE_OPTIONS.some(([v]) => v === t)
    || !intelligenceBlock.includes(`"${t}"`));
  ok("11f. every type the engine writes has a label in all three lists",
    missing.length === 0, `unlabelled: ${missing.join(", ")}`);

  // The CHECK spans several lines, so it is flattened before matching rather than matched with the
  // dot-all flag -- this project's TS target predates it, and tsc rejects `/s`.
  const flatten = (sql: string) => sql.replace(/\s+/g, " ");
  const mig354 = flatten(read("supabase/migrations/354-patient-instructions-document-type.sql"));
  ok("11g. and the one type 354 added is in the CHECK it rewrites",
    /check \(doc_type in \([^)]*'patient_instructions'/.test(mig354));

  // ── 12. PHASE 3: PRIORITIES 4 TO 7 ───────────────────────────────────────────────────────────────
  const INVESTIGATION = fact({
    key: "practice_encounter_investigation:55555555-5555-5555-5555-555555555555", label: "ZZ-INVESTIGATION",
    category: "investigation", sourceTable: "practice_encounter_investigation", detail: "requested",
  });
  const FOLLOW_UP = fact({
    key: "practice_follow_up:66666666-6666-6666-6666-666666666666", label: "ZZ-FOLLOW-UP",
    category: "follow_up", sourceTable: "practice_follow_up", detail: "review - due 2026-09-10",
    scope: "historical", defaultSelected: false,
  });
  const patientBase = {
    today: "2026-08-24", patient: PATIENT,
    practitionerName: "Dr Grace Aine", practiceName: "Competen Clinic",
  };

  // Clinical summary (priority 4) -- the longitudinal one, to a colleague.
  const clinical = composeClinicalSummary({
    ...patientBase, recipient: RECIPIENT, purpose: "ZZ-TYPED-PURPOSE",
    periodFrom: "2026-01-01", periodTo: "2026-08-24", facts: [CURRENT_DX, HISTORIC_DX],
  });
  ok("12a. the clinical summary states the purpose it was written for",
    clinical.body.includes("Purpose of this summary") && clinical.body.includes("ZZ-TYPED-PURPOSE"));
  ok("12b. and the period it covers, when one was chosen",
    clinical.body.includes("Period covered: 2026-01-01 to 2026-08-24"));
  ok("12c. it carries historical facts once selected -- that is what longitudinal means",
    clinical.body.includes("ZZ-HISTORIC-DX"));

  // ⚠ NO PERIOD, NO CLAIM. A summary with no chosen range must not assert completeness -- the registry
  // caps each category at CATEGORY_LIMIT, so "the full record" would be false on any long record.
  const noPeriod = composeClinicalSummary({
    ...patientBase, recipient: RECIPIENT, purpose: "ZZ-TYPED-PURPOSE",
    periodFrom: null, periodTo: null, facts: [CURRENT_DX],
  });
  ok("12d. with no period chosen, no period line and no claim of completeness",
    !noPeriod.body.includes("Period covered") && !/full record|complete record|entire record/i.test(noPeriod.body));

  // Investigation request (priority 5) -- destination optional.
  const withLab = composeInvestigationRequest({
    ...patientBase, recipient: RECIPIENT, clinicalIndication: "ZZ-TYPED-INDICATION", facts: [INVESTIGATION],
  });
  ok("12e. the investigation request names the investigation and the indication",
    withLab.body.includes("ZZ-INVESTIGATION") && withLab.body.includes("ZZ-TYPED-INDICATION"));
  const noLab = composeInvestigationRequest({
    ...patientBase, recipient: null, clinicalIndication: "ZZ-TYPED-INDICATION", facts: [INVESTIGATION],
  });
  ok("12f. with no destination it salutes nobody, rather than greeting an empty address",
    !noLab.body.includes("Dear") && !noLab.body.includes("Dr Okello"));
  ok("12g. and it still says who requested it", noLab.body.includes("Requested by Dr Grace Aine"));

  // Follow-up instructions (priority 6) -- patient-facing.
  const followUp = composeFollowUpInstructions({
    ...patientBase, instructions: "ZZ-TYPED-WHERE", facts: [FOLLOW_UP],
  });
  ok("12h. the follow-up sheet lists what is owed, under the patient heading",
    followUp.body.includes("Next steps") && followUp.body.includes("ZZ-FOLLOW-UP"));
  ok("12i. and carries what the practitioner added", followUp.body.includes("ZZ-TYPED-WHERE"));

  // Medication list (priority 7) -- one-click, no typed input at all.
  const meds = composeMedicationList({ ...patientBase, facts: [HISTORIC_MED] });
  ok("12j. the medication list carries current medication regardless of when it was started",
    meds.body.includes("ZZ-HISTORIC-MED"));
  ok("12k. and states the day it was correct on -- an undated list is read as current forever",
    meds.body.includes("Correct as at 2026-08-24"));

  const medsEntitled = [
    "2026-08-24", "Medication list for Aisha Nakato - 26-000141", "Correct as at 2026-08-24",
    "Your medication", "ZZ-HISTORIC-MED", "Prepared by Dr Grace Aine", "Competen Clinic",
  ];
  let mResidue = meds.body;
  for (const piece of [...medsEntitled].sort((a, b) => b.length - a.length)) mResidue = mResidue.split(piece).join("");
  ok("12l. GROUNDING -- nothing in the medication list is unaccounted for",
    mResidue.replace(/[\s\-(),:]/g, "") === "", `residue: ${JSON.stringify(mResidue.slice(0, 120))}`);

  // ── 13. THE DISCLOSURE DEFAULT PHASE 3 CHANGED ───────────────────────────────────────────────────
  //
  // Phase 1 froze the scope rule as having no exceptions. The medication list broke that, so the rule
  // is now event-versus-state. These assertions pin the NEW rule and, more importantly, pin the limit
  // on it: a purpose may pull in its own subject and nothing else.
  const mixed = groupsOf([CURRENT_DX, HISTORIC_DX, HISTORIC_MED, FOLLOW_UP]);

  ok("13a. without asking, the s9 scope rule is unchanged -- only this consultation",
    JSON.stringify(defaultSelection(mixed)) === JSON.stringify([CURRENT_DX.key]));
  ok("13b. a purpose that asks for medication gets current medication whenever it started",
    defaultSelection(mixed, { alsoCurrent: ["medication"] }).includes(HISTORIC_MED.key));
  ok("13c. ⚠ and asking for medication does NOT drag in a historical diagnosis",
    !defaultSelection(mixed, { alsoCurrent: ["medication"] }).includes(HISTORIC_DX.key));
  ok("13d. the same for follow-up, which is the only other current-state category",
    defaultSelection(mixed, { alsoCurrent: ["follow_up"] }).includes(FOLLOW_UP.key)
    && !defaultSelection(mixed, { alsoCurrent: ["follow_up"] }).includes(HISTORIC_MED.key));
  ok("13e. only categories the registry status-filters may be treated as current state",
    JSON.stringify([...CURRENT_STATE_CATEGORIES].sort()) === JSON.stringify(["follow_up", "medication"]));

  // ── 14. WHAT THE REGISTRY REFUSES TO OFFER ───────────────────────────────────────────────────────
  //
  // The event/state rule in section 13 is only safe because "every offered medication fact" IS "the
  // current medication". These assertions are what make that sentence true rather than hopeful.
  const KAMPALA = "Africa/Kampala";
  const clinicRows = {
    practice_patient: [{ id: PAT, workspace_id: WS }],
    practice_workspace: [{ id: WS, name: "Competen Clinic", timezone: KAMPALA }],
    practice_configuration: [{ workspace_id: WS, is_effective: true }],
    practice_medication: [
      { id: "m1", workspace_id: WS, patient_id: PAT, generic_name: "ZZ-ACTIVE-MED", status: "active", dose_text: "1 tab", created_at: "2026-06-01T09:00:00Z" },
      { id: "m2", workspace_id: WS, patient_id: PAT, generic_name: "ZZ-STOPPED-MED", status: "discontinued", dose_text: "1 tab", created_at: "2026-06-02T09:00:00Z" },
    ],
    practice_follow_up: [
      { id: "f1", workspace_id: WS, patient_id: PAT, reason: "ZZ-OPEN-FU", kind: "review", status: "OPEN", due_on: "2026-09-10", priority: "routine", created_at: "2026-06-01T09:00:00Z" },
      { id: "f2", workspace_id: WS, patient_id: PAT, reason: "ZZ-CANCELLED-FU", kind: "review", status: "CANCELLED", due_on: "2026-09-11", priority: "routine", created_at: "2026-06-02T09:00:00Z" },
    ],
  };
  const offered = await selectableFacts(stubAdmin(clinicRows), ctx, { patientId: PAT });
  const labels = JSON.stringify(offered?.groups ?? []);

  ok("14a. a discontinued medication is never offered", !labels.includes("ZZ-STOPPED-MED"));
  ok("14b. CONTROL -- an active one is", labels.includes("ZZ-ACTIVE-MED"));
  // ⚠ PHASE 1 SHIPPED WITHOUT THIS FILTER. A cancelled follow-up printed under "Next steps" tells a
  // patient to attend something that was called off.
  ok("14c. a cancelled follow-up is never offered", !labels.includes("ZZ-CANCELLED-FU"));
  ok("14d. CONTROL -- an outstanding one is", labels.includes("ZZ-OPEN-FU"));

  // THE DATE RANGE IS THE PRACTICE'S DAY, NOT THE SERVER'S.
  //
  // Kampala is UTC+3, so a record at 18:00Z on the 31st is the evening of the 31st there and belongs
  // in a range ending on the 31st. One at 22:00Z is already the 1st in Kampala and does not. Under a
  // naive UTC bound the second would be included -- which is the whole bug this checks for.
  const edgeRows = {
    ...clinicRows,
    practice_diagnosis: [
      { id: "d1", workspace_id: WS, patient_id: PAT, label: "ZZ-EVENING-31ST", certainty: "confirmed", created_at: "2026-08-31T18:00:00Z" },
      { id: "d2", workspace_id: WS, patient_id: PAT, label: "ZZ-ALREADY-1ST", certainty: "confirmed", created_at: "2026-08-31T22:00:00Z" },
    ],
  };
  const ranged = await selectableFacts(stubAdmin(edgeRows), ctx, { patientId: PAT, to: "2026-08-31" });
  const rangedLabels = JSON.stringify(ranged?.groups ?? []);
  ok("14e. a range ending on the 31st keeps the evening of the 31st in the practice's zone",
    rangedLabels.includes("ZZ-EVENING-31ST"));
  ok("14f. and excludes what is already the next day there",
    !rangedLabels.includes("ZZ-ALREADY-1ST"));

  // ── 15. WHAT PHASE 3 DELIBERATELY DID NOT BUILD ──────────────────────────────────────────────────
  //
  // s19 requires phased implementation to be "explicitly tracked", and s14 forbids free-generating
  // statutory documents. Priority 8 (sick leave / fitness) is therefore absent BY DECISION, not by
  // oversight, and this asserts the decision so that adding one later is a deliberate act that has to
  // delete a test with s14 written on it.
  ok("15a. no generator issues a sick note or a fitness certificate",
    !written.includes("sick_note") && !written.some(t => /fitness|incapacity/.test(t)),
    written.join(", "));
  ok("15b. nothing in the engine decides fitness, incapacity or duration",
    !/\bfitness\b|\bincapacity\b|\bunfit\b/i.test(engineSrc));
  const mig355 = flatten(read("supabase/migrations/355-phase-three-document-types.sql"));
  ok("15c. and 355 records why priority 8 is missing rather than leaving a gap",
    /section 14/i.test(mig355) && /controlled template/i.test(mig355));

  // ── 16. AI PHRASING (s10) ────────────────────────────────────────────────────────────────────────
  //
  // s10 lets a model "improve organization, grammar and professional phrasing" and forbids it inventing
  // seven named things. A prompt saying so is a hope. verifyGrounded is the control, and it is pure, so
  // every case below runs without a model, a network or a database.
  //
  // WHAT A VIOLATION MEANS HERE: the prose is DISCARDED and the deterministic lists are used instead.
  // Nothing in this module can produce an unverified document, so these tests are about whether the
  // net catches things, not about whether something bad reaches a patient.

  const PHRASE_FACTS = [
    fact({ key: "practice_medication:p1", label: "Metformin", category: "medication",
           sourceTable: "practice_medication", detail: "500mg - oral - twice daily - 5 days" }),
    fact({ key: "practice_diagnosis:p2", label: "Type 2 diabetes mellitus", detail: "confirmed" }),
  ];
  const GOOD = "Current medication\nMetformin 500mg is taken orally twice daily for 5 days.\n\n"
    + "Diagnoses\nThere is a confirmed diagnosis of type 2 diabetes mellitus.";

  ok("16a. CONTROL -- faithful prose verifies, so the net is not simply rejecting everything",
    verifyGrounded(GOOD, PHRASE_FACTS).length === 0,
    JSON.stringify(verifyGrounded(GOOD, PHRASE_FACTS)));

  // A DOSE THAT WAS NEVER RECORDED. The most dangerous invention and the most detectable.
  const badDose = verifyGrounded(GOOD.replace("500mg", "850mg"), PHRASE_FACTS);
  ok("16b. an invented dose is caught",
    badDose.some(v => v.kind === "ungrounded_number" && v.token === "850"));

  // SPELLED OUT. Without the number-word map this walks straight through.
  const badWord = verifyGrounded(GOOD + " Treatment continued for seven days.", PHRASE_FACTS);
  ok("16c. an invented duration spelled as a word is caught",
    badWord.some(v => v.kind === "ungrounded_number" && v.token === "seven"));
  ok("16d. CONTROL -- a spelled number that IS in the payload passes",
    verifyGrounded(GOOD + " Taken for five days.", PHRASE_FACTS)
      .every(v => v.kind !== "ungrounded_number"));

  // A MONTH SWAP passes every number check, because the digits still match.
  const dated = [fact({ key: "practice_follow_up:p3", label: "Review appointment", category: "follow_up",
                        sourceTable: "practice_follow_up", detail: "due 2026-09-10" })];
  ok("16e. CONTROL -- a date rewritten in words, with the right month, verifies",
    verifyGrounded("Next steps\nA review appointment is due on 10 September 2026.", dated).length === 0);
  ok("16f. the same sentence with the month swapped is caught",
    verifyGrounded("Next steps\nA review appointment is due on 10 October 2026.", dated)
      .some(v => v.kind === "ungrounded_month" && v.token === "october"));

  // ASSERTED FINDINGS -- s10's severity, examination, result, response and recurrence.
  for (const [phrase, token] of [
    ["The patient is stable.", "stable"],
    ["Examination was unremarkable.", "unremarkable"],
    ["She tolerated it well.", "tolerated"],
    ["Symptoms improved.", "improved"],
    ["This is a recurrent problem.", "recurrent"],
    ["Blood pressure was normal.", "normal"],
  ] as [string, string][]) {
    ok(`16g. an asserted finding is caught -- "${token}"`,
      verifyGrounded(GOOD + " " + phrase, PHRASE_FACTS)
        .some(v => v.kind === "asserted_finding" && v.token === token));
  }

  // ⚠ AND THE SAME WORD IS FINE WHEN THE RECORD CONTAINS IT. A diagnosis genuinely recorded as
  // "resolved pneumothorax" must not be rejected -- that would be the verifier inventing a problem.
  const resolvedFact = [fact({ key: "practice_diagnosis:p4", label: "Resolved pneumothorax", detail: "confirmed" })];
  ok("16h. CONTROL -- a marker word present in the record is not a violation",
    verifyGrounded("Diagnoses\nThere is a confirmed resolved pneumothorax.", resolvedFact).length === 0);

  // PRACTITIONER-TYPED TEXT COUNTS AS GROUNDING (s17).
  ok("16i. a number the practitioner typed is grounded",
    verifyGrounded("Diagnoses\nType 2 diabetes mellitus, reviewed over 3 visits.",
      [PHRASE_FACTS[1]], ["reviewed over 3 visits"]).length === 0);

  // A DROPPED FACT is not a safety problem in the same direction, but practice_document_fact would
  // then record a disclosure the document does not contain.
  ok("16j. a fact the prose omitted is caught",
    verifyGrounded("Diagnoses\nThere is a confirmed diagnosis of type 2 diabetes mellitus.", PHRASE_FACTS)
      .some(v => v.kind === "fact_missing" && v.label === "Metformin"));
  ok("16k. empty prose is caught rather than treated as a clean pass",
    verifyGrounded("   ", PHRASE_FACTS).some(v => v.kind === "empty"));

  // ── 17. THE BOUNDARY s10 DRAWS AROUND THE PRACTITIONER'S OWN WORDS ───────────────────────────────
  //
  // s10: "Clearly separate practitioner-entered referral reason/question from generated narrative."
  // The guarantee is structural -- narrative replaces the FACT BLOCKS and nothing else -- so this
  // checks that the scaffold and the typed text survive a rephrasing untouched.
  const phrasedLetter = composeReferralLetter({
    ...baseInput([CURRENT_DX, CURRENT_RX]),
    narrative: "Diagnoses\nZZ-AI-PROSE mentioning ZZ-CURRENT-DX and ZZ-CURRENT-RX.",
  });
  ok("17a. the verified prose is what appears", phrasedLetter.body.includes("ZZ-AI-PROSE"));
  ok("17b. ⚠ the practitioner's typed reason and requested action survive verbatim",
    phrasedLetter.body.includes("ZZ-TYPED-REASON") && phrasedLetter.body.includes("ZZ-TYPED-ACTION"));
  ok("17c. and the scaffold is untouched -- recipient, salutation, subject line, sign-off",
    phrasedLetter.body.includes("Dr Okello") && phrasedLetter.body.includes("Dear Dr Okello,")
    && phrasedLetter.body.includes("Re: Aisha Nakato") && phrasedLetter.body.includes("Yours sincerely,"));
  ok("17d. the labelled list it replaced is gone",
    !phrasedLetter.body.includes("- ZZ-CURRENT-DX (confirmed)"));
  ok("17e. and provenance still comes from the FACTS, not from the prose",
    phrasedLetter.usedFactKeys.length === 2 && phrasedLetter.usedFactKeys.includes(CURRENT_RX.key));

  // Same boundary on a patient document.
  const phrasedInstructions = composePatientInstructions({
    ...patientBase, instructions: "ZZ-TYPED-INSTRUCTION", facts: [CURRENT_RX],
    narrative: "Treatment\nZZ-AI-PROSE about ZZ-CURRENT-RX.",
  });
  ok("17f. a patient document keeps its typed instruction alongside the prose",
    phrasedInstructions.body.includes("ZZ-TYPED-INSTRUCTION") && phrasedInstructions.body.includes("ZZ-AI-PROSE"));

  // ── 18. THE SHAPE THAT KEEPS SECTION 16 TRUE ─────────────────────────────────────────────────────
  const phrasingSrc = strip(read("src/lib/practice/document-phrasing.ts"));
  const phrasingImports = [...phrasingSrc.matchAll(/^import\s+([\s\S]*?)from\s+"([^"]+)"/gm)].map(m => m[2]);
  ok("18a. the phrasing module reaches the model and the fact types, and nothing else",
    phrasingImports.length === 2
    && phrasingImports.includes("@/lib/ai/client")
    && phrasingImports.includes("@/lib/practice/document-facts"),
    phrasingImports.join(", "));
  ok("18b. it cannot read a record -- no client, no query",
    !/\bfrom\s*\(/.test(phrasingSrc) && !/\badmin\b/.test(phrasingSrc) && !/supabase/i.test(phrasingSrc));

  // s2's bounded payload: the model is sent sections of facts, so it CANNOT be sent an identity.
  ok("18c. the payload the model receives is built from sections of facts alone",
    /export function phrasingPayload\(sections: \{ heading: string; facts: SelectableFact\[\] \}\[\]\)/.test(phrasingSrc));
  const payloadSample = phrasingPayload([{ heading: "Diagnoses", facts: PHRASE_FACTS }]);
  ok("18d. and it carries no patient identity",
    !payloadSample.includes("Aisha") && !payloadSample.includes("26-000141"));

  // s18: "Never expose prompts, model parameters ... to practitioners."
  const uiFiles = ["src/app/practice/(shell)/encounters/[encounterId]/DocumentComposer.tsx",
                   "src/app/practice/(shell)/encounters/[encounterId]/EncounterConsole.tsx"];
  ok("18e. no practitioner-facing screen imports the prompt module",
    uiFiles.every(p => !strip(read(p)).includes("document-phrasing")));

  // Every refusal path must land on deterministic. A path that returned prose without verifying, or
  // threw, would be the one that matters.
  const refusals = (phrasingSrc.match(/phrasing: "deterministic", reason:/g) ?? []).length;
  ok("18f. every refusal path returns deterministic rather than throwing or returning prose",
    refusals >= 5, `${refusals} refusal paths`);
  // ⚠ MATCH THE RETURN, NOT THE TYPE. The first version counted `phrasing: "assisted"` anywhere, which
  // includes the PhrasingResult union's own declaration -- so it failed on correct code and said
  // nothing about where prose is actually returned.
  //
  // ⚠ AND THE VERIFY CALL MUST BE PRESENT, NOT MERELY EARLIER. Deleting verification outright made
  // indexOf return -1, and -1 is less than any index, so the ordering check passed with no verifier at
  // all. An ordering assertion over a possibly-absent needle is an assertion about nothing.
  const assistedReturns = phrasingSrc.match(/return \{ phrasing: "assisted"/g) ?? [];
  const verifyAt = phrasingSrc.indexOf("verifyGrounded(result.text");
  ok("18g. assisted prose is returned from exactly one place, and only after verification",
    assistedReturns.length === 1
    && verifyAt >= 0
    && verifyAt < phrasingSrc.indexOf('return { phrasing: "assisted"'),
    `${assistedReturns.length} return site(s), verify at ${verifyAt}`);

  // The engine writes the column only for assisted, and s14's certificate ban still holds.
  // The phrasing write folded into the same update as the content model and the style pin when
  // CPR-DOC-CONFIG-001 arrived -- one round trip instead of three. What matters is unchanged: the
  // column is written only for assisted, never for deterministic.
  ok("18h. the engine records assisted phrasing on the document itself",
    /phrasing: "assisted" \} : \{\}\)/.test(engineSrc));
  ok("18i. every generator routes phrasing through the one helper",
    (engineSrc.match(/await narrativeFor\(/g) ?? []).length === generators.length);
  ok("18j. stale consent is not consent -- the current notice is required",
    /settings\.enabled && settings\.noticeCurrent/.test(engineSrc));

  // ── 19. THE DISCLOSURE MATCHES THE BEHAVIOUR ─────────────────────────────────────────────────────
  //
  // One flag gates two different data flows: the assistant, which sends the open record, and document
  // phrasing, which sends the selected facts and nothing else. The notice a practice accepts is the
  // only place they learn which. Version 1 described the assistant alone, so a practice reading it
  // would reasonably have concluded that asking for a letter in prose ships the whole record.
  //
  // These assertions exist because the failure mode is silent: the notice is prose in a constant, the
  // behaviour is in another module, and nothing makes them disagree loudly.
  const notice = AI_NOTICE.join(" ").toLowerCase();
  ok("19a. the disclosure covers the document flow, not only the assistant",
    notice.includes("document"));
  ok("19b. it says what that flow does NOT send",
    notice.includes("not the patient's name") || notice.includes("not the rest of the record"));

  // ⚠ THE CLAIM MOST EASILY MADE FALSE BY A LATER EDIT. The notice promises that what a practitioner
  // types is not sent to the provider. That holds only because generate() is handed the payload
  // builder's output -- passing the typed text for "context" would quietly make the disclosure a lie.
  // ⚠ ANCHORED TO THE END OF THE ARGUMENT, because a prefix match is not "and nothing else". Appending
  // the typed text to the payload left this passing -- the needle was still there, with a leak after it.
  ok("19c. the model call sends the bounded payload and nothing else",
    /user: phrasingPayload\(args\.sections\),\s*\n/.test(phrasingSrc));
  ok("19d. and the practitioner's typed text is used only for verification",
    /verifyGrounded\(result\.text, facts, args\.typed\)/.test(phrasingSrc)
    && (phrasingSrc.match(/args\.typed/g) ?? []).length === 1);

  // The notice must not promise more than the verifier delivers -- see ASSERTION_MARKERS.
  ok("19e. it does not claim the grounding check is perfect",
    notice.includes("not perfect") || notice.includes("read the draft"));

  // ── 20. THE CONTENT MODEL AND THE STYLE CONTRACT (CPR-DOC-CONFIG-001) ────────────────────────────
  //
  // s15 wants the renderer to receive a content model rather than a string, and s8 wants sections to
  // carry semantic roles so no form hard-codes a colour. s11 wants a published style never to repaint
  // a document that has already been issued.

  // ⚠ THE INVARIANT THE WHOLE MODEL RESTS ON. body is DERIVED from blocks by renderPlainText -- if the
  // two could be built independently they would drift, and the drift would first be visible as a
  // signed letter rendering differently from the text that was signed. Checked for every composer,
  // because one composer quietly assembling its own string is exactly how this would rot.
  const composedAll = [
    ["referral letter", composed],
    ["visit summary", summary],
    ["patient instructions", instructions],
    ["clinical summary", clinical],
    ["investigation request", withLab],
    ["follow-up instructions", followUp],
    ["medication list", meds],
  ] as [string, { body: string; blocks: DocumentBlock[] }][];

  const drifted = composedAll.filter(([, d]) => d.body !== renderPlainText(d.blocks)).map(([n]) => n);
  ok("20a. every document's body is exactly what its blocks render to",
    drifted.length === 0, `drifted: ${drifted.join(", ")}`);

  // CONTROL: if blocks were empty, 20a would pass by comparing "" to "".
  ok("20b. CONTROL -- the blocks are not empty, so 20a compared something",
    composedAll.every(([, d]) => d.blocks.length >= 3),
    composedAll.map(([n, d]) => `${n}:${d.blocks.length}`).join(" "));

  // s8: sections carry a semantic role, and the role comes from the category.
  const sectionsOf = (d: { blocks: DocumentBlock[] }) =>
    d.blocks.filter((b): b is Extract<DocumentBlock, { kind: "section" }> => b.kind === "section");
  const referralSections = sectionsOf(composed);
  ok("20c. recorded-fact sections carry a semantic role",
    referralSections.length > 0 && referralSections.every(b => SECTION_ROLES.includes(b.role)));
  ok("20d. and the role is the one s8 assigns to that kind of fact",
    referralSections.every(b => Object.values(ROLE_FOR_CATEGORY).includes(b.role)));

  // ⚠ A PROCEDURE IS A TREATMENT, per s8's own grouping. Worth pinning: it is the one mapping that is
  // not the identity, so it is the one a later edit is most likely to "tidy" into its own role.
  ok("20e. a procedure takes the treatment role, as s8 groups them",
    ROLE_FOR_CATEGORY.procedure === "treatment");
  ok("20f. every fact category maps to a role, so no section can be roleless",
    FACT_CATEGORIES.every(c => SECTION_ROLES.includes(ROLE_FOR_CATEGORY[c])));

  // Typed practitioner text is a section too, and takes a role rather than a hard-coded colour.
  const prose = composed.blocks.filter((b): b is Extract<DocumentBlock, { kind: "prose" }> => b.kind === "prose");
  ok("20g. what the practitioner typed is carried as prose with its own role",
    prose.length === 2 && prose[0].role === "purpose" && prose[1].role === "plan",
    prose.map(p => `${p.heading}:${p.role}`).join(" "));

  // The AI narrative replaces the fact sections, so it cannot be given a role -- and must not claim one.
  const phrasedBlocks = phrasedLetter.blocks.filter(b => b.kind === "narrative");
  ok("20h. verified AI prose is carried as narrative, not as a roled section",
    phrasedBlocks.length === 1
    && !phrasedLetter.blocks.some(b => b.kind === "section"));

  // ── 21. STYLE TOKENS AND THEIR GUARDRAILS (s6, s11, s16) ─────────────────────────────────────────
  ok("21a. the platform baseline is itself a valid style",
    validateTokens(PLATFORM_BASELINE).length === 0,
    JSON.stringify(validateTokens(PLATFORM_BASELINE)));
  ok("21b. it defines a tone for every semantic role",
    SECTION_ROLES.every(r => !!PLATFORM_BASELINE.colour.roles[r]));

  // s16 / s18: "Unsafe contrast/font-size choices are blocked or corrected."
  const faint = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  faint.colour.roles.diagnosis.accent = "#DDE9FF"; // pale on pale
  ok("21c. a heading colour too faint on its own band is refused",
    validateTokens(faint).some(p => p.path === "colour.roles.diagnosis"));

  const tiny = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  tiny.typography.bodySize = 8;
  ok("21d. a body size below the readable floor is refused",
    validateTokens(tiny).some(p => p.path === "typography.bodySize"));

  const greyOnWhite = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  greyOnWhite.colour.text = "#BBBBBB";
  ok("21e. body text too faint on the page is refused",
    validateTokens(greyOnWhite).some(p => p.path === "colour.text"));

  // s14: no arbitrary CSS. Anything outside the bounded vocabulary is a problem, not a default.
  const injected = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  injected.colour.primary = "red; background: url(http://evil)";
  ok("21f. a colour that is not a plain hex value is refused",
    validateTokens(injected).some(p => p.path === "colour.primary"));

  const madeUp = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  madeUp.layout.sectionTreatment = "parallax";
  ok("21g. a section treatment outside the approved list is refused",
    validateTokens(madeUp).some(p => p.path === "layout.sectionTreatment"));

  const noFont = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  noFont.typography.bodyFont = "https://fonts.example/Evil.woff2";
  ok("21h. a font outside the approved list is refused -- s14 forbids remote fonts",
    validateTokens(noFont).some(p => p.path === "typography.bodyFont"));

  // s11: a document keeps the style it was rendered with.
  const practiceStyle = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  practiceStyle.colour.primary = "#7C3AED";
  const pinnedStyle = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  pinnedStyle.colour.primary = "#059669";

  ok("21i. HISTORICAL IMMUTABILITY -- a pinned style wins over the practice's current one",
    resolveStyle({ pinned: pinnedStyle, practicePublished: practiceStyle }).tokens.colour.primary === "#059669");
  ok("21j. an unpinned document follows the practice style",
    resolveStyle({ practicePublished: practiceStyle }).source === "practice");
  ok("21k. and a practice with no style gets the platform baseline",
    resolveStyle({}).source === "baseline");

  // A style that no longer validates must not take a document down with it.
  ok("21l. an unreadable pinned style falls back rather than failing",
    resolveStyle({ pinned: { colour: "nonsense" }, practicePublished: practiceStyle }).source === "practice");
  ok("21m. and the caller is told which style it actually got",
    resolveStyle({ pinned: pinnedStyle }).source === "pinned");

  // ── 22. THE DESIGNER (CPR-DOC-CONFIG-001 Phase 2) ────────────────────────────────────────────────
  //
  // s5's presets, s4's preview and s13's permission. The designer screen itself is the owner's to look
  // at; what is checkable here is that every theme it offers can actually be published, that the
  // preview cannot reach a patient, and that no write happens without the capability.

  // ⚠ A THEME A PRACTITIONER CANNOT PUBLISH IS WORSE THAN NO THEME. Every preset must satisfy the same
  // validator that gates publishing -- otherwise somebody picks "Classic", tunes it for ten minutes and
  // is refused at the last step for something they did not choose.
  const badPresets = PRESETS.filter(p => validateTokens(presetTokens(p)).length > 0);
  ok("22a. every theme s5 offers is publishable as it ships",
    badPresets.length === 0,
    badPresets.map(p => `${p}: ${validateTokens(presetTokens(p)).map(x => x.message).join("; ")}`).join(" | "));

  // ⚠ AND THEY INHERIT THE ROLE PALETTE RATHER THAN COPYING IT. Written out in full, each preset would
  // have needed the two contrast corrections applied five more times, and missing one would ship a
  // theme that fails the rule the product enforces everywhere else.
  ok("22b. every theme inherits the baseline section palette, so a colour fix reaches all of them",
    PRESETS.every(p => SECTION_ROLES.every(r =>
      presetTokens(p).colour.roles[r].accent === PLATFORM_BASELINE.colour.roles[r].accent)));

  // s16: meaning must not rest on colour alone -- and the inverse trap is a "monochrome" theme that
  // strips the headings until a diagnosis and a follow-up look identical.
  ok("22c. the monochrome theme drops the bands but keeps each section's heading colour",
    presetTokens("minimal").layout.sectionTreatment === "plain"
    && presetTokens("minimal").colour.roles.diagnosis.accent !== presetTokens("minimal").colour.roles.follow_up.accent);

  // s4: the preview switches across the generated document types.
  const previewed = PREVIEW_DOCUMENTS.map(d => [d.key, previewDocument(d.key)] as const);
  ok("22d. every document type previews, with real structure behind it",
    previewed.length >= 6 && previewed.every(([, doc]) => doc.blocks.length >= 3 && doc.body.length > 100),
    previewed.map(([k, d]) => `${k}:${d.blocks.length}`).join(" "));
  ok("22e. and the preview is the SAME text the composer would generate",
    previewed.every(([, doc]) => doc.body === renderPlainText(doc.blocks)));

  // ⚠ s4: "never another patient's live record merely for theme configuration". Structural, because a
  // behavioural test cannot prove the absence of a read that is not there.
  const previewSrc = strip(read("src/lib/practice/document-preview.ts"));
  ok("22f. the preview module cannot reach a record",
    !/@supabase\/supabase-js/.test(previewSrc) && !/\badmin\b/.test(previewSrc)
    && !/\bpatientId\b/.test(previewSrc) && !/\bfrom\s*\(/.test(previewSrc));
  ok("22g. and it runs the real composers rather than drawing its own approximation",
    /composeReferralLetter\(/.test(previewSrc) && /composeMedicationList\(/.test(previewSrc));

  // s4 also asks for a certificate preview. There is no certificate composer, and s14 is why.
  ok("22h. the missing certificate preview is explained rather than faked",
    /CERTIFICATE_PREVIEW_ABSENT/.test(previewSrc)
    && !/composeSickLeave|composeFitness|composeCertificate/.test(previewSrc));

  // s13: permission. Checked in the ENGINE, so a second caller cannot skip it by not being the route.
  const designSrc = strip(read("src/lib/practice/document-design.ts"));
  const writers = [...designSrc.matchAll(/export async function (saveDraft|publishStyle|restoreDefault)/g)];
  ok("22i. every write path checks the capability itself",
    writers.length === 3
    && (designSrc.match(/hasCapability\(ctx, DESIGN_CAPABILITY\)/g) ?? []).length === 3);
  ok("22j. and it uses an existing capability rather than a role name",
    /DESIGN_CAPABILITY = "practice\.settings\.manage"/.test(designSrc)
    && !/role ===|isOwner|\bowner\b\s*\?/.test(designSrc));

  // s11: a published style is re-validated at the moment of publishing, not only when saved.
  ok("22k. publishing re-validates rather than trusting what was saved",
    designSrc.indexOf("validateTokens(draft.tokens)") > designSrc.indexOf("export async function publishStyle"));
  // s11: the replaced version is archived, never deleted -- documents pinned to it still render from it.
  ok("22l. the style it replaces is archived, not deleted",
    /status: "archived"/.test(designSrc) && !/\.delete\(\)/.test(designSrc));

  // ── 23. THE FIVE LEVELS, AND THE ONE THAT CANNOT BE OVERRIDDEN (Phase 3) ─────────────────────────
  //
  // s2's precedence, s7's structural limits and s10's locked templates. s18 makes the first two
  // acceptance rows in their own right: "Single document > type > family > Practice > platform
  // precedence resolves deterministically" and "Statutory/controlled form ignores prohibited styling
  // while clearly showing why".

  const withOverrides = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  withOverrides.colour.primary = "#111111";
  withOverrides.overrides = {
    family: { correspondence: { colour: { primary: "#222222" }, typography: { bodySize: 12 } } },
    type: { referral_letter: { colour: { primary: "#333333" } } },
  };

  // ⚠ EACH LEVEL BEATS THE ONE BELOW IT, AND ONLY THE PROPERTY IT NAMES. The family sets a body size
  // the type does not mention, so the type override must not discard it -- that is the difference
  // between merging the levels and simply picking one.
  const atType = resolveStyle({ practicePublished: withOverrides, docType: "referral_letter" });
  ok("23a. the type override beats the family, which beats the practice",
    atType.tokens.colour.primary === "#333333", atType.tokens.colour.primary);
  ok("23b. and a property only the family set survives the type override",
    atType.tokens.typography.bodySize === 12);

  const atFamily = resolveStyle({ practicePublished: withOverrides, docType: "clinical_summary" });
  ok("23c. a type with no override of its own still takes its family's",
    atFamily.tokens.colour.primary === "#222222" && atFamily.tokens.typography.bodySize === 12);

  const noFamily = resolveStyle({ practicePublished: withOverrides, docType: "medication_list" });
  ok("23d. and a type in another family takes the practice default",
    noFamily.tokens.colour.primary === "#111111");

  // s12: the per-document change is the highest level, and beats everything.
  const perDoc = resolveStyle({
    practicePublished: withOverrides, docType: "referral_letter",
    documentOverride: { colour: { primary: "#444444" } },
  });
  ok("23e. and this document beats them all",
    perDoc.tokens.colour.primary === "#444444");
  ok("23f. the levels that contributed are reported, so precedence is legible rather than folklore",
    perDoc.applied.join(" > ") === "platform > practice style > family: correspondence > type: referral_letter > this document",
    perDoc.applied.join(" > "));

  // s11 again, now that overrides exist: a pinned style brings its OWN overrides, not today's.
  const pinnedWith = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  pinnedWith.overrides = { type: { referral_letter: { colour: { primary: "#AA0000" } } } };
  ok("23g. a pinned style resolves with the overrides it was published with",
    resolveStyle({ pinned: pinnedWith, practicePublished: withOverrides, docType: "referral_letter" })
      .tokens.colour.primary === "#AA0000");

  // ── s10: locked layouts ──────────────────────────────────────────────────────────────────────────
  const reorderedStyle = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  reorderedStyle.structure.sectionOrder = ["follow_up", "medication", "treatment", "investigation", "procedure", "diagnosis", "encounter"];
  reorderedStyle.colour.primary = "#0000AA";

  const cert = resolveStyle({ practicePublished: reorderedStyle, docType: "sick_note" });
  ok("23h. a certificate ignores a practice section order",
    cert.tokens.structure.sectionOrder[0] === PLATFORM_BASELINE.structure.sectionOrder[0]);
  ok("23i. and says why, rather than ignoring it silently",
    cert.locked && cert.lockedReason === LOCKED_LAYOUT_NOTICE);

  // ⚠ s10 LOCKS THE LAYOUT, NOT THE BRANDING: "Practitioner branding may apply only to permitted
  // header/footer areas." A certificate that also lost the practice's colours would look like a
  // different organisation's document.
  ok("23j. but it keeps the practice's own colours",
    cert.tokens.colour.primary === "#0000AA");
  ok("23k. CONTROL -- an ordinary document is not locked and does take the order",
    (() => { const r = resolveStyle({ practicePublished: reorderedStyle, docType: "referral_letter" });
             return !r.locked && r.tokens.structure.sectionOrder[0] === "follow_up"; })());

  // ── s7: what a style may and may not restructure ─────────────────────────────────────────────────
  const hideClinical = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  hideClinical.structure.hidden = ["diagnosis"];
  ok("23l. a style cannot hide a section carrying recorded clinical facts",
    validateTokens(hideClinical).some(p => p.path === "structure.hidden"));
  const hideAllowed = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  hideAllowed.structure.hidden = ["encounter"];
  ok("23m. CONTROL -- the one section s7 allows hiding is accepted",
    validateTokens(hideAllowed).length === 0);

  const dropped = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  dropped.structure.sectionOrder = dropped.structure.sectionOrder.slice(1);
  ok("23n. an order missing a section is refused, so nothing selected can vanish",
    validateTokens(dropped).some(p => p.path === "structure.sectionOrder"));
  const twice = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  twice.structure.sectionOrder = [...PLATFORM_BASELINE.structure.sectionOrder, "diagnosis"];
  ok("23o. and one listing a section twice is refused, so nothing prints twice",
    validateTokens(twice).some(p => p.path === "structure.sectionOrder"));

  // ── and it actually changes the document ─────────────────────────────────────────────────────────
  const flipped = composeReferralLetter({
    ...baseInput([CURRENT_DX, CURRENT_RX]),
    structure: { sectionOrder: ["treatment", "diagnosis", "encounter", "procedure", "investigation", "medication", "follow_up"], hidden: [] },
  });
  ok("23p. section order reaches the composed document",
    flipped.body.indexOf("ZZ-CURRENT-RX") < flipped.body.indexOf("ZZ-CURRENT-DX"));
  ok("23q. CONTROL -- the default order puts them the other way round",
    composed.body.indexOf("ZZ-CURRENT-DX") < composed.body.indexOf("ZZ-CURRENT-RX"));

  const hiddenDoc = composeReferralLetter({
    ...baseInput([CURRENT_DX, CURRENT_RX]),
    structure: { sectionOrder: PLATFORM_BASELINE.structure.sectionOrder, hidden: ["treatment"] },
  });
  ok("23r. a hidden section leaves the document, and its facts leave the provenance with it",
    !hiddenDoc.body.includes("ZZ-CURRENT-RX") && !hiddenDoc.usedFactKeys.includes(CURRENT_RX.key));

  // ── 24. CUSTOMISING ONE DOCUMENT (s12) ───────────────────────────────────────────────────────────
  //
  // s12 lets a practitioner change presentation on the document in front of them, and bounds it twice
  // over: "Allow optional section visibility/order changes where clinically safe", and "Do not expose
  // raw theme internals in the routine document composer."
  //
  // ⚠ THE BOUND IS A PERMISSION BOUNDARY, NOT TIDINESS. Publishing a practice style takes
  // practice.settings.manage. Writing a document takes document.author. If a document author could
  // send a colour on a per-document request, the second capability would confer the first for the
  // length of one letter.

  ok("24a. a section order and visibility change is accepted",
    validateDocumentOverride({ structure: { sectionOrder: [...PLATFORM_BASELINE.structure.sectionOrder], hidden: ["encounter"] } }).length === 0);
  ok("24b. and no override at all is accepted, which is the normal case",
    validateDocumentOverride(null).length === 0 && validateDocumentOverride(undefined).length === 0);

  for (const [what, payload] of [
    ["a colour", { colour: { primary: "#FF0000" } }],
    ["a typeface", { typography: { bodyFont: "source_serif" } }],
    ["a section treatment", { layout: { sectionTreatment: "plain" } }],
  ] as [string, Record<string, unknown>][]) {
    const problems = validateDocumentOverride(payload);
    ok(`24c. one document cannot change ${what} -- that is a practice-wide setting`,
      problems.length > 0 && problems[0].path === "override");
  }

  // ⚠ REFUSED, NOT SILENTLY DROPPED. A dropped key looks to the practitioner like it worked.
  ok("24d. and a mixed payload is refused outright rather than partly applied",
    validateDocumentOverride({
      structure: { sectionOrder: [...PLATFORM_BASELINE.structure.sectionOrder], hidden: [] },
      colour: { primary: "#FF0000" },
    }).some(p => p.path === "override"));

  // The structural rules are the SAME ones a practice style obeys -- one definition, two callers.
  ok("24e. a per-document order must still be a permutation",
    validateDocumentOverride({ structure: { sectionOrder: ["diagnosis"], hidden: [] } })
      .some(p => p.path === "structure.sectionOrder"));
  ok("24f. and it still cannot hide a section carrying clinical facts",
    validateDocumentOverride({
      structure: { sectionOrder: [...PLATFORM_BASELINE.structure.sectionOrder], hidden: ["diagnosis"] },
    }).some(p => p.path === "structure.hidden"));

  // s2: this document is the highest level, so it beats the type override above it.
  const docBeatsType = JSON.parse(JSON.stringify(PLATFORM_BASELINE));
  docBeatsType.overrides = {
    type: { referral_letter: { structure: { sectionOrder: ["diagnosis", "encounter", "procedure", "investigation", "treatment", "medication", "follow_up"], hidden: [] } } },
  };
  const perDocOrder = resolveStyle({
    practicePublished: docBeatsType, docType: "referral_letter",
    documentOverride: { structure: { sectionOrder: ["treatment", "encounter", "diagnosis", "procedure", "investigation", "medication", "follow_up"], hidden: [] } },
  });
  ok("24g. a per-document order beats the type override",
    perDocOrder.tokens.structure.sectionOrder[0] === "treatment");

  // s12: "must not silently overwrite the Practice-wide configuration."
  const engineSrcForOverride = strip(read("src/lib/practice/document-automation.ts"));
  ok("24h. the override is written to the DOCUMENT, never to the practice style",
    /style_overrides: args\.documentOverride/.test(engineSrcForOverride)
    && !/practice_document_style[\s\S]{0,200}update/.test(engineSrcForOverride));
  // ⚠ THE NEEDLE MUST EXIST BEFORE ITS POSITION MEANS ANYTHING -- and this is the SECOND time that trap
  // was walked into in this file. 18g had it first: deleting the call outright makes indexOf return -1,
  // and -1 is less than every real index, so "validated first" passes with no validation present. The
  // fix is the same fix, and the lesson is that an ordering assertion is always also an existence one.
  const validateAt = engineSrcForOverride.indexOf("validateDocumentOverride(args.documentOverride)");
  ok("24i. and it is validated before anything is composed or stored",
    validateAt >= 0
    && validateAt < engineSrcForOverride.indexOf("const practice = await publishedStyleFor"),
    `validate at ${validateAt}`);

  // s12: "Do not expose raw theme internals in the routine document composer."
  const composerSrc = strip(read("src/app/practice/(shell)/encounters/[encounterId]/DocumentComposer.tsx"));
  ok("24j. the document composer offers no colour or typeface control",
    !/type="color"/.test(composerSrc) && !/bodyFont|headingSize|sectionTreatment/.test(composerSrc));
  ok("24k. it offers both of s12's choices by name",
    /Use practice style/.test(composerSrc) && /Customise this one/.test(composerSrc));
  ok("24l. and a locked layout is stated rather than offered as a disabled control",
    /layoutLocked/.test(composerSrc) && /keeps the layout its template prescribes/.test(composerSrc));

  // ── 25. A DOSE CARRIES ITS UNIT ──────────────────────────────────────────────────────────────────
  //
  // Found by reading a composed letter against the live record, not by any test above. dose_text is
  // inconsistent in the estate -- one row reads "1000 mg", the next reads "3" with dose_unit "mg"
  // beside it -- and the registry read only dose_text. A referral letter said "Bisoprolol (3 - Oral)".
  //
  // Three of what. The unit was in the record the whole time.
  ok("25a. a dose missing its unit gains the one the record holds",
    doseWithUnit("3", "mg") === "3 mg");
  ok("25b. and one that already carries it is left alone, not doubled",
    doseWithUnit("1000 mg", "mg") === "1000 mg" && doseWithUnit("500MG", "mg") === "500MG");
  ok("25c. no unit recorded means nothing is invented",
    doseWithUnit("3", null) === "3" && doseWithUnit(null, null) === null);

  // ── CONTROL ──────────────────────────────────────────────────────────────────────────────────────
  //
  // If the composer returned an empty string, most of section 1 and all of section 2 would pass by
  // producing nothing to find.
  ok("control. the fixture actually produced a letter",
    composed.body.length > 200 && composed.body.split("\n\n").length >= 7,
    `${composed.body.length} chars`);

  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
