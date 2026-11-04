import { LIBRARY_FORMAT_LABEL, MARKING_LABEL, MARKING_RULES, libraryFormatOf, type LibraryFormat, type MarkingRule } from "@/lib/individual/scholar/library-format";
import { SOURCE_KIND_LABEL, sourceOf } from "./question-source";
import { ROLE_LABEL, VARIANT_LABEL, calculationSpecOf, criteriaOf, findingsOf, roundingText, toleranceText, unitLabel } from "@/lib/individual/scholar/scoring-rules";

// SQIE-CLOSE-2026-11 (997): what a reviewer must see to approve a calculation, a safety-marked item or a justification /
// interpretation question -- the unit and accepted units, the rounding rule, the tolerance and whether it is in use (it is not,
// until the clinical calculation policy is approved), what is safety-critical and which answers are unsafe, the findings, each
// part's role, choice and weighted criteria.
const TOLERANCE_OFF = "recorded, NOT in use: answers must be exact until the clinical calculation policy is approved and HQ turns calculation tolerances on";
function safetyLines(x: Record<string, unknown>, critical = "Safety-critical: a miss is flagged and named in the feedback (scores nothing for this part when HQ turns clinical scoring caps on)"): string[] {
  const unsafe = Array.isArray(x.unsafe) ? x.unsafe.filter((u): u is string => typeof u === "string" && !!u.trim()) : [];
  return [...(x.safetyCritical === true ? [critical] : []), ...unsafe.map(u => `Unsafe answer (flagged and named in the feedback, at most half this part's marks when HQ turns clinical scoring caps on): ${u}`)];
}

// ── A LIBRARY QUESTION, READ AS A QUESTION ── SQIE-LIBRARY-GAPS-01 ────────────────────────────────────────────────────────
//
// What an editorial or clinical reviewer, and the publisher, read of a CKRI revision_question version: its fields in words,
// by format, with the key marked in words (never by colour alone), instead of the stored JSON. Pure: no I/O, no clock. It
// decides nothing and validates nothing (validateLibraryQuestion does, at save, submission and publication): it shows what is
// stored, and leaves out what is not there.
//
// A legacy question (no `format` key, the 442 single best answer shape) and anything that is not a readable library question
// return null: the page then shows the view it always had.

export type QBlock =
  | { kind: "text"; heading: string; text: string }
  | { kind: "list"; heading: string; items: string[]; ordered?: boolean }
  | { kind: "options"; heading: string; items: { text: string; key: boolean }[] }
  | { kind: "pairs"; heading: string; items: { prompt: string; match: string }[] }
  | { kind: "parts"; heading: string; items: { label: string; prompt: string; marks: number | null; accepted: string[]; rubric: QBlock[] }[] };

export type PresentedQuestion = {
  format: LibraryFormat;
  formatLabel: string;
  marking: MarkingRule | null;
  markingLabel: string | null;
  /** The question as the learner meets it, then the key, the explanation, the rubric and the declared source rights. */
  blocks: QBlock[];
  source: { label: string; lines: string[]; declared: boolean };
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const idx = (v: unknown): number[] => (Array.isArray(v) ? v.filter((i): i is number => typeof i === "number" && Number.isInteger(i)) : []);

const LEVEL_LABEL: Record<string, string> = { recall: "Recall", understanding: "Understanding", application: "Application", clinical_reasoning: "Clinical reasoning" };

/** Pure. The rubric's blocks: level, objective, expected answer, key points, accepted alternatives, misconceptions. [] when none. */
function rubricBlocks(raw: unknown): QBlock[] {
  if (!isObj(raw)) return [];
  const out: QBlock[] = [];
  const level = text(raw.level);
  if (level) out.push({ kind: "text", heading: "Rubric level", text: LEVEL_LABEL[level] ?? level });
  if (text(raw.objective)) out.push({ kind: "text", heading: "Rubric objective", text: text(raw.objective) });
  if (text(raw.expectedAnswer)) out.push({ kind: "text", heading: "Expected answer", text: text(raw.expectedAnswer) });
  if (texts(raw.keyPoints).length) out.push({ kind: "list", heading: "Rubric key points", items: texts(raw.keyPoints) });
  if (texts(raw.acceptedAlternatives).length) out.push({ kind: "list", heading: "Accepted alternatives", items: texts(raw.acceptedAlternatives) });
  if (texts(raw.misconceptions).length) out.push({ kind: "list", heading: "Common misconceptions", items: texts(raw.misconceptions) });
  return out;
}

/** Pure. The declared source rights in words. "Not declared" is said as such: a blank would read as a defect. */
export function presentSource(content: unknown): PresentedQuestion["source"] {
  const s = sourceOf(content);
  if (!s) return { label: "Not declared", lines: [], declared: false };
  return {
    label: SOURCE_KIND_LABEL[s.kind], declared: true,
    lines: [s.reference && `Reference: ${s.reference}`, s.licence && `Licence: ${s.licence}`, s.permissionNote && `Permission: ${s.permissionNote}`].filter((x): x is string => !!x),
  };
}

/**
 * Pure. A stored revision_question content as the fields a reviewer reads, or null when it is a legacy single best answer
 * question (no `format`) or is not a readable library question.
 */
export function presentQuestion(content: unknown): PresentedQuestion | null {
  if (!isObj(content) || content.format === undefined) return null;
  const format = libraryFormatOf(content);
  const stem = text(content.stem);
  if (!format || !stem) return null;
  const k = isObj(content.answerKey) ? content.answerKey : {};
  const options = texts(content.options);
  const marking = (MARKING_RULES as readonly unknown[]).includes(content.marking) ? (content.marking as MarkingRule) : null;
  const blocks: QBlock[] = [];

  switch (format) {
    case "mcq": {
      const ci = typeof content.correct_index === "number" ? content.correct_index : -1;
      blocks.push({ kind: "text", heading: "Question", text: stem }, { kind: "options", heading: "Options", items: options.map((t, i) => ({ text: t, key: i === ci })) });
      break;
    }
    case "mrq": {
      const correct = new Set(idx(k.correct));
      blocks.push({ kind: "text", heading: "Question", text: stem }, { kind: "options", heading: "Options (choose all that apply)", items: options.map((t, i) => ({ text: t, key: correct.has(i) })) });
      break;
    }
    case "short":
      blocks.push({ kind: "text", heading: "Question", text: stem });
      if (texts(k.accepted).length) blocks.push({ kind: "list", heading: "Accepted answers", items: texts(k.accepted) });
      if (safetyLines(k).length) blocks.push({ kind: "list", heading: "Clinical safety", items: safetyLines(k) });
      break;
    case "cloze":
      blocks.push({ kind: "text", heading: "Sentence with the blank", text: stem });
      if (texts(k.accepted).length) blocks.push({ kind: "list", heading: "Fills the blank", items: texts(k.accepted) });
      break;
    case "true_false": {
      const truth = Array.isArray(k.accepted) ? k.accepted[0] : k.truth;
      blocks.push({ kind: "text", heading: "Statement", text: stem });
      if (truth === "true" || truth === true) blocks.push({ kind: "text", heading: "The statement is", text: "True" });
      else if (truth === "false" || truth === false) blocks.push({ kind: "text", heading: "The statement is", text: "False" });
      break;
    }
    case "extended": {
      blocks.push({ kind: "text", heading: "Question", text: stem });
      if (text(k.modelAnswer)) blocks.push({ kind: "text", heading: "Model answer", text: text(k.modelAnswer) });
      if (typeof k.marks === "number") blocks.push({ kind: "text", heading: "Practice marks", text: String(k.marks) });
      {
        const kp = Array.isArray((content.rubric as Record<string, unknown> | undefined)?.keyPoints) ? ((content.rubric as Record<string, unknown>).keyPoints as unknown[]).map(String) : [];
        const scp = Array.isArray(k.safetyCriticalPoints) ? (k.safetyCriticalPoints as unknown[]).filter((i): i is number => typeof i === "number" && i >= 0 && i < kp.length) : [];
        const lines = [...scp.map(i => `Safety-critical key point: ${kp[i]}`), ...safetyLines({ unsafe: k.unsafe })];
        if (lines.length) blocks.push({ kind: "list", heading: "Clinical safety", items: lines });
      }
      break;
    }
    case "flashcard":
      blocks.push({ kind: "text", heading: "Front of the card", text: stem });
      if (text(k.back)) blocks.push({ kind: "text", heading: "Back of the card", text: text(k.back) });
      break;
    case "match": {
      const matches = texts(k.matches);
      blocks.push({ kind: "text", heading: "Question", text: stem }, { kind: "pairs", heading: "Pairs (prompt and its match)", items: options.map((p, i) => ({ prompt: p, match: matches[i] ?? "" })) });
      break;
    }
    case "sequence": {
      const order = idx(k.order).map(i => options[i]).filter((x): x is string => !!x);
      blocks.push({ kind: "text", heading: "Question", text: stem });
      if (options.length) blocks.push({ kind: "list", heading: "Steps as learners first see them (shuffled)", items: options });
      if (order.length) blocks.push({ kind: "list", heading: "Correct order", items: order, ordered: true });
      break;
    }
    case "structured": {
      blocks.push({ kind: "text", heading: "Question", text: stem });
      const parts = Array.isArray(k.parts) ? k.parts.filter(isObj) : [];
      if (parts.length) blocks.push({
        kind: "parts", heading: "Parts",
        items: parts.map((p, i) => {
          const r = p["role"];
          const role = typeof r === "string" && r in ROLE_LABEL ? ROLE_LABEL[r as keyof typeof ROLE_LABEL] : null;
          const opts = texts(p.options), crit = criteriaOf(p.criteria);
          const extra: QBlock[] = [
            ...(opts.length ? [{ kind: "options" as const, heading: "Choice", items: opts.map((t, j) => ({ text: t, key: j === p.correct })) }] : []),
            ...(crit ? [{ kind: "list" as const, heading: "Criteria it is marked against (weight)", items: crit.map(c => `${c.text} (${c.weight})${c.safetyCritical ? " -- safety-critical" : ""}`) }] : []),
            ...(safetyLines(p).length ? [{ kind: "list" as const, heading: "Clinical safety", items: safetyLines(p) }] : []),
          ];
          return { label: `Part ${String.fromCharCode(97 + i)}${role ? ` · ${role}` : ""}`, prompt: text(p.prompt), marks: typeof p.marks === "number" ? p.marks : null, accepted: texts(p.accepted), rubric: [...extra, ...rubricBlocks(p.rubric)] };
        }),
      });
      if (typeof k.variant === "string" && k.variant in VARIANT_LABEL) blocks.splice(blocks.length - 1, 0, { kind: "text", heading: "Kind", text: VARIANT_LABEL[k.variant as keyof typeof VARIANT_LABEL] });
      {
        const f = findingsOf(k);
        if (f.length) blocks.splice(blocks.length - 1, 0, { kind: "list", heading: "Findings shown before the parts", items: f.map(r => `${r.label}: ${r.value}${r.unit ? ` ${r.unit}` : ""}`) });
      }
      break;
    }
    case "calculation": {
      blocks.push({ kind: "text", heading: "Question", text: stem });
      const spec = calculationSpecOf(k);
      if (!spec) { blocks.push({ kind: "text", heading: "Answer key", text: "Not a sound calculation key: it cannot be offered to learners." }); break; }
      blocks.push({ kind: "list", heading: "Answer, marked by code", items: [
        `Answer: ${spec.display}`,
        `Units accepted: ${[spec.unit ? unitLabel(spec.unit) : "no unit", ...spec.equivalentUnits.map(unitLabel)].join(", ")}`,
        `Rounding: ${spec.rounding ? roundingText(spec.rounding) : "the value exactly as written"}`,
        `Tolerance: ${spec.tolerance && spec.tolerance.kind !== "none" ? `${toleranceText(spec.tolerance, spec.unit)} -- ${TOLERANCE_OFF}` : "none (exact)"}`,
        spec.safetyCritical ? "Safety-critical: a tenfold or greater error is unsafe, whatever any tolerance says" : "Not marked safety-critical",
      ] });
      if (spec.working) blocks.push({ kind: "text", heading: "Worked answer shown after answering", text: spec.working });
      if (safetyLines({ unsafe: k.unsafe }).length) blocks.push({ kind: "list", heading: "Unsafe answers", items: safetyLines({ unsafe: k.unsafe }) });
      break;
    }
  }
  if (text(content.rationale)) blocks.push({ kind: "text", heading: "Explanation shown after answering", text: text(content.rationale) });
  blocks.push(...rubricBlocks(content.rubric));
  return { format, formatLabel: LIBRARY_FORMAT_LABEL[format], marking, markingLabel: marking ? MARKING_LABEL[marking] : null, blocks, source: presentSource(content) };
}
