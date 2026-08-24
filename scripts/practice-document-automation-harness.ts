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
import fs from "node:fs";
import path from "node:path";
import {
  composeReferralLetter, composeVisitSummary, composePatientInstructions, composeClinicalSummary,
  composeInvestigationRequest, composeFollowUpInstructions, composeMedicationList, recipientLine,
  type Recipient,
} from "../src/lib/practice/document-compose";
import { DOC_TYPES } from "../src/lib/practice/document-constants";
import { DOC_TYPE_OPTIONS } from "../src/lib/practice/documents-workspace-constants";
import {
  resolveSelection, defaultSelection, selectableFacts, CURRENT_STATE_CATEGORIES,
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
  ok("6a. the composer imports nothing but its own fact types",
    imports.length === 1 && imports[0] === "@/lib/practice/document-facts",
    `imports: ${imports.join(", ")}`);
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
  const written = [...engineSrc.matchAll(/docType: "(\w+)"/g)].map(m => m[1]);
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
