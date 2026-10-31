// ── GOVERNED LIBRARY QUESTIONS IN EVERY REVISION FORMAT ── SQIE-LIBRARY-EXPANSION-01 (owner GO 31 Oct 2026, item F) ─────────
//
// A governed library question (CKRI knowledge resource of kind revision_question, migration 442) used to be ONE shape: a
// stem, four options, correct_index and a rationale. Migration 800 lets its content name a FORMAT, and carry the key of
// that format, a rubric and a marking rule. This module is the ONE reader of that content, used by both sides, exactly as
// validateStationContent (osce.ts) is for OSCE stations:
//
//   HQ (src/lib/knowledge/educator.ts)   validateLibraryQuestion at draft save, at submission and at publication.
//   Scholar (library-questions.ts)        validateLibraryQuestion before a version is offered, and libraryCopyOf for the
//                                         learner's own copy (store.ts insertLibraryCopies).
//   The database (800)                    ckri_knowledge_content_ok checks the shape again, and the 710 guard (replaced by
//                                         800) refuses a learner copy that is not libraryCopyOf of the published,
//                                         clinically approved content, exactly.
//
// THE CONTENT. Legacy (no `format` key): stem, options[4], correct_index, rationale -- read exactly as before, an mcq.
// With `format`: { format, stem, options, correct_index (mcq only), answerKey, rubric?, marking, rationale, source? }.
// answerKey is EXACTLY the learner `answer` of that format (migrations 416/710) without its rubric, so the learner copy
// is `answerKey + { rubric } + { marking }` and nothing has to be translated:
//
//   mcq         options 4, correct_index 0-3, no answerKey                       (copy: kind mcq, answer {rubric} or null)
//   mrq         options 4-6, answerKey.correct 1..n-1 distinct indexes            (kind mrq)
//   short       options [], answerKey.accepted 1-8 answers                        (kind short)
//   cloze       options [], answerKey { format cloze, accepted 1-8 }, the stem holds the blank _____   (kind short)
//   true_false  options [], answerKey { format true_false, accepted [true|false], statement, explanation },
//               the stem is the statement                                          (kind short)
//   extended    options [], answerKey { format extended, accepted [modelAnswer], modelAnswer, marks },
//               rubric.keyPoints 3-8 (what it is marked against)                   (kind short)
//   flashcard   options [], answerKey.back                                         (kind flashcard)
//   match       options 3-6 prompts, answerKey.matches one per prompt             (kind match)
//   sequence    options 3-6 steps (stored shuffled), answerKey.order the steps' order, a permutation  (kind sequence)
//   structured  options [], answerKey.parts 2-4 of { prompt, marks 1-5, accepted 1-4, rubric? }    (kind structured)
//
// THE MARKING RULE. deterministic (code marks it, and where code cannot tell -- a short answer in other words, a structured
// part -- the learner's own judgement, never AI), self (the learner's own judgement against the key), rubric_ai_formative
// (extended only: the existing formative evaluator against the key points, labelled formative, then the learner's own
// judgement). AI marking is offered for a library copy ONLY where the version says rubric_ai_formative.
//
// Pure: no I/O, no clock, no model. Nothing here is an assessment, a grade or competence.

import { COGNITIVE_LEVELS } from "./question-intel";

export const LIBRARY_FORMATS = ["mcq", "mrq", "short", "cloze", "true_false", "extended", "flashcard", "match", "sequence", "structured"] as const;
export type LibraryFormat = (typeof LIBRARY_FORMATS)[number];
export const LIBRARY_FORMAT_LABEL: Record<LibraryFormat, string> = {
  mcq: "Single best answer", mrq: "Multiple response", short: "Short answer", cloze: "Fill the blank", true_false: "True or false",
  extended: "Extended response", flashcard: "Flashcard", match: "Matching", sequence: "Sequence", structured: "Structured (parts)",
};
export const MARKING_RULES = ["deterministic", "self", "rubric_ai_formative"] as const;
export type MarkingRule = (typeof MARKING_RULES)[number];
export const MARKING_LABEL: Record<MarkingRule, string> = {
  deterministic: "Marked by code against the key (the learner judges an answer code cannot)",
  self: "The learner marks it against the key",
  rubric_ai_formative: "Formative AI feedback against the rubric key points, then the learner's own judgement",
};
/** The marking rules each format may carry. The first is the default. AI only for an extended response. */
export const FORMAT_MARKING: Record<LibraryFormat, readonly MarkingRule[]> = {
  mcq: ["deterministic"], mrq: ["deterministic"], cloze: ["deterministic"], true_false: ["deterministic"], match: ["deterministic"], sequence: ["deterministic"],
  short: ["deterministic", "self"], structured: ["deterministic", "self"], flashcard: ["self"], extended: ["rubric_ai_formative", "self"],
};
/** The learner kind each format is stored as (migrations 416/710). cloze, true_false and extended are `short`. */
export const COPY_KIND: Record<LibraryFormat, "mcq" | "mrq" | "short" | "flashcard" | "match" | "sequence" | "structured"> = {
  mcq: "mcq", mrq: "mrq", short: "short", cloze: "short", true_false: "short", extended: "short", flashcard: "flashcard", match: "match", sequence: "sequence", structured: "structured",
};
export const CLOZE_MARK = "_____";

export type LibraryRubric = {
  objective?: string; level: (typeof COGNITIVE_LEVELS)[number]; expectedAnswer?: string;
  keyPoints: string[]; acceptedAlternatives: string[]; misconceptions: string[]; source: "references"; referenceIds: string[];
};
export type LibraryContent = Record<string, unknown> & { format?: LibraryFormat; stem: string; options: string[]; rationale: string };
export type LibraryCopy = { format: LibraryFormat; kind: (typeof COPY_KIND)[LibraryFormat]; stem: string; options: string[]; correctIndex: number | null; answer: Record<string, unknown> | null; rationale: string };

type Check = { ok: true; content: LibraryContent; format: LibraryFormat } | { ok: false; error: string };

const str = (v: unknown, min: number, max: number): string | null => (typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);
const strList = (v: unknown, min: number, max: number, each: number): string[] | null => {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  const out = v.map(x => str(x, 1, each));
  return out.every(Boolean) ? (out as string[]) : null;
};
const distinct = (xs: readonly string[]) => new Set(xs.map(x => x.toLowerCase())).size === xs.length;
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** Pure. The format a stored library content is read as: its `format`, or mcq for a legacy (442) question. null: neither. */
export function libraryFormatOf(content: unknown): LibraryFormat | null {
  const c = (content ?? {}) as Record<string, unknown>;
  if (c.format === undefined) return "mcq";
  return (LIBRARY_FORMATS as readonly string[]).includes(c.format as string) ? (c.format as LibraryFormat) : null;
}

/** Pure. A rubric as the library stores it (the shape question-intel.ts rubricOf reads), or the reason it is not one. */
export function checkRubric(raw: unknown, need: { keyPoints?: [number, number] } = {}): { ok: true; rubric: LibraryRubric | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return need.keyPoints ? { ok: false, error: `The rubric needs ${need.keyPoints[0]} to ${need.keyPoints[1]} key points.` } : { ok: true, rubric: null };
  const r = raw as Record<string, unknown>;
  if (typeof r !== "object" || Array.isArray(r)) return { ok: false, error: "The rubric is not readable." };
  if (!(COGNITIVE_LEVELS as readonly string[]).includes(r.level as string)) return { ok: false, error: "Choose the rubric's cognitive level: recall, understanding, application or clinical reasoning." };
  const list = (v: unknown, max: number) => (v === undefined || v === null ? [] : strList(v, 0, max, 300));
  const keyPoints = list(r.keyPoints, 8), alts = list(r.acceptedAlternatives, 8), mis = list(r.misconceptions, 3);
  if (!keyPoints || !alts || !mis) return { ok: false, error: "Rubric entries are short lines of text: at most 8 key points, 8 accepted alternatives and 3 misconceptions, 300 characters each." };
  if (need.keyPoints && (keyPoints.length < need.keyPoints[0] || keyPoints.length > need.keyPoints[1])) return { ok: false, error: `The rubric needs ${need.keyPoints[0]} to ${need.keyPoints[1]} key points.` };
  const objective = r.objective === undefined || r.objective === null || r.objective === "" ? null : str(r.objective, 2, 300);
  const expected = r.expectedAnswer === undefined || r.expectedAnswer === null || r.expectedAnswer === "" ? null : str(r.expectedAnswer, 1, 600);
  if ((r.objective && !objective) || (r.expectedAnswer && !expected)) return { ok: false, error: "The rubric objective is at most 300 characters and the expected answer at most 600." };
  return { ok: true, rubric: {
    ...(objective ? { objective } : {}), level: r.level as LibraryRubric["level"], ...(expected ? { expectedAnswer: expected } : {}),
    keyPoints, acceptedAlternatives: alts, misconceptions: mis, source: "references", referenceIds: [],
  } };
}

/**
 * Pure. THE validator of a library question's content: the plain reason it cannot be saved, submitted or published, or the
 * content normalised (trimmed, unknown keys dropped, the declared `source` kept as given -- question-source.ts judges it).
 * A legacy question (no `format`) is held to exactly the 442 shape and returned unchanged.
 */
export function validateLibraryQuestion(raw: unknown): Check {
  const c = (raw ?? {}) as Record<string, unknown>;
  if (typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "The question is not readable." };
  const format = libraryFormatOf(c);
  if (!format) return { ok: false, error: "Choose one of the question formats." };
  const stem = str(c.stem, 10, 2000), rationale = str(c.rationale, 10, 4000);
  if (!stem) return { ok: false, error: format === "true_false" ? "Write the statement (10 to 2000 characters)." : "Write the question (10 to 2000 characters)." };
  if (!rationale) return { ok: false, error: "Write the explanation learners see after answering (10 to 4000 characters)." };
  const source = c.source !== undefined ? { source: c.source } : {};

  if (c.format === undefined) {
    // 442 exactly: four options, one correct. Nothing else is read or written.
    const options = strList(c.options, 4, 4, 500);
    if (!options) return { ok: false, error: "A single best answer question has four options, each written." };
    if (!isInt(c.correct_index, 0, 3)) return { ok: false, error: "Choose the correct option." };
    return { ok: true, format, content: c as LibraryContent };
  }

  const marking = (c.marking ?? FORMAT_MARKING[format][0]) as MarkingRule;
  if (!FORMAT_MARKING[format].includes(marking)) return { ok: false, error: `A ${LIBRARY_FORMAT_LABEL[format].toLowerCase()} question is marked ${FORMAT_MARKING[format].map(m => MARKING_LABEL[m].toLowerCase()).join(" or ")}.` };
  const rub = checkRubric(c.rubric, format === "extended" ? { keyPoints: [3, 8] } : {});
  if (!rub.ok) return rub;
  const k = (c.answerKey ?? {}) as Record<string, unknown>;
  const out = (options: string[], answerKey: Record<string, unknown> | null, extra: Record<string, unknown> = {}): Check => {
    const content: LibraryContent = { format, stem, options, ...extra, ...(answerKey ? { answerKey } : {}), ...(rub.rubric ? { rubric: rub.rubric } : {}), marking, rationale, ...source };
    if (JSON.stringify(content).length > 30000) return { ok: false, error: "The question is too long to store." };
    const copy = libraryCopyOf(content);
    if (!copy || JSON.stringify(copy.answer ?? {}).length > 15000) return { ok: false, error: "The question is too long to store." };
    return { ok: true, format, content };
  };

  switch (format) {
    case "mcq": {
      const options = strList(c.options, 4, 4, 500);
      if (!options || !distinct(options)) return { ok: false, error: "A single best answer question has four different options." };
      if (!isInt(c.correct_index, 0, 3)) return { ok: false, error: "Choose the correct option." };
      return out(options, null, { correct_index: c.correct_index });
    }
    case "mrq": {
      const options = strList(c.options, 4, 6, 500);
      if (!options || !distinct(options)) return { ok: false, error: "A multiple response question has four to six different options." };
      const correct = Array.isArray(k.correct) ? [...new Set(k.correct as unknown[])] : [];
      if (!correct.every(i => isInt(i, 0, options.length - 1)) || correct.length < 1 || correct.length > options.length - 1)
        return { ok: false, error: "Mark at least one option correct, and leave at least one incorrect." };
      return out(options, { correct: (correct as number[]).sort((a, b) => a - b) });
    }
    case "short": {
      const accepted = strList(k.accepted, 1, 8, 200);
      if (!accepted || !distinct(accepted)) return { ok: false, error: "Give one to eight accepted answers, each different." };
      return out([], { accepted });
    }
    case "cloze": {
      if (stem.split(CLOZE_MARK).length !== 2) return { ok: false, error: `Mark the one blank in the sentence as ${CLOZE_MARK}.` };
      const accepted = strList(k.accepted, 1, 8, 80);
      if (!accepted || !distinct(accepted)) return { ok: false, error: "Give the word or term that fills the blank (and up to seven accepted variants)." };
      return out([], { format: "cloze", accepted });
    }
    case "true_false": {
      const truth = k.accepted && Array.isArray(k.accepted) ? k.accepted[0] : k.truth;
      const t = truth === true || truth === "true" ? "true" : truth === false || truth === "false" ? "false" : null;
      if (!t) return { ok: false, error: "Say whether the statement is true or false." };
      return out([], { format: "true_false", accepted: [t], statement: stem, explanation: rationale });
    }
    case "extended": {
      const model = str(k.modelAnswer, 20, 1200);
      if (!model) return { ok: false, error: "Write the model answer (20 to 1200 characters)." };
      const marks = isInt(k.marks, 1, 10) ? k.marks : rub.rubric!.keyPoints.length;
      if (!isInt(marks, 1, 10)) return { ok: false, error: "An extended response carries 1 to 10 practice marks." };
      return out([], { format: "extended", accepted: [model], modelAnswer: model, marks });
    }
    case "flashcard": {
      const back = str(k.back, 1, 2000);
      if (!back) return { ok: false, error: "Write the back of the card." };
      return out([], { back });
    }
    case "match": {
      const options = strList(c.options, 3, 6, 300), matches = strList(k.matches, 3, 6, 300);
      if (!options || !matches || options.length !== matches.length || !distinct(options) || !distinct(matches))
        return { ok: false, error: "Give three to six pairs: each prompt and its match, all different." };
      return out(options, { matches });
    }
    case "sequence": {
      const options = strList(c.options, 3, 6, 300);
      if (!options || !distinct(options)) return { ok: false, error: "Give three to six different steps." };
      const order = Array.isArray(k.order) ? (k.order as unknown[]) : [];
      if (order.length !== options.length || new Set(order).size !== order.length || !order.every(i => isInt(i, 0, options.length - 1)))
        return { ok: false, error: "The order must name every step once." };
      return out(options, { order: order as number[] });
    }
    case "structured": {
      const parts = Array.isArray(k.parts) ? (k.parts as unknown[]) : [];
      if (parts.length < 2 || parts.length > 4) return { ok: false, error: "A structured question has two to four parts." };
      const clean: Record<string, unknown>[] = [];
      for (const [i, p] of parts.entries()) {
        const x = (p ?? {}) as Record<string, unknown>;
        const prompt = str(x.prompt, 5, 600), accepted = strList(x.accepted, 1, 4, 200);
        if (!prompt || !isInt(x.marks, 1, 5) || !accepted) return { ok: false, error: `Part ${String.fromCharCode(97 + i)}: write its question, its marks (1 to 5) and one to four accepted answers.` };
        const pr = checkRubric(x.rubric);
        if (!pr.ok) return { ok: false, error: `Part ${String.fromCharCode(97 + i)}: ${pr.error}` };
        clean.push({ prompt, marks: x.marks, accepted, ...(pr.rubric ? { rubric: pr.rubric } : {}) });
      }
      return out([], { parts: clean });
    }
  }
}

/**
 * Pure. The learner's own copy of a VALID library content: the stored kind, stem, options, key and answer, exactly as the
 * 800 guard rebuilds it from the published version (answerKey, then the rubric, then -- for every kind but mcq -- the
 * marking rule). null when the content is not a library question.
 */
export function libraryCopyOf(content: unknown): LibraryCopy | null {
  const c = (content ?? {}) as Record<string, unknown>;
  const format = libraryFormatOf(c);
  if (!format || typeof c.stem !== "string" || typeof c.rationale !== "string") return null;
  const options = Array.isArray(c.options) ? (c.options as string[]) : [];
  const rubric = c.rubric && typeof c.rubric === "object" && !Array.isArray(c.rubric) ? { rubric: c.rubric } : {};
  if (format === "mcq") {
    if (typeof c.correct_index !== "number") return null;
    return { format, kind: "mcq", stem: c.stem, options, correctIndex: c.correct_index, answer: "rubric" in rubric ? rubric : null, rationale: c.rationale };
  }
  const key = c.answerKey && typeof c.answerKey === "object" && !Array.isArray(c.answerKey) ? (c.answerKey as Record<string, unknown>) : null;
  if (!key) return null;
  const marking = typeof c.marking === "string" ? { marking: c.marking } : {};
  return { format, kind: COPY_KIND[format], stem: c.stem, options, correctIndex: null, answer: { ...key, ...rubric, ...marking }, rationale: c.rationale };
}

/** Pure. The marking rule a stored learner answer carries (a library copy), or null (every question Scholar writes). */
export const markingOf = (answer: unknown): MarkingRule | null => {
  const m = (answer as Record<string, unknown> | null)?.marking;
  return (MARKING_RULES as readonly string[]).includes(m as string) ? (m as MarkingRule) : null;
};

/**
 * Pure. Whether AI evaluation may judge an answer to this question. Every question Scholar writes: as the policy says
 * (unchanged). A governed library copy: only where its version's marking rule is rubric_ai_formative.
 */
export const aiMarkingAllowed = (q: { library?: unknown; answer: unknown }): boolean => !q.library || markingOf(q.answer) === "rubric_ai_formative";

/** Pure. The key of a library content in words, for HQ's catalogue and review (never sent to a learner before answering). */
export function libraryKeyText(content: unknown): string {
  const copy = libraryCopyOf(content);
  if (!copy) return "";
  const a = (copy.answer ?? {}) as Record<string, unknown>;
  const o = copy.options;
  switch (copy.format) {
    case "mcq": return copy.correctIndex !== null ? o[copy.correctIndex] ?? "" : "";
    case "mrq": return ((a.correct as number[]) ?? []).map(i => o[i]).join("; ");
    case "short": case "cloze": return ((a.accepted as string[]) ?? []).join("; ");
    case "true_false": return (a.accepted as string[])?.[0] === "true" ? "True" : "False";
    case "extended": return String(a.modelAnswer ?? "");
    case "flashcard": return String(a.back ?? "");
    case "match": return o.map((p, i) => `${p} -> ${(a.matches as string[])?.[i] ?? ""}`).join("; ");
    case "sequence": return ((a.order as number[]) ?? []).map(i => o[i]).join(" -> ");
    case "structured": return ((a.parts as { prompt: string; marks: number; accepted: string[] }[]) ?? []).map((p, i) => `(${String.fromCharCode(97 + i)}) ${p.accepted?.[0] ?? ""} [${p.marks}]`).join("; ");
  }
}

/**
 * Pure. A learner's own stored question (416/710 row) as library content: the inverse of libraryCopyOf, then held to
 * validateLibraryQuestion. Its rubric is normalised to the library shape (a rubric that is not one is left out, never
 * guessed), and its marking rule is the format's default. A case step, or a question without a sound key, is not one.
 * Used ONLY to build the structured snapshot of a question the learner chose to offer (src/lib/question-offers).
 */
export function libraryContentOfLearnerQuestion(q: { kind: string; stem: string; options: readonly string[]; correctIndex: number | null; answer: unknown; rationale: string }): Check {
  if (q.kind === "case") return { ok: false, error: "A case step cannot be offered as a library question." };
  const a = (q.answer && typeof q.answer === "object" && !Array.isArray(q.answer) ? q.answer : {}) as Record<string, unknown>;
  const format = (q.kind === "short" && typeof a.format === "string" && ["cloze", "true_false", "extended"].includes(a.format) ? a.format : q.kind) as LibraryFormat;
  if (!(LIBRARY_FORMATS as readonly string[]).includes(format)) return { ok: false, error: "This kind of question cannot be offered." };
  const rub = checkRubric(a.rubric, format === "extended" ? { keyPoints: [3, 8] } : {});
  const rubric = rub.ok && rub.rubric ? { rubric: rub.rubric } : {};
  const { rubric: _r, marking: _m, partialCredit: _p, ...key } = a;
  void _r; void _m; void _p;
  if (format === "structured" && Array.isArray(key.parts))
    key.parts = (key.parts as Record<string, unknown>[]).map(p => { const pr = checkRubric(p?.rubric); const { rubric: _pr, ...rest } = p ?? {}; void _pr; return { ...rest, ...(pr.ok && pr.rubric ? { rubric: pr.rubric } : {}) }; });
  const base = { format, stem: q.stem, options: [...q.options], ...rubric, rationale: q.rationale };
  return validateLibraryQuestion(format === "mcq" ? { ...base, correct_index: q.correctIndex } : { ...base, answerKey: key });
}
