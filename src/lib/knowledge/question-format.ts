import { normaliseSource } from "./question-source";
import { LIBRARY_FORMATS, type LibraryFormat } from "@/lib/individual/scholar/library-format";

// ── A LIBRARY QUESTION FROM THE EDUCATOR'S FORM ── SQIE-LIBRARY-EXPANSION-01 (owner GO 31 Oct 2026, item F) ─────────────
//
// Pure. The educator form (KnowledgeControls.tsx) sends plain fields: the format, the question, and the fields of that
// format. This builds the content a library version stores (library-format.ts describes it). It decides NOTHING about
// validity: educator.ts passes what it builds to validateLibraryQuestion -- the same reader Scholar uses -- before any
// write, and 442 (as widened by 800) checks the shape a third time in the database.
//
// A single best answer question with no rubric is built in the 442 shape exactly (no format key), so a question written
// the way it always was stays byte-for-byte what every reader already knows.

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const lines = (v: unknown, n: number, each: number): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\r?\n/) : []).map(x => s(x, each)).filter(Boolean).slice(0, n);
const int = (v: unknown): number | undefined => { const n = Number(v); return Number.isInteger(n) ? n : undefined; };

/** Pure. A deterministic, never-identity order of n steps from the question's own text (no clock, no randomness). */
export function stepShuffle(n: number, seed: string): number[] {
  const idx = [...Array(n).keys()];
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  for (let i = n - 1; i > 0; i--) { h = Math.imul(h ^ i, 16777619) >>> 0; const j = h % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return n >= 2 && idx.every((v, i) => v === i) ? [...idx.slice(1), idx[0]] : idx;
}

/** Pure. The rubric fields of the form, or undefined when the educator gave none. */
function rubricOf(f: Record<string, unknown>, keyPoints?: string[]): Record<string, unknown> | undefined {
  const r = (f.rubric ?? {}) as Record<string, unknown>;
  const kp = keyPoints ?? lines(r.keyPoints, 8, 300);
  const mis = lines(r.misconceptions, 3, 300), alts = lines(r.acceptedAlternatives, 8, 300), objective = s(r.objective, 300);
  if (!kp.length && !mis.length && !alts.length && !objective && !r.level) return undefined;
  return { level: s(r.level, 20) || "understanding", ...(objective ? { objective } : {}), keyPoints: kp, acceptedAlternatives: alts, misconceptions: mis };
}

/** Pure. The content of a revision question from the educator's form fields. */
export function questionContentFromFields(f: Record<string, unknown>): Record<string, unknown> {
  const format = ((LIBRARY_FORMATS as readonly string[]).includes(f.format as string) ? f.format : "mcq") as LibraryFormat;
  const source = normaliseSource(f.source);
  const tail = { ...(source ? { source } : {}) };
  const stem = s(f.stem, 2000), rationale = s(f.rationale, 4000);
  const marking = typeof f.marking === "string" && f.marking ? { marking: f.marking } : {};
  const rubric = format === "extended" ? rubricOf(f, lines(f.keyPoints, 8, 300)) : rubricOf(f);
  const withRubric = rubric ? { rubric } : {};
  const options = Array.isArray(f.options) ? f.options.slice(0, 6).map(o => s(o, 500)) : [];
  const common = (o: string[], answerKey: Record<string, unknown> | null) => ({ format, stem, options: o, ...(answerKey ? { answerKey } : {}), ...withRubric, ...marking, rationale, ...tail });
  switch (format) {
    case "mcq": {
      const ci = int(f.correctIndex) ?? Number(f.correctIndex);
      // The 442 shape exactly, unless a rubric is given (which needs the format key to be stored with it).
      if (!rubric) return { stem, options: options.slice(0, 4), correct_index: ci, rationale, ...tail };
      return { format, stem, options: options.slice(0, 4), correct_index: ci, ...withRubric, ...marking, rationale, ...tail };
    }
    case "mrq": return common(options, { correct: (Array.isArray(f.correct) ? f.correct : []).map(int).filter((x): x is number => x !== undefined) });
    case "short": return common([], { accepted: lines(f.accepted, 8, 200) });
    case "cloze": return common([], { format: "cloze", accepted: lines(f.accepted, 8, 80) });
    case "true_false": return common([], { format: "true_false", truth: f.truth === true || f.truth === "true" ? true : f.truth === false || f.truth === "false" ? false : null });
    case "extended": return common([], { format: "extended", modelAnswer: s(f.modelAnswer, 1200), ...(int(f.marks) !== undefined ? { marks: int(f.marks) } : {}) });
    case "flashcard": return common([], { back: s(f.back, 2000) });
    case "match": {
      const pairs = (Array.isArray(f.pairs) ? f.pairs : []).slice(0, 6).map(p => ({ prompt: s((p as Record<string, unknown>)?.prompt, 300), match: s((p as Record<string, unknown>)?.match, 300) }))
        .filter(p => p.prompt || p.match);
      return common(pairs.map(p => p.prompt), { matches: pairs.map(p => p.match) });
    }
    case "sequence": {
      // The educator gives the steps IN ORDER. They are stored shuffled (learners see that order), keyed by `order`.
      const steps = lines(f.steps, 6, 300);
      const perm = stepShuffle(steps.length, stem);
      return common(perm.map(i => steps[i]), { order: steps.map((_, j) => perm.indexOf(j)) });
    }
    case "structured": {
      const parts = (Array.isArray(f.parts) ? f.parts : []).slice(0, 4).map(p => {
        const x = (p ?? {}) as Record<string, unknown>;
        return { prompt: s(x.prompt, 600), marks: int(x.marks) ?? Number(x.marks), accepted: lines(x.accepted, 4, 200) };
      });
      return common([], { parts });
    }
  }
}

/** Pure. The form fields of a stored content (the inverse of questionContentFromFields), for editing a draft. */
export function fieldsFromQuestionContent(c: Record<string, unknown>): Record<string, unknown> {
  const format = (typeof c.format === "string" ? c.format : "mcq") as LibraryFormat;
  const k = (c.answerKey ?? {}) as Record<string, unknown>;
  const r = (c.rubric ?? {}) as Record<string, unknown>;
  const options = Array.isArray(c.options) ? c.options.map(String) : [];
  const base = { format, stem: String(c.stem ?? ""), rationale: String(c.rationale ?? ""), marking: typeof c.marking === "string" ? c.marking : "", source: c.source,
    rubric: { level: String(r.level ?? ""), objective: String(r.objective ?? ""), keyPoints: Array.isArray(r.keyPoints) ? r.keyPoints.join("\n") : "", misconceptions: Array.isArray(r.misconceptions) ? r.misconceptions.join("\n") : "" } };
  switch (format) {
    case "mcq": return { ...base, options: options.length ? options : ["", "", "", ""], correctIndex: Number(c.correct_index ?? 0) };
    case "mrq": return { ...base, options, correct: Array.isArray(k.correct) ? k.correct : [] };
    case "short": case "cloze": return { ...base, accepted: Array.isArray(k.accepted) ? k.accepted.join("\n") : "" };
    case "true_false": return { ...base, truth: Array.isArray(k.accepted) ? k.accepted[0] : "" };
    case "extended": return { ...base, modelAnswer: String(k.modelAnswer ?? ""), marks: k.marks ?? "", keyPoints: Array.isArray(r.keyPoints) ? r.keyPoints.join("\n") : "" };
    case "flashcard": return { ...base, back: String(k.back ?? "") };
    case "match": return { ...base, pairs: options.map((p, i) => ({ prompt: p, match: String((k.matches as unknown[] | undefined)?.[i] ?? "") })) };
    case "sequence": return { ...base, steps: (Array.isArray(k.order) ? (k.order as number[]) : []).map(i => options[i] ?? "").join("\n") };
    case "structured": return { ...base, parts: (Array.isArray(k.parts) ? k.parts : []).map(p => { const x = p as Record<string, unknown>; return { prompt: String(x.prompt ?? ""), marks: x.marks ?? 1, accepted: Array.isArray(x.accepted) ? x.accepted.join("\n") : "" }; }) };
  }
}
