// ── QUESTION QUALITY ── owner review P0.1 (COMPETEN-IND-004): stems, correct answers, distractors,
// terminology, ambiguity and source support ─────────────────────────────────────────────────────────────
//
// Two layers, both before anything is stored.
//
//   1. DETERMINISTIC (pure, this file): every option is built from the passage's own terms; the keyed answer
//      is supported by the quoted source sentence; no "all/none of the above", no option that contains
//      another, a real question with no unmarked negative; lengths bounded. These close the limitation the
//      staging run recorded -- a distractor naming something the notes never mention ("Arrange an urgent CT
//      scan") is now refused, because it is not built from the passage.
//
//   2. BLIND CHECK (one model call, verificationPrompt + applyVerification): a second reader is given the
//      passage and the question WITHOUT the key and asked which options the passage supports, whether the
//      passage alone answers it, whether the stem adds outside facts, and whether it is ambiguous. A question
//      survives only if exactly its keyed option is supported. An unreadable verdict rejects everything --
//      unverifiable is not verified.
//
// ⚠ THE CHECKS ARE CONSERVATIVE ON PURPOSE. A rejected good question costs the student a click; an accepted
// bad one teaches them something their notes do not say.

import type { DraftQuestion } from "./generation";

export type QualityReason =
  | "not_a_question" | "unmarked_negative" | "banned_option" | "options_overlap"
  | "unsupported_term" | "correct_not_supported" | "too_long";

const STOP = new Set((
  "a an and are as at be been but by can could do does for from had has have how if in into is it its may might " +
  "must not of on or should so such than that the their them then there these they this those to was were what " +
  "when where which while who why will with would you your about above after again all also any because before " +
  "being below between both during each few further more most other over same some through under until very " +
  "within without").split(" "));

/** Words that frame a question rather than carry clinical content. They may appear in any option. */
const FRAMING = new Set((
  "following statement statements correct true false according passage notes describe described option options " +
  "only always never usually often other others none neither either first second third last best most least " +
  "likely unlikely increase increased decrease decreased include includes including included part listed list " +
  "example type types category categories cause causes caused alone").split(" "));

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
/** A light stem: common English endings off ("causing", "caused" and "causes" all give "caus"). */
const stemOf = (w: string) => (w.length > 5 ? w.replace(/(ations?|ments?|ingly|ings?|edly|ed|es|s|ly)$/, "") : w);
const contentWords = (s: string) => words(s).filter(w => w.length >= 3 && !STOP.has(w) && !FRAMING.has(w) && !/^\d+$/.test(w));

/**
 * Pure. Content words of `text` that the source never uses. A term counts as the source's when its stem
 * begins or sits inside a source word's stem, so "staged" finds "staging" and "regulated" finds
 * "dysregulated". It still refuses a synonym ("administer" for "give"): a distractor in other words than the
 * notes' is a claim the notes do not make.
 */
export function unsupportedTerms(text: string, source: string): string[] {
  const have = [...new Set(words(source).map(stemOf))];
  const known = (w: string) => {
    const t = stemOf(w);
    const k = t.length > 5 ? t.slice(0, 5) : t;
    return have.some(h => h.startsWith(k) || (t.length >= 4 && h.includes(t)));
  };
  return [...new Set(contentWords(text).filter(w => !known(w)))];
}

/** Pure. The passage's own content words, for the prompt: the only vocabulary a wrong option may use. */
export function passageVocabulary(source: string, max = 120): string[] {
  return [...new Set(contentWords(source))].slice(0, max);
}

const norm = (s: string) => words(s).join(" ");

/** Pure. The deterministic quality failures of one well-formed draft, against its passage. Empty = passes. */
export function qualityProblems(q: DraftQuestion, passage: string): { reason: QualityReason; detail?: string }[] {
  const out: { reason: QualityReason; detail?: string }[] = [];
  const stem = q.stem.trim();

  // STEM -- a real question, no trap negatives. A lower-case "not" or "except" is the commonest source of
  // ambiguity in generated MCQs. Upper-case NOT/EXCEPT is the conventional, deliberate marking.
  if (!stem.includes("?") || stem.length < 15) out.push({ reason: "not_a_question" });
  if (/\b(not|except|false|incorrect)\b/.test(stem) && !/\b(NOT|EXCEPT)\b/.test(stem)) out.push({ reason: "unmarked_negative" });
  if (stem.length > 900 || q.options.some(o => o.length > 220) || q.rationale.length > 700) out.push({ reason: "too_long" });

  // OPTIONS -- no catch-alls, and no option that contains another, either of which lets two options be right.
  if (q.options.some(o => /\b(all|none) of (the )?(above|these|the options)\b|^both\b|^[a-d] and [a-d]$/i.test(o.trim())))
    out.push({ reason: "banned_option" });
  const n = q.options.map(norm);
  if (n.some((a, i) => n.some((b, j) => i !== j && a.length > 0 && (` ${b} `).includes(` ${a} `))))
    out.push({ reason: "options_overlap" });

  // TERMINOLOGY -- every option, right or wrong, is built from the passage's own terms.
  const foreign = q.options.flatMap(o => unsupportedTerms(o, passage));
  if (foreign.length) out.push({ reason: "unsupported_term", detail: [...new Set(foreign)].slice(0, 6).join(", ") });

  // SOURCE SUPPORT -- the keyed answer's content is in the quoted source sentence itself.
  const missing = unsupportedTerms(q.options[q.correctIndex] ?? "", q.sourceQuote);
  if (missing.length) out.push({ reason: "correct_not_supported", detail: missing.join(", ") });

  return out;
}

// ── THE BLIND CHECK ─────────────────────────────────────────────────────────────────────────────────

export const VERIFY_SYSTEM = [
  "You check multiple-choice questions that were written from a short study passage. You are NOT told the intended answers.",
  "For each question, using ONLY the passage (not your own knowledge):",
  "- supported: the letters of EVERY option the passage supports as a correct answer (an empty list if none).",
  "- answerable: true only if the passage alone is enough to answer it.",
  "- stemAddsFacts: true if the question states a clinical fact, finding or number the passage does not contain.",
  "- ambiguous: true if a careful student could reasonably defend a different option, or the wording is unclear.",
  'Reply with JSON ONLY: [{"q": 1, "supported": ["B"], "answerable": true, "stemAddsFacts": false, "ambiguous": false}]',
].join("\n");

export function verificationPrompt(passage: string, drafts: DraftQuestion[]): string {
  const qs = drafts.map((d, i) =>
    `${i + 1}. ${d.stem}\n${d.options.map((o, j) => `   ${"ABCD"[j]}. ${o}`).join("\n")}`);
  return `PASSAGE:\n${passage}\n\nQUESTIONS:\n${qs.join("\n\n")}`;
}

export type VerificationOutcome = { kept: DraftQuestion[]; rejected: { index: number; detail: string }[] };

// ── THE SAME BLIND CHECK FOR REVISION ITEMS ── SCHOLAR-QUESTION-INTELLIGENCE-01 ─────────────────────────────────
//
// The multiple-choice check above, for the two revision kinds it fits: choose-all-that-apply (the passage must
// support EXACTLY the keyed set) and short answer (no options: the passage alone must answer it, unambiguously, with
// nothing added in the stem). Same call shape, same activity ("questions"), same fail-closed reading. Flashcards,
// matching and ordering items have nothing a blind reader adds to their deterministic checks, so they get none.

export const REVISION_VERIFY_SYSTEM = [
  "You check revision questions that were written from a short study passage. You are NOT told the intended answers.",
  "For each question, using ONLY the passage (not your own knowledge):",
  "- supported: for a question with lettered options, the letters of EVERY option the passage supports as correct (an empty list if none); for a question with no options, [].",
  "- answerable: true only if the passage alone is enough to answer it.",
  "- stemAddsFacts: true if the question states a clinical fact, finding or number the passage does not contain.",
  "- ambiguous: true if a careful student could reasonably defend a different answer, or the wording is unclear.",
  'Reply with JSON ONLY: [{"q": 1, "supported": ["A", "C"], "answerable": true, "stemAddsFacts": false, "ambiguous": false}]',
].join("\n");

const LETTERS = "ABCDEF";
export type RevisionVerifyItem = { stem: string; options: string[]; keyed: number[] | null };

export function revisionVerificationPrompt(passage: string, items: readonly RevisionVerifyItem[]): string {
  const qs = items.map((d, i) => `${i + 1}. ${d.stem}${d.options.length ? `\n${d.options.map((o, j) => `   ${LETTERS[j]}. ${o}`).join("\n")}` : " (short answer, no options)"}`);
  return `PASSAGE:\n${passage}\n\nQUESTIONS:\n${qs.join("\n\n")}`;
}

/** Pure. A blind verdict → the indexes of the items it supports. Fails closed, like applyVerification. */
export function applyRevisionVerification(items: readonly RevisionVerifyItem[], raw: string): { kept: number[]; rejected: { index: number; detail: string }[] } {
  const out = { kept: [] as number[], rejected: [] as { index: number; detail: string }[] };
  let parsed: unknown = null;
  try {
    const s = raw.replace(/```(?:json)?/gi, "");
    const a = s.indexOf("["), b = s.lastIndexOf("]");
    parsed = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null;
  } catch { parsed = null; }
  const verdicts = Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
  items.forEach((d, i) => {
    const v = verdicts.find(x => Number(x?.q) === i + 1);
    if (!v) { out.rejected.push({ index: i, detail: "no verdict" }); return; }
    const supported = Array.isArray(v.supported)
      ? [...new Set((v.supported as unknown[]).map(x => LETTERS.indexOf(String(x).trim().toUpperCase().charAt(0))).filter(x => x >= 0 && x < d.options.length))].sort()
      : [];
    const keyed = [...new Set(d.keyed ?? [])].sort();
    const problems = [
      v.answerable !== true && "not answerable from the passage",
      v.stemAddsFacts !== false && "the stem adds outside facts",
      v.ambiguous !== false && "ambiguous",
      d.options.length > 0 && (supported.length !== keyed.length || supported.some((x, k) => x !== keyed[k])) && `supported ${supported.map(x => LETTERS[x]).join("") || "none"}, keyed ${keyed.map(x => LETTERS[x]).join("")}`,
    ].filter(Boolean) as string[];
    if (problems.length) out.rejected.push({ index: i, detail: problems.join("; ") });
    else out.kept.push(i);
  });
  return out;
}

/** Pure. A blind verdict → the drafts it supports. Fails closed: no readable verdict for a draft rejects it. */
export function applyVerification(drafts: DraftQuestion[], raw: string): VerificationOutcome {
  const out: VerificationOutcome = { kept: [], rejected: [] };
  let parsed: unknown = null;
  try {
    const s = raw.replace(/```(?:json)?/gi, "");
    const a = s.indexOf("["), b = s.lastIndexOf("]");
    parsed = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null;
  } catch { parsed = null; }
  const verdicts = Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
  drafts.forEach((d, i) => {
    const v = verdicts.find(x => Number(x?.q) === i + 1);
    if (!v) { out.rejected.push({ index: i, detail: "no verdict" }); return; }
    const supported = Array.isArray(v.supported)
      ? [...new Set((v.supported as unknown[]).map(x => "ABCD".indexOf(String(x).trim().toUpperCase().charAt(0))).filter(x => x >= 0))]
      : [];
    const problems = [
      v.answerable !== true && "not answerable from the passage",
      v.stemAddsFacts !== false && "the stem adds outside facts",
      v.ambiguous !== false && "ambiguous",
      !(supported.length === 1 && supported[0] === d.correctIndex) && `supported ${supported.map(x => "ABCD"[x]).join("") || "none"}, keyed ${"ABCD"[d.correctIndex]}`,
    ].filter(Boolean) as string[];
    if (problems.length) out.rejected.push({ index: i, detail: problems.join("; ") });
    else out.kept.push(d);
  });
  return out;
}
