// ── SCHOLAR-COMPANION-01 P1: CLOZE RECALL, DETERMINISTIC ── no AI, no model, no second engine ──────────────────────
//
// A cloze item is a sentence from the learner's OWN notes with one key term blanked. It is stored as the existing
// `short` kind (migrations 416/710 CHECKs: options [], correct_index null, answer.accepted of 1 to 8 strings) with
// answer.format = 'cloze', model and provider 'rule', prompt_version 'cloze:v1' and source_quote = the original
// sentence, so its provenance is honest: a rule wrote it, not a model, and it quotes the notes exactly. It is private
// formative like every revision question, marked by code against a normalised match, scheduled by the shared SM-2.
//
// Pure: no I/O, no clock, no model. Every rule here is tested by being run. The store writes the rows.
// ⚠ A cloze item is never a clinically approved question and never published to the shared library.

import type { RevisionDraft } from "./revision";

export const CLOZE_BLANK = "_____";
export const CLOZE_MODEL = "rule";
export const CLOZE_PROVIDER = "rule";
export const CLOZE_PROMPT_VERSION = "cloze:v1";
/** The answer text stored when the learner chose to see the answer instead of typing one: a miss, honestly labelled. */
export const CLOZE_REVEALED_TEXT = "(answer revealed)";
export const CLOZE_LABEL = "Fill in the blank, written by a rule from a sentence in your notes (no AI). Marked by code.";

const ACCEPTED_MAX = 8;
const SENTENCE_MIN = 40;
const SENTENCE_MAX = 280;
const WORDS_MIN = 7;
const TERM_MIN = 3;
const TERM_MAX = 40;
const TERM_WORDS_MAX = 4;

/** Pure. Whether a stored question is a cloze item (a short answer whose key says so). */
export const isClozeQuestion = (q: { kind: string; answer: unknown }): boolean =>
  q.kind === "short" && !!q.answer && typeof q.answer === "object" && (q.answer as Record<string, unknown>).format === "cloze";

const ARTICLES = new Set(["a", "an", "the"]);

/** Pure. One word reduced to its singular-ish stem, the same way on both sides of a comparison. */
function stemWord(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(sses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Pure. Case, accents, hyphens, punctuation, a leading article and a plural all ignored. */
export function clozeNorm(s: string): string {
  const words = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.map(stemWord).join(" ");
}

/** Pure. A cloze answer marked by code: true on a normalised match with any accepted variant. */
export function markCloze(answer: string, accepted: readonly string[]): boolean {
  const a = clozeNorm(answer);
  return !!a && accepted.some(x => clozeNorm(x) === a);
}

/** Pure. The term and its plain variants (plural or singular, hyphen and space forms), at most the 416 limit of eight. */
export function clozeVariants(term: string): string[] {
  const t = term.trim();
  const out = [t];
  const add = (v: string) => { if (v && !out.some(x => x.toLowerCase() === v.toLowerCase())) out.push(v); };
  if (t.includes("-")) add(t.replace(/-/g, " "));
  else if (t.split(/\s+/).length === 2) add(t.replace(/\s+/g, "-"));
  const last = t.split(/[\s-]+/).pop() ?? "";
  if (last.length > 2) {
    const plural = /[^aeiou]y$/i.test(last) ? `${t.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/i.test(last) ? `${t}es` : `${t}s`;
    add(plural);
    const single = /ies$/i.test(last) ? `${t.slice(0, -3)}y` : /(sses|xes|zes|ches|shes)$/i.test(last) ? t.slice(0, -2) : /[^s]s$/i.test(last) ? t.slice(0, -1) : "";
    add(single);
  }
  return out.slice(0, ACCEPTED_MAX);
}

/** Pure. A text split into sentences (a line break also ends one), whitespace collapsed. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n+/)) {
    const flat = line.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    for (const s of flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

const STOP_START = new Set(["the", "a", "an", "this", "that", "these", "those", "it", "its", "in", "on", "at", "for", "with", "if", "when", "while", "as", "by", "to", "of", "and", "or", "but", "there", "they", "we", "you", "he", "she", "some", "each", "all", "any", "most", "many", "such", "after", "before", "during", "however", "also", "then", "thus", "so"]);
const NOT_TERMS = new Set(["and", "the", "for", "with", "not", "are", "was", "has", "may", "can", "all", "but", "who", "its", "see", "per"]);

/**
 * Pure. Candidate key terms found in the text itself when no better source exists: acronyms (MRSA, ECG) and capitalised
 * multi-word names (Glasgow Coma Scale) that do not just start with a common word. Most frequent first, then longest.
 */
export function termsInText(text: string): string[] {
  const count = new Map<string, number>();
  const bump = (t: string) => { const k = t.trim(); if (k.length >= TERM_MIN && k.length <= TERM_MAX) count.set(k, (count.get(k) ?? 0) + 1); };
  for (const s of splitSentences(text)) {
    for (const m of s.matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)) bump(m[0]);
    for (const m of s.matchAll(/\b[A-Z][a-z]+(?:\s+(?:of|and|for)\s+|\s+)[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g)) {
      if (STOP_START.has(m[0].split(/\s+/)[0].toLowerCase())) continue;
      bump(m[0]);
    }
  }
  return [...count].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** Pure. A term worth blanking: a few words, not a stop word, not all digits. */
function usableTerm(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim().replace(/^[("'[]+|[)"'\].,;:]+$/g, "");
  if (t.length < TERM_MIN || t.length > TERM_MAX || t.split(" ").length > TERM_WORDS_MAX) return null;
  if (!/[A-Za-z]/.test(t) || NOT_TERMS.has(t.toLowerCase())) return null;
  return t;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole-word, case-insensitive match of the term (letters and digits on either side break it). */
const wholeWord = (term: string, flags = "giu") => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, flags);

export type ClozeItem = { stem: string; term: string; accepted: string[]; sentence: string };

/**
 * Pure. Cloze items from some notes text: a sentence that holds a key term, with every occurrence of that term blanked.
 * `terms` are tried in the given order (the section's analysed topics first), then the terms found in the text itself.
 * One item per sentence and per term, none whose stem is in `existing` (clozeNorm of a stored stem), at most `max`.
 * `reject` lets a caller refuse a sentence (the patient-identifier screen). Deterministic: the same input, the same items.
 */
export function pickClozeItems(input: { text: string; terms: readonly string[]; max: number; existing?: ReadonlySet<string>; reject?: (sentence: string) => boolean }): ClozeItem[] {
  const sentences = splitSentences(input.text).filter(s => {
    if (s.length < SENTENCE_MIN || s.length > SENTENCE_MAX || s.endsWith("?")) return false;
    if (s.split(" ").length < WORDS_MIN) return false;
    if ((s.match(/\d/g) ?? []).length > s.length * 0.2) return false;
    return !input.reject?.(s);
  });
  const ordered: string[] = [];
  for (const raw of [...input.terms, ...termsInText(input.text)]) {
    const t = usableTerm(raw);
    if (t && !ordered.some(x => x.toLowerCase() === t.toLowerCase())) ordered.push(t);
  }
  const usedSentence = new Set<string>();
  const seen = new Set(input.existing ?? []);
  const out: ClozeItem[] = [];
  for (const term of ordered) {
    if (out.length >= input.max) break;
    const sentence = sentences.find(s => {
      if (usedSentence.has(s)) return false;
      const hits = s.match(wholeWord(term));
      return !!hits && hits.length <= 2;
    });
    if (!sentence) continue;
    const stem = sentence.replace(wholeWord(term), CLOZE_BLANK);
    const key = clozeNorm(stem);
    // A blank that leaves nothing to recall from (the sentence is little more than the term) is not an item.
    if (seen.has(key) || stem.split(CLOZE_BLANK).join(" ").split(/\s+/).filter(w => /[A-Za-z]/.test(w)).length < 5) continue;
    seen.add(key); usedSentence.add(sentence);
    // The term as the notes write it, then its plain variants.
    const written = sentence.match(wholeWord(term, "iu"))?.[0] ?? term;
    out.push({ stem, term: written, accepted: clozeVariants(written), sentence });
  }
  return out;
}

/** Pure. The draft the store writes (insertRevisionQuestions, kind short): the sentence is both the quote and the explanation. */
export function clozeDraft(item: ClozeItem): RevisionDraft {
  return {
    stem: item.stem, options: [], answer: { accepted: item.accepted, format: "cloze" },
    rationale: `Your notes say: ${item.sentence}`, sourceQuote: item.sentence, difficulty: 2,
  };
}

/** Pure. Terms a section's existing questions already treat as answers (short answers and short card backs), as cloze candidates. */
export function termsFromQuestions(qs: readonly { kind: string; answer: unknown }[]): string[] {
  const out: string[] = [];
  for (const q of qs) {
    if (isClozeQuestion(q)) continue;
    const a = (q.answer ?? {}) as Record<string, unknown>;
    const cands = q.kind === "short" && Array.isArray(a.accepted) ? (a.accepted as unknown[]).slice(0, 1) : q.kind === "flashcard" && typeof a.back === "string" ? [a.back] : [];
    for (const c of cands) if (typeof c === "string") { const t = usableTerm(c); if (t && t.split(" ").length <= 3) out.push(t); }
  }
  return out;
}
