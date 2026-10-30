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
  | { kind: "transcribed_pages"; pages: number[] }
  /** SCHOLAR-QUESTION-INTELLIGENCE-01: most numbered lines read as statements, not questions -- notes, not a paper. */
  | { kind: "looks_like_notes"; statements: number };

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

export type ParsedPaper = {
  instructions: string | null; questions: ParsedQuestion[]; flags: PaperFlag[];
  /** Every numbered item read, in order, and whether it is a question (false: a statement, not kept as one). */
  items: { number: string; question: boolean }[];
};

export const EXAM_QUESTION_MAX = 300;
// v2 (SCHOLAR-QUESTION-INTELLIGENCE-01): a numbered line is a question only when something says it asks -- a question
// cue, a "?", marks, options, its parts, a "Question N" label, or a section/paper instruction such as "Answer all
// questions". A numbered statement ("1. Pyelonephritis: this infection spreads ...") is notes, not a question.
export const PAPER_PARSER = "paper-parser-v2";
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
const QUESTION_CUE = /\?|\bmarks?\b|_{3,}|\b(true or false|the following|regarding|concerning|with regard to|in relation to|short notes?)\b|^(describe|explain|list|name|state|define|discuss|outline|compare|contrast|calculate|identify|give|what|which|why|how|when|where|who|study|choose|select|match|label|complete|fill|draw|suggest|justify|evaluate|differentiate|distinguish|classify|interpret|write|mention|enumerate|highlight|briefly|tick|circle|indicate|illustrate|analy[sz]e|assess|demonstrate|examine|summari[sz]e|elaborate|formulate|construct|determine|estimate|predict|recommend|critically)\b/i;
/** A section heading or paper instruction that says what follows are questions ("Answer ALL questions", "Short notes"). */
const CONTEXT_CUE = /\b(answer|attempt|questions?|short notes|essays?|marks?|candidates?|choose|select)\b/i;
/** Below this many statements a material is not called notes: a stray numbered line is not a verdict. */
const NOTES_MIN_STATEMENTS = 3;

/** Pure. Whether a line of text reads as a question (or an instruction to answer), not a statement. */
export const questionLike = (text: string): boolean => QUESTION_CUE.test(text.trim());
const ROMAN_ORDER = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

type Open = {
  number: string; section: string | null; instructions: string[]; stem: string[]; options: ExamOption[]; marks: number | null;
  pageFrom: number | null; pageTo: number | null; chunkId: string | null; lowerOptions: boolean; leadIn: boolean;
  /** Printed as "Question N" / "QN" (or a part of one): a question by its label. */
  explicit: boolean;
  /** The paper or its section says what follows are questions to answer. */
  contextCue: boolean;
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
  let preambleCue = false, sectionCue = false, awaitingFirst = false, explicitMain = false;

  const open = (number: string, text: string, l: PaperLine, leadIn = false) => {
    cur = {
      number, section, instructions: [], stem: text ? [text] : [], options: [], marks: null, pageFrom: l.page, pageTo: l.page, chunkId: l.chunkId, lowerOptions: false, leadIn,
      explicit: explicitMain, contextCue: preambleCue || sectionCue,
    };
    out.push(cur);
    awaitingFirst = false;
  };

  for (const l of lines) {
    const text = l.text;
    if (cur) (cur as Open).pageTo = l.page ?? (cur as Open).pageTo;

    if (SECTION_RE.test(text) && text.length <= 200) { section = text; afterSection = true; sectionCue = CONTEXT_CUE.test(text); awaitingFirst = true; continue; }
    const wasAfterSection = afterSection; afterSection = false;

    // A new numbered question: the next number in sequence (or the first), so a numbered list inside a stem is not one.
    const qm = QUESTION_WORD_RE.exec(text) ?? QUESTION_RE.exec(text);
    if (qm && !out.length && PREAMBLE_CUE.test((qm[2] ?? "").trim())) { preamble.push(text); preambleCue = preambleCue || CONTEXT_CUE.test(text); continue; }
    if (qm) {
      const n = Number(qm[1]);
      const explicit = QUESTION_WORD_RE.test(text);
      // A jump forward (a missing question) is taken only where a question plainly starts -- a new section, or a
      // question cue -- and the gap is flagged. Anything else is read as a list inside the open question.
      const rest = (qm[2] ?? "").trim();
      const jump = main !== null && n > main + 1 && n <= main + 3 && (wasAfterSection || questionLike(rest));
      if (explicit || (main === null ? n >= 1 && n <= 3 : n === main + 1 || jump)) {
        if (main !== null && n > main + 1) flags.push({ kind: "numbering_gap", after: String(main), missing: n - main === 2 ? String(main + 1) : `${main + 1}-${n - 1}` });
        main = n; part = null; roman = null; explicitMain = explicit;
        open(String(n), (qm[2] ?? "").trim(), l);
        continue;
      }
    }

    // A line between a section heading and its first question, or before any question, may say what follows
    // ("Write short notes on the following", "Answer ALL questions").
    if (awaitingFirst && CONTEXT_CUE.test(text)) sectionCue = true;
    if (!out.length && CONTEXT_CUE.test(text)) preambleCue = true;
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

  // Which numbered items are questions. Each asks on its own (a cue, a "?", marks, options, a "Question N" label, or
  // the paper's own instruction), or is a part of one that does, or is the lead-in of parts that do. The rest are
  // statements -- numbered notes -- and are not questions: counted, never offered as a question to answer.
  const asks = out.map(o => o.explicit || o.contextCue || o.options.length > 0 || questionLike([...o.instructions, ...o.stem].join(" "))
    || !!(MARKS_RE.exec(o.stem.join("\n")) ?? MARKS_RE.exec(o.options.map(x => x.text).join(" "))) || o.stem.join(" ").includes(UNREADABLE_MARK));
  const keep = out.map((o, i) => asks[i]
    || out.some((a, j) => asks[j] && o.number.startsWith(`${a.number}(`))
    || (o.leadIn && out.some((d, j) => asks[j] && d.number.startsWith(`${o.number}(`))));
  const statements = keep.filter(k => !k).length;
  // A bare number with nothing after it is neither: it is not kept as a question either (below).
  const items = out.flatMap((o, i) => o.stem.join("\n").trim().replace(MARKS_RE, "").trim() || o.instructions.length || o.options.length ? [{ number: o.number.slice(0, 40), question: keep[i] }] : []);

  const questions: ParsedQuestion[] = [];
  for (const [i, o] of out.entries()) {
    if (!keep[i]) continue;
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
  if (statements >= NOTES_MIN_STATEMENTS && statements > questions.length) flags.push({ kind: "looks_like_notes", statements });
  let kept = questions;
  if (questions.length > EXAM_QUESTION_MAX) { kept = questions.slice(0, EXAM_QUESTION_MAX); flags.push({ kind: "too_many_questions", kept: EXAM_QUESTION_MAX }); }
  const instructions = preamble.join("\n").trim().slice(0, 4000) || null;
  return { instructions, questions: kept, flags, items };
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
    case "looks_like_notes": return NOTES_NOT_PAPER;
  }
}

/** The verdict a student reads on a material that is notes rather than a paper. */
export const NOTES_VERDICT = "This looks like notes rather than an exam paper: its numbered lines are statements, not questions.";
/** What a student reads when a material is notes rather than a paper, with the way on (revise from this material). */
export const NOTES_NOT_PAPER = `${NOTES_VERDICT} Generate practice questions from it instead.`;

/** True when a parsed paper is notes rather than a paper: it is then not kept as a paper. */
export const isNotesNotPaper = (p: Pick<ParsedPaper, "flags">): boolean => p.flags.some(f => f.kind === "looks_like_notes");

// ── A PAPER KEPT BY AN EARLIER PARSER ── SCHOLAR-SQIE-CLOSE-01 P0 ─────────────────────────────────────────────────
//
// A paper prepared before v2 may hold numbered NOTES as "questions" (v1 kept every numbered line). When one is opened it
// is judged again with today's rules, IN THE RESPONSE ONLY: its paper, question and answer rows are never changed.
//
// Basis. The material's own text, read again with parsePaper, is the primary basis: it is exactly what a fresh prepare
// would conclude, and it still sees what the stored rows lost (a "Question N" label, a section's "Answer all questions"
// line). Each stored row is matched to the item with the same number, in order (a number can repeat across sections).
// Where that text cannot serve -- it could not be read, it has no item of that number, or the paper was partly
// transcribed by AI (those lines were never kept as text) -- the row is judged from what is stored, with the same tests
// v2 applies: options, marks, a question cue, the paper's or the section's instruction, an unreadable mark, and a part
// or lead-in of a row that asks.

/** Whether a paper was read by the current parser (a transcribed paper's extractor carries "+ai-transcription"). */
export const isCurrentParser = (extractor: string): boolean => extractor === PAPER_PARSER || extractor.startsWith(`${PAPER_PARSER}+`);

export type LegacyRow = Pick<ParsedQuestion, "number" | "section" | "instructions" | "stem" | "options" | "marks" | "flags"> & { id: string; source?: "text_layer" | "ai_transcription" };
export type LegacyJudgement = {
  /** Mostly (or only) statements: the student is sent to practise from the material instead. */
  notesLike: boolean;
  /** The stored rows that are statements, not questions: never offered as a question to answer. */
  statementIds: string[];
  statements: number;
  questions: number;
  basis: "material_text" | "stored_questions" | "both";
};

/** Pure. A paper kept by an earlier parser, judged with today's rules. `reparsed`: its material text through parsePaper, or null. */
export function judgeLegacyPaper(paper: { extractor: string; instructions: string | null }, rows: readonly LegacyRow[], reparsed: Pick<ParsedPaper, "items"> | null): LegacyJudgement {
  // The material text only stands for rows that came from it: AI-transcribed lines were never kept as text.
  const text = paper.extractor.includes("ai-transcription") ? null : reparsed;
  const byKey = new Map<string, boolean>();
  const seen = new Map<string, number>();
  for (const it of text?.items ?? []) { const k = seen.get(it.number) ?? 0; seen.set(it.number, k + 1); byKey.set(`${it.number}#${k}`, it.question); }
  const paperCue = CONTEXT_CUE.test(paper.instructions ?? "");
  const asks = rows.map(r => paperCue || (!!r.section && CONTEXT_CUE.test(r.section)) || r.options.length > 0 || r.marks !== null
    || questionLike([r.instructions ?? "", r.stem].join(" ")) || r.stem.includes(UNREADABLE_MARK));
  const stored = rows.map((r, i) => asks[i]
    || rows.some((a, j) => asks[j] && r.number.startsWith(`${a.number}(`))
    || (r.flags.some(f => f.kind === "lead_in") && rows.some((d, j) => asks[j] && d.number.startsWith(`${r.number}(`))));
  const count = new Map<string, number>();
  let fromText = 0;
  const question = rows.map((r, i) => {
    const k = count.get(r.number) ?? 0; count.set(r.number, k + 1);
    const t = r.source === "ai_transcription" ? undefined : byKey.get(`${r.number}#${k}`);
    if (t === undefined) return stored[i];
    fromText++;
    return t;
  });
  const statementIds = rows.filter((_, i) => !question[i]).map(r => r.id);
  const statements = statementIds.length, questions = rows.length - statements;
  return {
    notesLike: statements > 0 && ((statements >= NOTES_MIN_STATEMENTS && statements > questions) || questions === 0),
    statementIds, statements, questions,
    basis: fromText === rows.length ? "material_text" : fromText === 0 ? "stored_questions" : "both",
  };
}

/**
 * Pure. The front of a revision card made from a paper question, or null when it does not read as a question (a
 * statement kept by the v1 parser): a statement is never put on the front of a card as if it were a question. A part
 * that does not ask on its own (a sub-part such as "at rest") carries the lead-in that does.
 */
export function revisionFront(q: Pick<ParsedQuestion, "number" | "stem" | "options" | "instructions" | "marks">, leadIn: string | null): string | null {
  const asks = q.options.length > 0 || q.marks !== null || questionLike([q.instructions ?? "", q.stem].join(" ").trim());
  if (!asks && !(leadIn && questionLike(leadIn))) return null;
  return [asks ? null : leadIn, `Question ${q.number}: ${q.stem}`, ...q.options.map(o => `${o.label}. ${o.text}`)].filter(Boolean).join("\n").slice(0, 2000);
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
