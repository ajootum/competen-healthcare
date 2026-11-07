import { ESTABLISHED_TERMS, EVERYDAY_WORDS, MEDICAL_ENDINGS, MEDICAL_ENDING_MIN, SUBJECT_WORDS } from "@/lib/holdings/research/subject-terms";
import { SUBJECT_PHRASES } from "@/lib/holdings/research/subject-phrases";
import { EQUIVALENTS, FUNCTION_WORDS, KNOWN_PHRASES, buildResearchQuery, canonWord, wordsOf, type LessonContext } from "./research-relevance";

// ── SUBJECT-TERM QUERY ── Research Search Privacy Alignment (owner, 6 Nov 2026) ──────────────────────────────────────────
//
// What a Research & Explain search may send. A lesson's title, objective and topics come from the learner's own upload, so
// they can hold a person's name, a place, a course code or a date. A name cannot be reliably spotted (lowercase, unfamiliar
// or spelled any way), so this does not try. It works the other way round: every word is looked up in a closed vocabulary
// (holdings/research/subject-terms.ts, subject-phrases.ts), and a word not found is removed BEFORE the existing query builder
// reads the text. The builder, its phrases and its order are unchanged. Established terms that hold a name pass only whole
// ("wilson disease"), so the disease is kept and "Mr Wilson" is not. Pure. No model, no network.

/** One form for plurals, for lookups only. */
const singular = (w: string) => (w.length > 3 && /ies$/.test(w) ? `${w.slice(0, -3)}y` : w.length > 3 && /s$/.test(w) && !/(?:ss|us|is)$/.test(w) ? w.slice(0, -1) : w);
/** The vocabulary is written in British spelling. A lesson may use either, and the builder rewrites some to American. */
const spellings = (w: string): string[] => {
  const out = new Set([w, canonWord(w)]);
  for (const x of [...out]) {
    out.add(x.replace(/ae/g, "e").replace(/oe/g, "e"));
    out.add(x.replace(/isation$/, "ization").replace(/ise$/, "ize").replace(/ising$/, "izing"));
    out.add(x.replace(/our$/, "or").replace(/oural$/, "oral"));
    out.add(x.replace(/tre$/, "ter").replace(/ogue$/, "og"));
    out.add(x.replace(/lling$/, "ling"));
  }
  for (const x of [...out]) out.add(canonWord(x));
  return [...out];
};
const WORD_SET: ReadonlySet<string> = new Set(SUBJECT_WORDS.flatMap(spellings).flatMap(w => [w, singular(w)]));

const EVERYDAY_SET: ReadonlySet<string> = new Set(EVERYDAY_WORDS.flatMap(spellings).flatMap(w => [w, singular(w)]));

const contentOf = (phrase: string) => wordsOf(phrase).filter(w => !FUNCTION_WORDS.has(w));
/** Whole terms, as their content words. A term may hold a word that would not pass alone. */
const TERMS: readonly string[][] = [...SUBJECT_PHRASES, ...KNOWN_PHRASES, ...ESTABLISHED_TERMS, ...EQUIVALENTS.flat()].flatMap(p => {
  // A phrase that function words leave as one word ("family planning") is not that word's permission to leave alone.
  const t = contentOf(p);
  return t.length > 1 || (t.length === 1 && !/[\s-]/.test(p)) ? [t] : [];
});
const BY_FIRST = new Map<string, string[][]>();
for (const t of TERMS) { const k = singular(t[0]); BY_FIRST.set(k, [...(BY_FIRST.get(k) ?? []), t]); }

/** Pure. A word that may leave on its own: in the vocabulary, or a long word with a medical ending. */
export function isSubjectWord(raw: string): boolean {
  const w = canonWord(raw.toLowerCase());
  return WORD_SET.has(w) || WORD_SET.has(singular(w)) || (w.length >= MEDICAL_ENDING_MIN && MEDICAL_ENDINGS.test(w));
}

/** A word after one of these is a person, whatever else it may mean. "Ms" counts only as written, since MS is also a disease. */
const TITLE = /^(?:mr|mrs|miss|mister|madam|dr|prof|professor|sir|mx)$/;
const isTitle = (raw: string) => raw === "Ms" || TITLE.test(raw.toLowerCase());

/**
 * Pure. The text with every word that may not leave replaced by a break, so no phrase can form across it. Function words stay
 * (the builder needs them to read "quality of care", and never sends one by itself).
 */
export function subjectText(text: string | null | undefined): string {
  const plain = (text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’`]s\b/gi, "").replace(/s['’`](?=\s|$)/gi, "s");
  const parts = plain.split(/([A-Za-z0-9]+)/);
  const at: number[] = [];
  for (let i = 1; i < parts.length; i += 2) at.push(i);
  const norm = at.map(i => wordsOf(parts[i])[0] ?? "");
  const named = at.map((_, n) => n > 0 && isTitle(parts[at[n - 1]]));
  const keep = at.map(() => false);
  const content = norm.flatMap((w, n) => (w && !FUNCTION_WORDS.has(w) ? [n] : []));
  for (let c = 0; c < content.length; c++) {
    for (const term of BY_FIRST.get(singular(norm[content[c]])) ?? []) {
      if (c + term.length > content.length) continue;
      const span = content.slice(c, c + term.length);
      if (term.every((w, k) => singular(norm[span[k]]) === singular(w)) && !span.some(n => named[n])) for (const n of span) keep[n] = true;
    }
  }
  const pass = at.map((p, n) => !named[n] && !isTitle(parts[p]) && !!norm[n] && !FUNCTION_WORDS.has(norm[n]) && (keep[n] || isSubjectWord(norm[n])));
  // An everyday word stays only if it touches a subject word: a space or hyphen between them, nothing else.
  const touches = (n: number, m: number) => m >= 0 && m < at.length && pass[m] && /^[\s-]+$/.test(parts[at[Math.min(n, m)] + 1]);
  const everyday = (n: number) => !named[n] && !isTitle(parts[at[n]]) && (EVERYDAY_SET.has(norm[n]) || EVERYDAY_SET.has(singular(norm[n])));
  for (let n = 0; n < at.length; n++) if (!pass[n] && everyday(n) && touches(n, n - 1)) pass[n] = true;
  for (let n = at.length - 1; n >= 0; n--) if (!pass[n] && everyday(n) && touches(n, n + 1)) pass[n] = true;
  at.forEach((p, n) => { if (!pass[n] && !(norm[n] && FUNCTION_WORDS.has(norm[n]) && !named[n] && !isTitle(parts[p]))) parts[p] = ","; });
  return parts.join("").replace(/\s+/g, " ").trim();
}

const PARTS = /"[^"]*"|[^\s"]+/g;
/** Pure. One part of a query may leave: everything in it survives subjectText, and it says something beyond function words. */
const safePart = (part: string): boolean => {
  const body = part.replace(/"/g, "");
  return /^[a-z0-9 -]+$/.test(body) && !subjectText(body).includes(",") && contentOf(body).length > 0;
};
/**
 * Pure. The last check before anything leaves: every part of a query, as actually built, passes the same reading the lesson
 * text did. So a later change to the builder cannot open a way out without this saying no.
 */
export function isSubjectQuery(query: string): boolean {
  const parts = query.match(PARTS) ?? [];
  return parts.length > 0 && parts.every(safePart);
}

/** Pure. A lesson's query in subject terms only, or "" when none can be built. */
export function subjectQuery(ctx: LessonContext): string {
  const clean: LessonContext = {
    title: subjectText(ctx.title), objective: subjectText(ctx.objective), concepts: (ctx.concepts ?? []).map(subjectText), topics: (ctx.topics ?? []).map(subjectText), question: subjectText(ctx.question),
  };
  // A word that passed only inside a whole term ("structural measures") can come back from the builder alone: that part goes.
  return (buildResearchQuery(clean).match(PARTS) ?? []).filter(safePart).join(" ");
}

/** Pure. Subject words of a sentence, unquoted. For a path that searches keywords rather than a lesson's phrases. */
export function subjectKeywords(text: string | null | undefined, max = 8): string {
  return [...new Set(wordsOf(subjectText(text)).filter(w => !FUNCTION_WORDS.has(w) && safePart(w)))].slice(0, max).join(" ");
}
