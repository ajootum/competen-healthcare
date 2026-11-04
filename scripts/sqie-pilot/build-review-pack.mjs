// Builds docs/evidence/SQIE-PILOT/SQIE-PILOT-clinical-review-pack.md from sqie-pilot-batch-v1.json, so the pack shows
// exactly what the loader stores. Pure file transform: no network, no database.
//   node scripts/sqie-pilot/build-review-pack.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const b = JSON.parse(readFileSync(join(HERE, "sqie-pilot-batch-v1.json"), "utf8"));
const OUT = join(HERE, "..", "..", "docs", "evidence", "SQIE-PILOT", "SQIE-PILOT-clinical-review-pack.md");

const AREAS = [["respiratory", "Respiratory assessment", "R"], ["cardiovascular", "Cardiovascular assessment", "C"], ["abcde", "ABCDE and deterioration", "A"], ["reasoning", "Clinical reasoning and prioritisation", "P"], ["medication", "Medication safety", "M"]];
const TYPE_LABEL = { single_best: "Single best answer", multiple_response: "Multiple response", short: "Short answer", structured: "Structured", case: "Case (multi-part)", sequence: "Prioritisation / sequence", calculation: "Calculation", calculation_structured: "Calculation (structured)", extended: "Extended (justification)" };
const cell = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const letter = i => String.fromCharCode(65 + i);

function question(q) {
  const f = q.fields;
  switch (f.format) {
    case "mcq": return [f.stem, ...f.options.map((o, i) => `${i === f.correctIndex ? "★ " : ""}${letter(i)}. ${o}`)].join("<br>");
    case "mrq": return [f.stem, ...f.options.map((o, i) => `${f.correct.includes(i) ? "★ " : ""}${letter(i)}. ${o}`)].join("<br>");
    case "sequence": return `${f.stem}<br>Learners see the steps shuffled. Keyed order:<br>${f.steps.map((s, i) => `${i + 1}. ${s}`).join("<br>")}`;
    case "structured": return [f.stem, ...f.parts.map(p => `${p.prompt} [${p.marks} mark${p.marks > 1 ? "s" : ""}]`)].join("<br>");
    default: return f.stem;
  }
}
function key(q) {
  const f = q.fields;
  switch (f.format) {
    case "mcq": return `${letter(f.correctIndex)}`;
    case "mrq": return f.correct.map(letter).join(", ");
    case "sequence": return "As listed (1 to " + f.steps.length + ")";
    case "short": return `Accepted: ${f.accepted.join("; ")}`;
    case "structured": return f.parts.map(p => `${p.prompt.match(/^\(\w\)/)?.[0] ?? ""} ${p.accepted.join("; ")}`).join("<br>");
    case "extended": return `Model answer: ${f.modelAnswer}<br>Key points: ${f.keyPoints.join(" · ")}`;
    default: return "";
  }
}
const calc = q => q.calculation ? `<br>Calculation: ${q.calculation.formula} with ${Object.entries(q.calculation.inputs).map(([k, v]) => `${k} = ${v}`).join(", ")} → **${q.calculation.value} ${q.calculation.unit}**; rounding: ${q.calculation.rounding}; tolerance 0; unit required.` : "";

const counts = {};
for (const q of b.questions) counts[q.type] = (counts[q.type] ?? 0) + 1;

let md = `# SQIE pilot Question Library batch: independent clinical review pack

**Batch:** \`${b.batch}\` · **Decision:** SQIE-CLOSE-2026-11 owner decisions of 4 Nov 2026, items 2 and 3 · **Data file:** \`scripts/sqie-pilot/sqie-pilot-batch-v1.json\` · **Loader:** \`scripts/sqie-pilot/load-sqie-pilot-batch.ts\` · **Prepared:** 4 Nov 2026 (this pack is generated from the data file by \`scripts/sqie-pilot/build-review-pack.mjs\`; regenerate it after any edit)

## 1. What you are being asked to do

Owner decision item 2 allows AI-assisted drafting of a first pilot Question Library of 60 nursing questions, but every question needs **source verification, independent clinical review and authorised publication**, and the batch is **never published automatically**. This pack is the independent clinical review. For each question, mark exactly one of **Safe / Unsafe / Inaccurate / Unclear**, write a comment where the mark is not Safe, and complete the **Source verified** column (the key is supported by the cited source: Yes / No / Not checked). Sign off in section 8.

| Mark | Meaning for this review |
|---|---|
| **Safe** | Clinically correct, appropriate for a pre-registration diploma nursing learner, the key is the single defensible answer, and nothing a learner could act on unsafely. |
| **Unsafe** | A learner relying on this question, its key or its explanation could be led to unsafe practice (wrong value, dose, threshold, sequence or omission that matters clinically). |
| **Inaccurate** | Wrong, misleading, out of date or not supported by the cited source, but not in itself likely to cause harm. |
| **Unclear** | Ambiguous, more than one defensible answer, poorly worded, or cannot be judged without local policy (say what you need). |

## 2. Where the questions come from (provenance)

- **AI-assisted.** Every stem, key, rubric and explanation was drafted with AI assistance (model \`${b.provenance.model}\`, prompt version \`${b.provenance.prompt_version}\`, ${b.provenance.drafted_in}). Each stored version carries \`origin = ai_draft\` and this provenance in \`ai_provenance\` (migration 442), so the catalogue shows it as AI-drafted. Nobody has edited them clinically.
- **Wording is original.** No passage is copied from a source. Facts, thresholds and doses are drawn from the guidelines and textbooks cited per question (section 7), declared as \`own_writing\` for rights.
- **Source not verified: all 60.** No guideline or textbook is held in a Competen source registry (on staging, \`ais_knowledge_sources\` and \`ais_context_sources\` are empty, and the research registry holds providers, not documents), and nobody has checked any key against the cited text. Each version stores \`source_verification.status = not_verified\`. Please verify the key of each question against the cited source and record the result in the **Source verified** column. Citations are to named public documents; where the edition or update year is uncertain the citation says so.
- **Programme and level.** \`${b.programme.code}\` (${b.programme.label}), pre-registration diploma. The cited sources are mainly UK and international guidance. Please flag any question whose key differs from Ugandan practice or the Uganda Clinical Guidelines, and any drug, strength or device not used locally.
- **Draft competency mapping.** Each question maps to one competency and one learning objective (an exact skill statement) of **${b.framework.code}** ${b.framework.name}, version 1.0.0, stored with the framework version, its publication status at mapping time and the identifiers. It is marked **draft, not validated** and is never competency evidence (owner decision item 3). See section 6 for the mapping caveats.

## 3. What the loader stores, and what learners see

- Each question is one CKRI knowledge resource of kind \`revision_question\` with one **draft** version, written through the HQ authoring path (\`questionContentFromFields\`, \`checkedContent\`, \`validateLibraryQuestion\`) and the 442 database guards. Nothing is reviewed, submitted, approved or published by the loader.
- Learners never see a draft: Scholar reads only published, clinically approved versions (\`loadLibraryQuestions\`, \`servableLibraryVersions\`), and the 800 database guard refuses a learner copy of anything else.
- When a version is eventually published, learners see the stem, the options (sequence steps shuffled), and after answering the explanation and the key. The metadata in this pack (programme, difficulty, references, mapping, calculation block) is stored in the version and hashed, so you approve it too, but it is not shown to learners.
- **Marking.** \`deterministic\` = code marks a match with an accepted answer; where code cannot tell (other wording), the learner judges against the key, never AI. \`self\` = the learner marks against the key. Answers are compared after lower-casing and removing punctuation, so "0.5 mL" and "0,5 ml" match, and a sign such as "+250" is lost (signs are therefore written in words). **Calculations:** exact matching, unit required, a stated rounding rule, tolerance 0 (owner decision item 1). Each calculation key was recomputed from its inputs by the loader's check (second dose check).

## 4. Counts

| Area | Questions |
|---|---|
${AREAS.map(([a, label]) => `| ${label} | ${b.questions.filter(q => q.area === a).length} |`).join("\n")}
| **Total** | **${b.questions.length}** |

| Question type | Count |
|---|---|
${Object.entries(TYPE_LABEL).filter(([t]) => counts[t]).map(([t, l]) => `| ${l} | ${counts[t]} |`).join("\n")}

## 5. Questions by area

Tick one mark per question (replace \`☐\` with \`☒\`). ★ marks the keyed option(s).
`;

for (const [area, label, prefix] of AREAS) {
  const qs = b.questions.filter(q => q.area === area);
  md += `\n### 5.${AREAS.findIndex(x => x[0] === area) + 1} ${label}\n\n| Item | Type · difficulty | Question | Key | Explanation shown to learners | Sources (section 7) | Draft mapping (${b.framework.code}) | Source verified | Safe | Unsafe | Inaccurate | Unclear | Comment |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  qs.forEach((q, i) => {
    md += `| ${prefix}-${String(i + 1).padStart(2, "0")}<br>\`${q.code}\` | ${TYPE_LABEL[q.type]} · ${q.difficulty} | ${cell(question(q))} | ${cell(key(q))}${cell(calc(q))} | ${cell(q.fields.rationale)} | ${cell(q.references.map(r => `${r.id}: ${r.supports}`).join("<br>"))} | ${cell(`${q.competency.code}: ${q.competency.objective}`)} | ☐ Yes ☐ No | ☐ | ☐ | ☐ | ☐ | |\n`;
  });
  md += `\nMisconceptions the distractors and rubric target: ${qs.map((q, i) => `${prefix}-${String(i + 1).padStart(2, "0")} ${q.misconception_tags.join(", ")}`).join(" · ")}\n`;
}

md += `
## 6. Points the drafting session asks the reviewer to judge

1. **Mapping fit.** ${b.framework.code} is a critical-care framework with mostly paediatric wording ("infant/child/adolescent"), and it has **no medicines administration or medicines calculation competency**. The medication-safety items are mapped to the closest statements (NUR-CCF-030 Quality and Safety, NUR-CCF-024 Safety Checks, NUR-CCF-012 Fluid Management, NUR-CCF-011, NUR-CCF-015, NUR-CCF-019), and the ABCDE items to respiratory, haemodynamic, neurological and communication statements. Please say whether each mapping is acceptable or name a better one. On staging, ${b.framework.code} 1.0.0 is unpublished (version_num 0); the Scholar programme \`${b.programme.code}\` is linked on staging to CF-FOUND and NUR-RESP, not ${b.framework.code}.
2. **Local applicability (Uganda).** NEWS2, the Sepsis Six and the RCUK algorithms are UK tools. Confirm they are what pilot learners are taught, or mark Unclear.
3. **Thresholds and doses to check carefully:** NEWS2 parameter scores and response bands (R-02, R-10, A-05, A-06, A-07, P-08, P-09, P-12), oxygen targets (R-07, P-05, P-11), adrenaline 500 micrograms IM (M-06, M-11), IV paracetamol 15 mg/kg for adults of 50 kg or less (M-09), urine output 0.5 mL/kg/hour (C-08, P-06), orthostatic hypotension thresholds (C-05), the ACS ECG and oxygen advice (C-10).
4. **Sequence items** (R-11, C-11, A-01, A-08, A-12, P-01, P-07, M-10): is the keyed order the only defensible order? If local practice differs (for example where the identity check sits in M-10), mark Unclear.
5. **Free-text keys** in case and structured items list example accepted answers; the learner marks themselves where their wording differs. Say if a key is too narrow or could accept an unsafe answer.

## 7. Sources cited

| Id | Kind | Citation |
|---|---|---|
${Object.entries(b.references).map(([id, r]) => `| ${id} | ${r.kind} | ${cell(r.citation)} |`).join("\n")}

## 8. Sign-off

Counts to complete: Safe ____ · Unsafe ____ · Inaccurate ____ · Unclear ____ · Source verified Yes ____ / No ____.

Per area: ☐ Respiratory ☐ Cardiovascular ☐ ABCDE and deterioration ☐ Clinical reasoning and prioritisation ☐ Medication safety (tick each area you reviewed in full).

Outcome (tick one): ☐ Approve the Safe, source-verified items for submission to clinical approval and publication · ☐ Approve with the conditions written above · ☐ Do not approve (reason above)

| Reviewer name | Role / registration | Date | Signature |
|---|---|---|---|
| | | | |
| | | | |

The reviewer must be independent of the people who drafted and loaded the batch. This pack is not the in-system approval: after review, an author edits any item marked other than Safe (an edit clears educator review), educator review and submission happen in HQ, the independent clinical approval is recorded in the system (395, 640), and only a holder of \`hq.quality.knowledge.publish\` who did not author the question may publish it (640 guard: an author never publishes their own work). Items marked Unsafe or Inaccurate are not submitted until corrected and re-reviewed.
`;

writeFileSync(OUT, md);
console.log(`wrote ${OUT} (${b.questions.length} questions)`);
