// ── SCHOLAR-SQIE-LEARNER-01: THE BLIND SOLVE FOR THE OTHER REVISION FORMATS ── pure: prompt and reading, no model ──────────
//
// The multiple-choice check (question-quality.ts) gives a second reader the passage and the question WITHOUT the key and
// compares what it supports with the key. This is the same pattern for the formats that had no such check, switched on per
// format by policy scholar_verify_formats (the default is the behaviour from before: mcq, case, mrq, short):
//
//   true_false  the reader says whether the passage makes the statement true, false or does not say.       Compared with the key.
//   match       the reader pairs each item with a choice (shuffled, so the order gives nothing away).      Compared with the key.
//   sequence    the reader puts the (shuffled) steps in order.                                              Compared with the key.
//   flashcard   the reader answers the front.                                       Compared with the back by shared content words.
//   structured  the reader answers each part.                          Each compared with what the part accepts, by shared content words.
//   extended    the reader says whether the passage alone answers it, unambiguously.  (There is no single key to compare.)
//
// Every kind also gets the three questions of the existing check: answerable from the passage alone, no outside facts in the
// stem, not ambiguous. Fails closed, like the existing check: no readable verdict for an item rejects it. An item that
// fails is dropped with the existing outcome reasons (generation.ts: failed_verification, verification_unavailable).
//
// ⚠ CONSERVATIVE ON PURPOSE. A rejected good item costs the learner a click; an accepted wrong key teaches them something
// their notes do not say.

import { stemKey } from "./question-intel";
import { seededOrder, type RevisionDraft } from "./revision";

export type BlindFormat = "true_false" | "match" | "sequence" | "flashcard" | "structured" | "extended";
export const BLIND_FORMATS: readonly BlindFormat[] = ["true_false", "match", "sequence", "flashcard", "structured", "extended"];
export const isBlindFormat = (k: string): k is BlindFormat => (BLIND_FORMATS as readonly string[]).includes(k);

const LETTERS = "ABCDEF";

export type BlindItem =
  | { kind: "true_false"; stem: string; truth: boolean }
  | { kind: "match"; stem: string; prompts: string[]; choices: string[]; keyed: number[] }
  | { kind: "sequence"; stem: string; steps: string[]; keyed: number[] }
  | { kind: "flashcard"; stem: string; back: string }
  | { kind: "structured"; stem: string; parts: { prompt: string; accepted: string[] }[] }
  | { kind: "extended"; stem: string };

/** Pure. One checked draft as the blind reader is shown it (the key stays here, for the comparison). */
export function blindItemOf(kind: BlindFormat, d: RevisionDraft): BlindItem {
  const a = d.answer as Record<string, unknown>;
  switch (kind) {
    case "true_false": return { kind, stem: d.stem, truth: (a.accepted as string[] | undefined)?.[0] === "true" };
    case "match": {
      const right = (a.matches as string[]) ?? [];
      const choices = seededOrder(right.length, `${d.stem}:blind`).map(i => right[i]);
      return { kind, stem: d.stem, prompts: d.options, choices, keyed: right.map(r => choices.indexOf(r)) };
    }
    case "sequence": return { kind, stem: d.stem, steps: d.options, keyed: (a.order as number[]) ?? [] };
    case "flashcard": return { kind, stem: d.stem, back: String(a.back ?? "") };
    case "structured": return { kind, stem: d.stem, parts: ((a.parts as { prompt: string; accepted: string[] }[]) ?? []).map(p => ({ prompt: p.prompt, accepted: p.accepted })) };
    case "extended": return { kind, stem: d.stem };
  }
}

export const BLIND_SOLVE_SYSTEM = [
  "You check revision items that were written from a short study passage. You are NOT told the intended answers.",
  "For each item, using ONLY the passage (not your own knowledge), give:",
  "- answerable: true only if the passage alone is enough to answer it.",
  "- stemAddsFacts: true if the item states a clinical fact, finding or number the passage does not contain.",
  "- ambiguous: true if a careful student could reasonably defend a different answer, or the wording is unclear.",
  "and the field that fits the item's type:",
  '- a TRUE OR FALSE statement: "truth": "true" if the passage makes the statement true, "false" if the passage makes it false, "not_stated" if the passage does not settle it.',
  '- MATCHING (items and lettered choices): "matches": the letter of the choice for item 1, item 2 ... in order.',
  '- SEQUENCING (lettered steps in a shuffled order): "order": the letters of the steps in the order the passage gives them.',
  '- a FLASHCARD or a SHORT QUESTION: "answer": the answer in a few words from the passage.',
  '- a MULTI-PART question: "answers": one short answer per part, in order.',
  '- an EXTENDED RESPONSE question: nothing more than the three checks above.',
  'Reply with JSON ONLY: [{"q": 1, "answerable": true, "stemAddsFacts": false, "ambiguous": false, "truth": "true"}]',
].join("\n");

/** Pure. The passage and the items, lettered where the type has choices or steps. */
export function blindSolvePrompt(passage: string, items: readonly BlindItem[]): string {
  const qs = items.map((it, i) => {
    const n = i + 1;
    switch (it.kind) {
      case "true_false": return `${n}. TRUE OR FALSE: ${it.stem}`;
      case "match": return `${n}. MATCHING: ${it.stem}\n   Items:\n${it.prompts.map((p, j) => `   ${j + 1}. ${p}`).join("\n")}\n   Choices:\n${it.choices.map((c, j) => `   ${LETTERS[j]}. ${c}`).join("\n")}`;
      case "sequence": return `${n}. SEQUENCING: ${it.stem}\n${it.steps.map((s, j) => `   ${LETTERS[j]}. ${s}`).join("\n")}`;
      case "flashcard": return `${n}. FLASHCARD: ${it.stem}`;
      case "structured": return `${n}. MULTI-PART: ${it.stem}\n${it.parts.map((p, j) => `   (${String.fromCharCode(97 + j)}) ${p.prompt}`).join("\n")}`;
      case "extended": return `${n}. EXTENDED RESPONSE: ${it.stem}`;
    }
  });
  return `PASSAGE:\n${passage}\n\nITEMS:\n${qs.join("\n\n")}`;
}

// ── COMPARING AN ANSWER IN WORDS WITH THE KEY ──

const head = (w: string) => w.slice(0, 5);
const contentTokens = (s: string): string[] => stemKey(s).split(" ").filter(w => w.length >= 3).map(head);

/**
 * Pure. Whether a reader's answer says what a key says: at least half of the key's content words (compared by their first five
 * letters, so "infections" meets "infection") are in the answer. Several keys: any one. An empty answer never agrees.
 */
export function answerAgrees(solved: unknown, keys: string | readonly string[]): boolean {
  if (typeof solved !== "string" || !solved.trim()) return false;
  const have = new Set(contentTokens(solved));
  return (typeof keys === "string" ? [keys] : keys).some(k => {
    const want = [...new Set(contentTokens(k))];
    if (!want.length) return stemKey(k) === stemKey(solved);
    return want.filter(w => have.has(w)).length / want.length >= 0.5;
  });
}

const lettersOf = (v: unknown, max: number): number[] | null =>
  Array.isArray(v) ? v.map(x => LETTERS.indexOf(String(x).trim().toUpperCase().charAt(0))).map(i => (i >= 0 && i < max ? i : -1)) : null;

/**
 * Pure. A blind reader's verdicts → the indexes of the items it supports and why the others were refused. Fails closed:
 * no readable verdict, or an answer that disagrees with the key, rejects the item.
 */
export function applyBlindVerification(items: readonly BlindItem[], raw: string): { kept: number[]; rejected: { index: number; detail: string }[] } {
  const out = { kept: [] as number[], rejected: [] as { index: number; detail: string }[] };
  let parsed: unknown = null;
  try {
    const s = raw.replace(/```(?:json)?/gi, "");
    const a = s.indexOf("["), b = s.lastIndexOf("]");
    parsed = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null;
  } catch { parsed = null; }
  const verdicts = Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
  items.forEach((it, i) => {
    const v = verdicts.find(x => Number(x?.q) === i + 1);
    if (!v) { out.rejected.push({ index: i, detail: "no verdict" }); return; }
    const problems: (string | false)[] = [
      v.answerable !== true && "not answerable from the passage",
      v.stemAddsFacts !== false && "the item adds outside facts",
      v.ambiguous !== false && "ambiguous",
    ];
    if (it.kind === "true_false") {
      const t = typeof v.truth === "string" ? v.truth.trim().toLowerCase() : "";
      problems.push(t !== (it.truth ? "true" : "false") && `solved ${t || "nothing"}, keyed ${it.truth ? "true" : "false"}`);
    } else if (it.kind === "match") {
      const got = lettersOf(v.matches, it.choices.length);
      problems.push((!got || got.length !== it.keyed.length || got.some((g, k) => g !== it.keyed[k])) && "the pairs solved differ from the key");
    } else if (it.kind === "sequence") {
      const got = lettersOf(v.order, it.steps.length);
      problems.push((!got || got.length !== it.keyed.length || got.some((g, k) => g !== it.keyed[k])) && "the order solved differs from the key");
    } else if (it.kind === "flashcard") {
      problems.push(!answerAgrees(v.answer, it.back) && "the answer solved differs from the back");
    } else if (it.kind === "structured") {
      const ans = Array.isArray(v.answers) ? v.answers : null;
      problems.push((!ans || ans.length !== it.parts.length || it.parts.some((p, k) => !answerAgrees(ans[k], p.accepted))) && "a part solved differs from what it accepts");
    }
    const bad = problems.filter(Boolean) as string[];
    if (bad.length) out.rejected.push({ index: i, detail: bad.join("; ") });
    else out.kept.push(i);
  });
  return out;
}
