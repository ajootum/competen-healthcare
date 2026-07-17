// CPU document parser — turns an authored Clinical Practice Unit document
// (the "CPU Transition Document" format) into structured platform objects.
//
// Mapping decided from the source documents:
//   "N.1 Introduction"                    → CPU description
//   "N.3 Scope of Clinical Practice"      → CPU scope
//   "N.30 Competency Assessment Rubric"   → competencies (author's own domains)
//   "Clinical Skills Outcomes" bullets    → skills
//   "Knowledge Outcomes" bullets          → knowledge requirements
//   "N.NN Red Flags…"                     → critical-failure rules
//   "Self-Assessment Questions" MCQs      → question bank
//   "Practical Skills Checklist (OSCE)"   → checklist items
//
// Pure functions, no I/O — unit-tested. Deliberately tolerant: documents vary,
// so anything uncertain is surfaced in `warnings` for a human to resolve at the
// review step rather than silently guessed.
//
// List detection: Word list paragraphs survive .docx→text conversion with a
// trailing space, while headings and prose do not. That is the primary signal;
// a shape heuristic is the fallback for plain-text input.

export type ParsedQuestion = {
  stem: string;
  options: string[];
  correctIndex: number | null;
  rationale: string | null;
};

export type KnowledgeType =
  | "anatomy" | "physiology" | "pathophysiology" | "pharmacology" | "classification"
  | "assessment_tool" | "clinical_reasoning" | "procedure" | "evidence" | "other";

export type ParsedKnowledge = {
  section: string;        // "10.4"
  title: string;          // "Functional Anatomy of Human Gait"
  type: KnowledgeType;
  content: string;        // the authored prose
  words: number;
};

export type ParsedCase = {
  title: string;
  scenario: string;
  findings: string;
  questions: string[];
  discussion: string;
  learningPoints: string[];
};

export type ParsedCpu = {
  code: string | null;
  title: string | null;
  introduction: string | null;
  scope: string | null;
  competencies: string[];
  skills: string[];
  knowledge: string[];
  knowledgeObjects: ParsedKnowledge[];
  cases: ParsedCase[];
  redFlags: string[];
  questions: ParsedQuestion[];
  checklistItems: string[];
  warnings: string[];
};

// Section titles that are structural (handled elsewhere) rather than knowledge.
const STRUCTURAL = /^(Introduction|Learning Outcomes|Scope of Clinical Practice|Red Flags|Self-?Assessment|Practical Skills Checklist|OSCE|Competency Assessment Rubric|Documentation|Summary|Key Points|Clinical Case Stud|Conclusion|References)/i;

/** Infer a knowledge type from the section title. */
export function knowledgeTypeFor(title: string): KnowledgeType {
  const t = title.toLowerCase();
  if (/pathophysiolog/.test(t)) return "pathophysiology";
  if (/anatomy|neuroanatom/.test(t)) return "anatomy";
  if (/physiolog/.test(t)) return "physiology";
  if (/pharmacolog|drug|medication/.test(t)) return "pharmacology";
  if (/classification|types of|syndromes/.test(t)) return "classification";
  if (/scale|score|tool|test\b|index/.test(t)) return "assessment_tool";
  if (/reasoning|interpretation|localisation|localization|differential/.test(t)) return "clinical_reasoning";
  if (/technique|procedure|examination|assessment of|performing/.test(t)) return "procedure";
  if (/evidence|guideline|research/.test(t)) return "evidence";
  return "other";
}

type Section = { num: string; title: string; body: string[] };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** Normalise a list item: drop any leading bullet/number marker and trailing punctuation. */
const tidy = (s: string) => clean(s).replace(/^[•·\-–]\s*/, "").replace(/^\d{1,2}[.)]\s+/, "").replace(/[.;]$/, "");

/** A Word list paragraph (trailing space) or an explicit bullet/number. */
export const isListItem = (raw: string) => /\S[ \t]+$/.test(raw) || /^\s*[•·\-–]\s+\S/.test(raw);

/** Split the document into numbered sections ("10.4 Functional Anatomy…"). */
export function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r/g, "");
    const m = /^(\d{1,2}\.\d{1,2})\s+(.{3,120})$/.exec(line.trim());
    if (m) {
      if (current) sections.push(current);
      current = { num: m[1], title: clean(m[2]), body: [] };
    } else if (current && line.trim()) {
      current.body.push(line); // keep trailing whitespace — it marks list items
    }
  }
  if (current) sections.push(current);
  return sections;
}

const findSection = (s: Section[], re: RegExp) => s.find(x => re.test(x.title)) ?? null;

/**
 * Collect the first contiguous run of list items at or after `from`.
 * Prose/lead-in lines before the list are skipped; the run ends at the first
 * non-list line (a heading, a new paragraph, the next sub-section).
 */
function collectList(body: string[], from: number, maxLen = 220): string[] {
  const out: string[] = [];
  for (let i = from; i < body.length; i++) {
    const raw = body[i];
    if (isListItem(raw)) {
      const t = tidy(raw);
      if (t && t.length <= maxLen) out.push(t);
      continue;
    }
    if (out.length) break;          // the list has ended
    if (i - from > 12) break;       // no list nearby — give up
  }
  return out;
}

/** Fallback for plain text with no Word list markers: short, sentence-like lines. */
function collectListHeuristic(body: string[], from: number, maxLen = 220): string[] {
  const out: string[] = [];
  for (let i = from; i < body.length; i++) {
    const line = body[i].trim();
    if (!line || /:$/.test(line)) { if (out.length) break; continue; }
    if (line.length > maxLen) { if (out.length) break; continue; }
    out.push(tidy(line));
    if (out.length > 40) break;
  }
  return out;
}

/** Items under a named sub-heading inside a section. */
function itemsUnder(body: string[], headingRe: RegExp, maxLen = 220): string[] {
  const at = body.findIndex(l => headingRe.test(l.trim()));
  if (at === -1) return [];
  const viaMarkers = collectList(body, at + 1, maxLen);
  return viaMarkers.length ? viaMarkers : collectListHeuristic(body, at + 1, maxLen);
}

/** Items following a lead-in line such as "…should be able to:". */
function itemsAfter(body: string[], triggerRe: RegExp, maxLen = 220): string[] {
  const at = body.findIndex(l => triggerRe.test(l.trim()));
  if (at === -1) return [];
  const viaMarkers = collectList(body, at + 1, maxLen);
  return viaMarkers.length ? viaMarkers : collectListHeuristic(body, at + 1, maxLen);
}

// Outcome verbs denoting knowledge rather than a performed skill — used when a
// document lists outcomes flat instead of under Knowledge/Skills headings.
const KNOWLEDGE_VERBS = /^(Explain|Describe|Discuss|Define|State|Outline|List|Understand|Differentiate|Compare)\b/i;

/**
 * Numbered thematic group headings inside a Learning Outcomes section, e.g.
 *   "1. Explain the Functional Anatomy of the Neuromuscular Junction"
 * These are headings (not list items) and read as competency names.
 */
export function numberedGroupHeadings(body: string[]): string[] {
  const out: string[] = [];
  for (const raw of body) {
    if (isListItem(raw)) continue;
    const m = /^\s*(\d{1,2})[.)]\s+([A-Z].{5,110})$/.exec(raw.trim());
    if (m && !/[.;]$/.test(m[2])) out.push(clean(m[2]));
  }
  return out;
}

/** Every list item in a section, regardless of sub-heading. */
function allItems(body: string[], maxLen = 220): string[] {
  return body.filter(isListItem).map(tidy).filter(t => t && t.length <= maxLen);
}

/** Split a flat outcome list into knowledge vs skills by its leading verb. */
export function classifyOutcomes(outcomes: string[]): { knowledge: string[]; skills: string[] } {
  const knowledge: string[] = [];
  const skills: string[] = [];
  for (const o of outcomes) (KNOWLEDGE_VERBS.test(o) ? knowledge : skills).push(o);
  return { knowledge, skills };
}

/**
 * Substantive prose sections become Clinical Knowledge Objects: the anatomy,
 * physiology, classification and reasoning content that carries most of an
 * authored CPU's value. Structural sections are excluded (handled elsewhere),
 * as are thin sections with too little prose to be worth governing.
 */
export function extractKnowledgeObjects(sections: Section[], minWords = 120): ParsedKnowledge[] {
  const out: ParsedKnowledge[] = [];
  for (const s of sections) {
    if (STRUCTURAL.test(s.title)) continue;
    // Prose only — list items belong to other structures
    const prose = s.body.filter(l => !isListItem(l)).map(l => l.trim()).filter(Boolean);
    const content = prose.join("\n\n").trim();
    const words = content ? content.split(/\s+/).length : 0;
    if (words < minWords) continue;
    out.push({
      section: s.num,
      title: s.title,
      type: knowledgeTypeFor(s.title),
      content,
      words,
    });
  }
  return out;
}

// Sub-headings inside a case study, in document order.
const CASE_PARTS = ["Clinical Scenario", "Assessment Findings", "Questions", "Discussion", "Learning Points"];

/**
 * Worked clinical case studies:
 *   Case Study 1 – Acute Hemiplegic Gait
 *     Clinical Scenario / Assessment Findings / Questions / Discussion / Learning Points
 * Prose parts keep their text; Questions and Learning Points are lists.
 */
export function extractCases(sections: Section[]): ParsedCase[] {
  const sec = sections.find(s => /Clinical Case Stud/i.test(s.title));
  if (!sec) return [];

  // Split the section body at each "Case Study N – Title" heading
  const heads: number[] = [];
  sec.body.forEach((l, i) => { if (/^Case (Study )?\d+\s*[–—:-]/.test(l.trim())) heads.push(i); });
  if (!heads.length) return [];

  const cases: ParsedCase[] = [];
  for (let k = 0; k < heads.length; k++) {
    const block = sec.body.slice(heads[k], k + 1 < heads.length ? heads[k + 1] : sec.body.length);
    const titleM = /^Case (?:Study )?\d+\s*[–—:-]\s*(.+)$/.exec(block[0].trim());
    const title = titleM ? clean(titleM[1]) : `Case ${k + 1}`;

    // Index of each part heading within the block
    const partAt = new Map<string, number>();
    block.forEach((l, i) => {
      const t = l.trim();
      for (const p of CASE_PARTS) if (t.toLowerCase() === p.toLowerCase()) partAt.set(p, i);
    });

    const sliceFor = (part: string): string[] => {
      const start = partAt.get(part);
      if (start === undefined) return [];
      const laterStarts = CASE_PARTS
        .map(p => partAt.get(p))
        .filter((i): i is number => i !== undefined && i > start);
      const end = laterStarts.length ? Math.min(...laterStarts) : block.length;
      return block.slice(start + 1, end);
    };

    const proseOf = (part: string) =>
      sliceFor(part).map(l => (isListItem(l) ? `• ${tidy(l)}` : l.trim())).filter(Boolean).join("\n");

    // Questions and Learning Points are already isolated by their part
    // boundaries, so every line is an item. These authors mix real Word lists
    // with plain paragraphs, so don't require a list marker — prefer marked
    // items when present, otherwise take each line.
    // The final case in a section has no following heading to stop at, so its
    // last part can absorb the section's closing prose — hence the cap.
    const listOf = (part: string, max = 15) => {
      const slice = sliceFor(part);
      const marked = slice.filter(isListItem);
      const source = marked.length ? marked : slice;
      return source.map(tidy).filter(t => t.length > 2 && t.length <= 300).slice(0, max);
    };

    const scenario = proseOf("Clinical Scenario");
    const findings = proseOf("Assessment Findings");
    // Only keep cases that actually have content
    if (!scenario && !findings) continue;

    cases.push({
      title,
      scenario,
      findings,
      questions: listOf("Questions"),
      discussion: proseOf("Discussion"),
      learningPoints: listOf("Learning Points"),
    });
  }
  return cases;
}

/** Parse the self-assessment MCQ block. Tolerates "Answer: B" and "✅ C" forms. */
export function parseQuestions(body: string[]): { questions: ParsedQuestion[]; warnings: string[] } {
  const questions: ParsedQuestion[] = [];
  const warnings: string[] = [];
  const idx: number[] = [];
  let nonMcq = 0;
  body.forEach((l, i) => { if (/^Question\s+\d+\b/i.test(l.trim())) idx.push(i); });

  for (let k = 0; k < idx.length; k++) {
    const end = k + 1 < idx.length ? idx[k + 1] : Math.min(idx[k] + 40, body.length);
    const chunk = body.slice(idx[k], end).map(l => l.trim());
    const options: { letter: string; text: string }[] = [];
    let stem = "";
    let correctLetter: string | null = null;
    let rationale: string | null = null;
    let inRationale = false;

    for (let i = 1; i < chunk.length; i++) {
      const line = chunk[i];
      if (!line) continue;
      const opt = /^([A-E])[.)]\s+(.{2,})$/.exec(line);
      if (opt) { options.push({ letter: opt[1], text: clean(opt[2]) }); inRationale = false; continue; }
      const inline = /^Answer[:\s]+\s*✅?\s*([A-E])\b/i.exec(line);   // "Answer: B"
      const tick = /^✅\s*([A-E])\b/.exec(line);                       // "✅ C"
      if (inline) { correctLetter = inline[1]; continue; }
      if (tick) { correctLetter = tick[1]; continue; }
      if (/^Answer$/i.test(line)) continue;                            // bare "Answer" header
      const rat = /^Rationale[:\s]*(.*)$/i.exec(line);
      if (rat) { rationale = clean(rat[1]) || null; inRationale = true; continue; }
      if (inRationale) {
        if ((rationale ?? "").length < 400) rationale = clean(`${rationale ?? ""} ${line}`);
        continue;
      }
      if (!options.length) stem = stem ? `${stem} ${line}` : line;
    }

    stem = clean(stem);
    // Short-answer / case items have no lettered options — expected, not an error.
    if (options.length === 0) { nonMcq++; continue; }
    if (options.length === 1) { warnings.push(`Question ${k + 1}: only one option read — skipped as malformed.`); continue; }
    if (!stem) { warnings.push(`Question ${k + 1}: no stem found — skipped.`); continue; }

    const correctIndex = correctLetter ? options.findIndex(o => o.letter === correctLetter) : -1;
    if (correctIndex < 0) {
      warnings.push(`Question ${k + 1} ("${stem.slice(0, 45)}…"): no answer key found — set the answer manually.`);
    }
    questions.push({
      stem,
      options: options.map(o => o.text),
      correctIndex: correctIndex >= 0 ? correctIndex : null,
      rationale: rationale || null,
    });
  }
  if (nonMcq > 0) {
    warnings.push(`${nonMcq} short-answer/case item${nonMcq !== 1 ? "s" : ""} skipped — only multiple-choice questions are imported.`);
  }
  return { questions, warnings };
}

/**
 * Authored documents are often BUNDLES containing several CPUs back to back
 * (e.g. CPU-DIS-010 … 013 in one file). Split on genuine CPU headers.
 *
 * A genuine header is a non-list line "CPU-XXX-NNN: Title" whose block contains
 * numbered sections. Cross-references to other CPUs appear as list items or
 * without sections, and are excluded.
 */
export function splitCpuBundle(text: string): { code: string; title: string; text: string }[] {
  const lines = text.split(/\r?\n/);
  const heads: { i: number; code: string; title: string }[] = [];
  lines.forEach((raw, i) => {
    if (isListItem(raw)) return; // cross-reference bullet, not a header
    const m = /^(CPU-[A-Z]{2,4}-\d{1,3})\s*[:–-]\s*(.+)$/.exec(raw.trim());
    if (!m) return;
    const title = clean(m[2]).replace(/\s*(Top|Bottom) of Form\.?$/i, "").replace(/\s*—\s*Complete\.?$/i, "");
    if (!title || /^Complete\b/i.test(title)) return;
    heads.push({ i, code: m[1], title });
  });
  if (!heads.length) return [];

  const blocks = heads.map((h, k) => ({
    code: h.code,
    title: h.title,
    text: lines.slice(h.i, k + 1 < heads.length ? heads[k + 1].i : lines.length).join("\n"),
  })).filter(b => /^\d{1,2}\.\d{1,2}\s+\S/m.test(b.text)); // must contain numbered sections

  // Repeated headers (running titles) produce duplicates — keep the longest block per code.
  const best = new Map<string, { code: string; title: string; text: string }>();
  for (const b of blocks) {
    const prev = best.get(b.code);
    if (!prev || b.text.length > prev.text.length) best.set(b.code, b);
  }
  return [...best.values()];
}

/** Parse every CPU contained in a document. */
export function parseCpuBundle(text: string): ParsedCpu[] {
  const blocks = splitCpuBundle(text);
  if (blocks.length <= 1) return [parseCpuDocument(text)];
  return blocks.map(b => parseCpuDocument(b.text));
}

export function parseCpuDocument(text: string): ParsedCpu {
  const warnings: string[] = [];
  const sections = splitSections(text);

  // Header: "CPU-DIS-010: Gait, Balance and Mobility Assessment"
  const headerLine = text.split(/\r?\n/).slice(0, 40).map(l => l.trim())
    .find(l => /^CPU-[A-Z]{2,4}-\d{1,3}\s*[:–-]/.test(l)) ?? "";
  const hm = /^(CPU-[A-Z]{2,4}-\d{1,3})\s*[:–-]\s*(.+)$/.exec(headerLine);
  const code = hm ? hm[1] : null;
  const title = hm ? clean(hm[2]) : null;
  if (!code) warnings.push("No CPU code found (expected e.g. “CPU-DIS-010: Title”) — set it manually.");

  const introSec = findSection(sections, /^Introduction$/i);
  const scopeSec = findSection(sections, /Scope of Clinical Practice/i);
  const outcomesSec = findSection(sections, /Learning Outcomes/i);
  const redFlagSec = findSection(sections, /Red Flags/i);
  const questionSec = findSection(sections, /Self-?Assessment/i);
  const osceSec = findSection(sections, /Practical Skills Checklist|OSCE/i);
  const rubricSec = findSection(sections, /Competency Assessment Rubric/i);

  const introduction = introSec ? clean(introSec.body.slice(0, 3).join(" ")).slice(0, 1200) : null;
  const scope = scopeSec ? clean(scopeSec.body.slice(0, 2).join(" ")).slice(0, 800) : null;
  if (!introSec) warnings.push("No “Introduction” section — CPU description will be empty.");

  // Competencies. Preference order:
  //  1. the rubric's own "Competency Domains" list (the author's breakdown)
  //  2. numbered thematic outcome groups ("1. Explain the Functional Anatomy…")
  //  3. named outcome groups ("Knowledge Outcomes", "Clinical Skills Outcomes"…)
  let competencies = rubricSec ? itemsUnder(rubricSec.body, /^Competency Domains/i, 120) : [];
  if (!competencies.length && outcomesSec) {
    competencies = numberedGroupHeadings(outcomesSec.body);
    if (competencies.length) warnings.push(`Competencies taken from ${competencies.length} numbered outcome groups (no rubric “Competency Domains” list). Review the names.`);
  }
  if (!competencies.length && outcomesSec) {
    competencies = outcomesSec.body
      .map(l => l.trim())
      .filter(l => /^(Knowledge|Clinical Skills|Clinical Reasoning|Professional Practice|Safety)\s+Outcomes?$/i.test(l))
      .map(l => clean(l).replace(/\s+Outcomes?$/i, ""));
  }
  if (!competencies.length) warnings.push("No competencies could be extracted — add them manually after import.");

  // Skills & knowledge. Preferred: explicit sub-headings. Fallback: flat list split by verb.
  let skills = outcomesSec ? itemsUnder(outcomesSec.body, /^Clinical Skills Outcomes?$/i) : [];
  let knowledge = outcomesSec ? itemsUnder(outcomesSec.body, /^Knowledge Outcomes?$/i) : [];
  if (outcomesSec && !skills.length && !knowledge.length) {
    // Flat list, or numbered thematic groups: take every list item and split by verb.
    const flat = itemsAfter(outcomesSec.body, /should be able to:?$/i);
    const items = flat.length ? flat : allItems(outcomesSec.body);
    if (items.length) {
      const c = classifyOutcomes(items);
      knowledge = c.knowledge; skills = c.skills;
      warnings.push(`Outcomes had no Knowledge/Skills headings — ${items.length} outcomes split by verb into ${knowledge.length} knowledge / ${skills.length} skills. Review the split.`);
    }
  }
  if (!skills.length) warnings.push("No clinical-skill outcomes found — no skills extracted.");

  // Red flags → critical failure rules
  const redFlags = redFlagSec ? itemsAfter(redFlagSec.body, /:$/, 160).slice(0, 25) : [];
  if (!redFlagSec) warnings.push("No “Red Flags” section — no critical-failure rules extracted.");
  else if (!redFlags.length) warnings.push("“Red Flags” section found but no list items read.");

  // MCQs
  const { questions, warnings: qWarn } = questionSec ? parseQuestions(questionSec.body) : { questions: [], warnings: [] };
  if (!questionSec) warnings.push("No “Self-Assessment Questions” section — no question bank will be created.");
  warnings.push(...qWarn);

  // OSCE checklist
  const checklistItems = osceSec ? itemsUnder(osceSec.body, /^Learning Outcomes Assessed/i, 160) : [];
  if (!osceSec) warnings.push("No OSCE / practical checklist section found.");

  // Clinical Knowledge Objects — the authored prose sections
  const knowledgeObjects = extractKnowledgeObjects(sections);
  if (!knowledgeObjects.length) warnings.push("No substantial knowledge sections found — no knowledge objects will be created.");

  // Worked clinical case studies
  const cases = extractCases(sections);

  return {
    code, title, introduction, scope, competencies, skills, knowledge,
    knowledgeObjects, cases, redFlags, questions, checklistItems, warnings,
  };
}
