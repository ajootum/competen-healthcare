// ── READING AN EXAMINATION PAPER ── COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570) ───────────────────────────────
//
// Pure. A paper the student uploaded is an ordinary Scholar material: its text is already read, page by page, into
// sections (extract.ts). This turns those lines into the paper's STRUCTURE -- its printed instructions, sections,
// numbered questions and parts, answer options and marks -- keeping each question's number exactly as printed and
// the page and section it came from.
//
// ⚠ NOTHING IS GUESSED. What cannot be read is FLAGGED, never filled in: a page with no readable text, a gap in the
// numbering, a question that refers to a figure the text does not carry, a choice question whose options were not
// found, and any "[UNREADABLE]" an AI transcription marked. The student is sent to the original for those.
//
// ⚠ NO AI. This is deterministic, so the same paper always reads the same way and nothing is sent anywhere.

export type PaperLine = { text: string; chunkId: string | null; page: number | null };
export type ExamOption = { label: string; text: string };

export type QuestionFlagKind =
  /** It mentions a figure, diagram, image, table or trace: what the text carries may not be all of it. */
  | "figure_referenced"
  /** It asks for a choice and no options were found. */
  | "options_missing"
  /** Lower-case items were read as options because the question asks for a choice. */
  | "structure_inferred"
  /** The shared lead-in of a question with parts: context, not a question to answer. */
  | "lead_in"
  /** Transcribed by AI from a scanned page: check it against the original. */
  | "transcribed"
  /** The transcription marked something it could not read. */
  | "unreadable_text";
export type QuestionFlag = { kind: QuestionFlagKind };

export type PaperFlag =
  | { kind: "unreadable_page"; page: number }
  | { kind: "numbering_gap"; after: string; missing: string }
  | { kind: "no_questions_found" }
  | { kind: "too_many_questions"; kept: number }
  | { kind: "transcribed_pages"; pages: number[] };

export type ParsedQuestion = {
  ordinal: number;
  number: string;
  section: string | null;
  instructions: string | null;
  stem: string;
  options: ExamOption[];
  marks: number | null;
  pageFrom: number | null;
  pageTo: number | null;
  chunkId: string | null;
  flags: QuestionFlag[];
};

export type ParsedPaper = { instructions: string | null; questions: ParsedQuestion[]; flags: PaperFlag[] };

export const EXAM_QUESTION_MAX = 300;
export const PAPER_PARSER = "paper-parser-v1";
export const UNREADABLE_MARK = "[UNREADABLE]";

/** One line per printed line, each knowing its page and section. */
export function linesFromChunks(chunks: readonly { id: string | null; content: string; pageFrom: number | null }[]): PaperLine[] {
  return chunks.flatMap(c => c.content.split("\n").map(t => t.trim()).filter(Boolean).map(text => ({ text, chunkId: c.id, page: c.pageFrom })));
}

const QUESTION_RE = /^(?:(?:Q|Qn|Qu|Question)\s*\.?\s*)?(\d{1,3})\s*[.):]\s*(\S.*)?$/i;
const QUESTION_WORD_RE = /^(?:Q|Question)\s*\.?\s*(\d{1,3})\b[.):\s-]*(.*)$/i;
const PART_RE = /^\(([a-h])\)\s*(.*)$|^([a-h])\)\s*(.*)$/;
const ROMAN_RE = /^\((i{1,3}|iv|v|vi{1,3}|ix|x)\)\s*(.*)$/;
const OPTION_RE = /^\(?([A-H])[.)]\s+(\S.*)$/;
const LOWER_OPTION_RE = /^\(?([a-h])[.)]\s+(\S.*)$/;
const SECTION_RE = /^(?:section|part)\s+(?:[A-Z]|[IVX]{1,4}|\d{1,2})\b.*$/i;
const MARKS_RE = /[[(]\s*(\d{1,3}(?:\.5)?)\s*marks?\s*[\])]|[[(]\s*(\d{1,2})\s*[\])]\s*$/i;
const CHOICE_CUE = /\b(choose|select|circle|tick|best answer|single best|most appropriate|which (?:one )?of the following|true or false|one answer)\b/i;
const FIGURE_CUE = /\b(figure|fig\.|diagram|image|illustration|graph|chart|table|ecg|electrocardiogram|x-?ray|radiograph|photograph|picture|scan shown|shown (?:above|below))\b/i;
const INSTRUCTION_CUE = /^(choose|select|answer|tick|circle|write|indicate|match|label|complete|fill in)\b/i;
const PREAMBLE_CUE = /^(answer|attempt|write|read|do not|candidates?|time allowed|duration|use (?:a|black|blue|only)|all questions|each question|you (?:must|should|may)|marks? (?:are|for)|this (?:paper|examination))\b/i;
const QUESTION_CUE = /\?|\bmarks?\b|^(describe|explain|list|name|state|define|discuss|outline|compare|calculate|identify|give|what|which|why|how|when|study)\b/i;
const ROMAN_ORDER = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

type Open = {
  number: string; section: string | null; instructions: string[]; stem: string[]; options: ExamOption[]; marks: number | null;
  pageFrom: number | null; pageTo: number | null; chunkId: string | null; lowerOptions: boolean; leadIn: boolean;
};

/** Pure. The paper's lines → its instructions, questions and flags. `emptyPages`: pages with no readable text. */
export function parsePaper(lines: readonly PaperLine[], opts: { emptyPages?: readonly number[]; transcribedPages?: readonly number[] } = {}): ParsedPaper {
  const flags: PaperFlag[] = [...(opts.emptyPages ?? [])].sort((a, b) => a - b).map(page => ({ kind: "unreadable_page" as const, page }));
  if (opts.transcribedPages?.length) flags.push({ kind: "transcribed_pages", pages: [...opts.transcribedPages].sort((a, b) => a - b) });
  const transcribed = new Set(opts.transcribedPages ?? []);
  const preamble: string[] = [];
  const out: Open[] = [];
  let section: string | null = null;
  let main: number | null = null;
  let part: string | null = null;
  let roman: string | null = null;
  let cur: Open | null = null;
  let afterSection = false;

  const open = (number: string, text: string, l: PaperLine, leadIn = false) => {
    cur = { number, section, instructions: [], stem: text ? [text] : [], options: [], marks: null, pageFrom: l.page, pageTo: l.page, chunkId: l.chunkId, lowerOptions: false, leadIn };
    out.push(cur);
  };

  for (const l of lines) {
    const text = l.text;
    if (cur) (cur as Open).pageTo = l.page ?? (cur as Open).pageTo;

    if (SECTION_RE.test(text) && text.length <= 200) { section = text; afterSection = true; continue; }
    const wasAfterSection = afterSection; afterSection = false;

    // A new numbered question: the next number in sequence (or the first), so a numbered list inside a stem is not one.
    const qm = QUESTION_WORD_RE.exec(text) ?? QUESTION_RE.exec(text);
    if (qm && !out.length && PREAMBLE_CUE.test((qm[2] ?? "").trim())) { preamble.push(text); continue; }
    if (qm) {
      const n = Number(qm[1]);
      const explicit = QUESTION_WORD_RE.test(text);
      // A jump forward (a missing question) is taken only where a question plainly starts -- a new section, or a
      // question cue -- and the gap is flagged. Anything else is read as a list inside the open question.
      const rest = (qm[2] ?? "").trim();
      const jump = main !== null && n > main + 1 && n <= main + 3 && (wasAfterSection || QUESTION_CUE.test(rest));
      if (explicit || (main === null ? n >= 1 && n <= 3 : n === main + 1 || jump)) {
        if (main !== null && n > main + 1) flags.push({ kind: "numbering_gap", after: String(main), missing: n - main === 2 ? String(main + 1) : `${main + 1}-${n - 1}` });
        main = n; part = null; roman = null;
        open(String(n), (qm[2] ?? "").trim(), l);
        continue;
      }
    }

    if (cur && main !== null) {
      const c = cur as Open;
      const choice = CHOICE_CUE.test([...c.instructions, ...c.stem].join(" "));
      // Upper-case options belong to the open question.
      const om = OPTION_RE.exec(text);
      if (om && (c.options.length ? om[1] === String.fromCharCode(c.options[c.options.length - 1].label.charCodeAt(0) + 1) : om[1] === "A")) {
        c.options.push({ label: om[1], text: om[2].trim() });
        continue;
      }
      // Lower-case items: options when the question asks for a choice, otherwise the parts of the question.
      const lm = LOWER_OPTION_RE.exec(text);
      if (lm && choice && !part && (c.options.length ? lm[1] === String.fromCharCode(c.options[c.options.length - 1].label.toLowerCase().charCodeAt(0) + 1) : lm[1] === "a")) {
        c.options.push({ label: lm[1].toUpperCase(), text: lm[2].trim() });
        c.lowerOptions = true;
        continue;
      }
      const pm = PART_RE.exec(text);
      const letter = pm ? (pm[1] ?? pm[3]) : null;
      if (pm && letter && (part === null ? letter === "a" : letter.charCodeAt(0) === part.charCodeAt(0) + 1)) {
        if (part === null) c.leadIn = true; // what came before (a) is the shared lead-in
        part = letter; roman = null;
        open(`${main}(${letter})`, (pm[2] ?? pm[4] ?? "").trim(), l);
        continue;
      }
      const rm = ROMAN_RE.exec(text);
      if (rm && part !== null && (roman === null ? rm[1] === "i" : ROMAN_ORDER.indexOf(rm[1]) === ROMAN_ORDER.indexOf(roman) + 1)) {
        if (roman === null) c.leadIn = c.leadIn || c.number === `${main}(${part})`;
        roman = rm[1];
        open(`${main}(${part})(${rm[1]})`, rm[2].trim(), l);
        continue;
      }
      // Anything else continues the open question: its last option, its instructions, or its stem.
      if (c.options.length && !INSTRUCTION_CUE.test(text)) { c.options[c.options.length - 1].text += ` ${text}`; continue; }
      if (INSTRUCTION_CUE.test(text) && text.length <= 300 && !c.options.length) { c.instructions.push(text); continue; }
      c.stem.push(text);
      continue;
    }
    preamble.push(text);
  }

  const questions: ParsedQuestion[] = [];
  for (const o of out) {
    let stem = o.stem.join("\n").trim();
    let marks: number | null = null;
    const mm = MARKS_RE.exec(stem) ?? MARKS_RE.exec(o.options.map(x => x.text).join(" "));
    if (mm) { marks = Number(mm[1] ?? mm[2]); stem = stem.replace(MARKS_RE, "").trim(); }
    const all = [stem, ...o.instructions, ...o.options.map(x => x.text)].join("\n");
    const qf: QuestionFlag[] = [];
    if (o.leadIn) qf.push({ kind: "lead_in" });
    if (FIGURE_CUE.test(all)) qf.push({ kind: "figure_referenced" });
    if (!o.leadIn && !o.options.length && CHOICE_CUE.test(all) && !/true or false/i.test(all)) qf.push({ kind: "options_missing" });
    if (o.lowerOptions) qf.push({ kind: "structure_inferred" });
    if ((o.pageFrom !== null && transcribed.has(o.pageFrom)) || (o.pageTo !== null && transcribed.has(o.pageTo))) qf.push({ kind: "transcribed" });
    // Options with no question text: the text was not found, and is said to be missing rather than written for it.
    if (all.includes(UNREADABLE_MARK) || (!stem && !o.instructions.length && o.options.length)) qf.push({ kind: "unreadable_text" });
    const finalStem = (stem || o.instructions.join(" ") || (o.options.length ? UNREADABLE_MARK : "")).slice(0, 8000);
    if (!finalStem) continue; // a bare number with nothing after it is not a question
    questions.push({
      ordinal: questions.length + 1, number: o.number.slice(0, 40), section: o.section ? o.section.slice(0, 200) : null,
      instructions: o.instructions.length && stem ? o.instructions.join(" ").slice(0, 2000) : null, stem: finalStem,
      options: o.options.slice(0, 10).map(x => ({ label: x.label, text: x.text.slice(0, 1000) })), marks,
      pageFrom: o.pageFrom, pageTo: o.pageTo !== null && o.pageFrom !== null && o.pageTo < o.pageFrom ? o.pageFrom : o.pageTo, chunkId: o.chunkId, flags: qf,
    });
  }
  if (!questions.length) flags.push({ kind: "no_questions_found" });
  let kept = questions;
  if (questions.length > EXAM_QUESTION_MAX) { kept = questions.slice(0, EXAM_QUESTION_MAX); flags.push({ kind: "too_many_questions", kept: EXAM_QUESTION_MAX }); }
  const instructions = preamble.join("\n").trim().slice(0, 4000) || null;
  return { instructions, questions: kept, flags };
}

/** The words a student reads for each flag, beside the question or the paper. */
export const QUESTION_FLAG_TEXT: Record<QuestionFlagKind, string> = {
  figure_referenced: "Refers to a figure, table or image. Only its text was read: check the original page.",
  options_missing: "Asks you to choose, but its options were not found. Check the original page.",
  structure_inferred: "Its lettered items were read as answer options.",
  lead_in: "Shared information for the parts below.",
  transcribed: "Transcribed by AI from a scanned page. Check it against the original.",
  unreadable_text: "Part of it could not be read. Nothing was guessed: check the original page.",
};

export function paperFlagText(f: PaperFlag): string {
  switch (f.kind) {
    case "unreadable_page": return `Page ${f.page} has no readable text, so its questions are not shown. Nothing was guessed: open the original.`;
    case "numbering_gap": return `No question ${f.missing} was found after question ${f.after}. It may be on an unreadable page or printed in a way that could not be read.`;
    case "no_questions_found": return "No numbered questions were found in this paper. Nothing was guessed. You can still study it as notes.";
    case "too_many_questions": return `Only the first ${f.kept} questions are shown.`;
    case "transcribed_pages": return `Pages ${f.pages.join(", ")} were transcribed by AI from a scan. Check them against the original.`;
  }
}

/** The question an answer is written for: the lead-in of its parent (when it has one), then its own words and options. */
export function questionText(q: Pick<ParsedQuestion, "number" | "instructions" | "stem" | "options">, leadIn: string | null): string {
  return [
    leadIn ? `Context: ${leadIn}` : null,
    `Question ${q.number}${q.instructions ? ` (${q.instructions})` : ""}: ${q.stem}`,
    ...q.options.map(o => `${o.label}. ${o.text}`),
  ].filter(Boolean).join("\n");
}

/** Pure. The lead-in that applies to a question: the nearest earlier lead-in whose number prefixes this one's. */
export function leadInFor<Q extends Pick<ParsedQuestion, "number" | "stem" | "flags" | "ordinal">>(q: Q, all: readonly Q[]): string | null {
  const chain = all.filter(o => o.ordinal < q.ordinal && o.flags.some(f => f.kind === "lead_in") && q.number.startsWith(o.number) && q.number !== o.number);
  return chain.length ? chain.map(o => o.stem).join("\n") : null;
}
