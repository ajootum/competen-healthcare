// SCHOLAR-LEARN-FIX-01 L-B: THE STRUCTURED TEACH ME ANSWER, and how a Learn reply is shown. Pure and client-safe:
// no server imports, so the Learn workspace reads the same parser the engine (generation.ts checkTeachAnswer) writes with.
//
// A Teach Me answer (PROMPT_VERSIONS.learnTeach) is written in labelled parts, each line starting with its label:
//   OVERVIEW:                   what the lesson is about and why it matters, cited
//   UNDERSTANDING:              SCHOLAR-CUMULATIVE-TEACHING-01 (v3): the teaching itself -- connected paragraphs that develop
//                               the concepts, mechanisms, relationships and applications, cited; paragraphs are kept apart
//                               by a blank line. A Go deeper answer (v2) is written in the same parts, so it is shown and
//                               checked the same way. Absent on a v1/v2 lesson (points only).
//   KEY POINTS:                 one '- ' line per key idea, each cited
//   EXAMPLE:                    only where the passages describe a situation; checked on its own and DROPPED if unsupported
//   CHECK YOUR UNDERSTANDING:   one or two questions, each ending with the [S n] that answers it; each checked, or dropped
// The engine re-writes what it shows in exactly this form (composeTeachAnswer), so a saved artefact and a new reply read
// the same. An answer saved before the structure (older prompt version) has none of the labels: parseTeachAnswer returns
// null and the answer is shown as it was written.

export type TeachParts = { overview: string; /** v3 (SCHOLAR-CUMULATIVE-TEACHING-01): the teaching paragraphs; absent on a v1/v2 lesson. */ understanding?: string[];
  /** SCHOLAR-RESEARCH-TEACH-001: where published evidence refines a statement in the notes. Each line says both, with both citations. The notes are never rewritten. */
  distinctions?: string[]; points: string[]; example: string | null; questions: string[] };

export const TEACH_LABEL = { overview: "OVERVIEW:", understanding: "UNDERSTANDING:", distinctions: "NOTES AND EVIDENCE:", points: "KEY POINTS:", example: "EXAMPLE:", check: "CHECK YOUR UNDERSTANDING:" } as const;
/** At most this many understanding-check questions are kept from one Teach Me answer. */
export const TEACH_MAX_QUESTIONS = 2;

type Part = keyof typeof TEACH_LABEL;
// A label at the start of a line, tolerating the markdown a model adds anyway (**, #, >, -) and any case.
const LABEL_RE: Record<Part, RegExp> = {
  overview: /^[\s*_#>-]*overview\s*:[\s*_]*/i,
  understanding: /^[\s*_#>-]*understanding\s*:[\s*_]*/i,
  distinctions: /^[\s*_#>-]*notes\s+and\s+evidence\s*:[\s*_]*/i,
  points: /^[\s*_#>-]*key\s+points\s*:[\s*_]*/i,
  example: /^[\s*_#>-]*example\s*:[\s*_]*/i,
  check: /^[\s*_#>-]*check\s+your\s+understanding\s*:[\s*_]*/i,
};
const PARTS = Object.keys(LABEL_RE) as Part[];
const bullet = (l: string) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
const isBullet = (l: string) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l);

/** Pure. The labelled parts of a Teach Me answer, or null when it carries no OVERVIEW or KEY POINTS label (an older answer). */
export function parseTeachAnswer(text: string): TeachParts | null {
  const buckets: Record<Part, string[]> = { overview: [], understanding: [], distinctions: [], points: [], example: [], check: [] };
  let at: Part | null = null, pre: string[] = [], seen = false;
  for (const line of text.split("\n")) {
    const hit = PARTS.find(p => LABEL_RE[p].test(line));
    if (hit) { at = hit; seen = seen || hit === "overview" || hit === "points"; const rest = line.replace(LABEL_RE[hit], "").trim(); if (rest) buckets[hit].push(rest); continue; }
    if (at) buckets[at].push(line); else pre.push(line);
  }
  if (!seen) return null;
  pre = pre.filter(l => l.trim());
  const overview = [...pre, ...buckets.overview].map(l => l.trim()).filter(Boolean).join(" ");
  // A key point is a bullet; a line that is not one carries the point before it on (a wrapped line).
  const points: string[] = [];
  for (const l of buckets.points) {
    if (!l.trim()) continue;
    if (isBullet(l) || !points.length) points.push(bullet(l)); else points[points.length - 1] = `${points[points.length - 1]} ${l.trim()}`;
  }
  const example = buckets.example.map(l => l.trim()).filter(Boolean).join(" ") || null;
  const questions = buckets.check.map(bullet).filter(Boolean);
  const distinctions = buckets.distinctions.filter(l => l.trim()).map(bullet).filter(Boolean);
  return { overview, understanding: paragraphsOf(buckets.understanding), ...(distinctions.length ? { distinctions } : {}), points: points.filter(Boolean), example, questions };
}

/** Pure. Lines under UNDERSTANDING as paragraphs: a blank line (or a bullet) starts a new one; wrapped lines join the one before. */
function paragraphsOf(lines: readonly string[]): string[] {
  const out: string[] = [];
  let open = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { open = false; continue; }
    if (open && !isBullet(l)) out[out.length - 1] = `${out[out.length - 1]} ${l}`;
    else { out.push(isBullet(l) ? bullet(l) : l); open = !isBullet(l); }
  }
  return out.filter(Boolean);
}

/** Pure. The canonical text of a Teach Me answer: what is shown, saved and parsed back. Empty parts are left out. */
export function composeTeachAnswer(p: TeachParts): string {
  const out: string[] = [];
  if (p.overview.trim()) out.push(`${TEACH_LABEL.overview} ${p.overview.trim()}`);
  if (p.understanding?.length) out.push(`${TEACH_LABEL.understanding}\n${p.understanding.map(x => x.trim()).filter(Boolean).join("\n\n")}`);
  if (p.distinctions?.length) out.push(`${TEACH_LABEL.distinctions}\n${p.distinctions.map(x => `- ${x.trim()}`).join("\n")}`);
  if (p.points.length) out.push(`${TEACH_LABEL.points}\n${p.points.map(x => `- ${x.trim()}`).join("\n")}`);
  if (p.example?.trim()) out.push(`${TEACH_LABEL.example} ${p.example.trim()}`);
  if (p.questions.length) out.push(`${TEACH_LABEL.check}\n${p.questions.map(x => `- ${x.trim()}`).join("\n")}`);
  return out.join("\n\n");
}

// ── SCHOLAR-RESEARCH-TEACH-001: a lesson written from the notes, published evidence and Scholar's own explanation ──

/** Pure. Whether a saved lesson was written from the three sources, by its prompt version. */
export const isIntegratedVersion = (promptVersion: string | null | undefined) => (promptVersion ?? "").includes("+research-teach-");
/** What such a lesson is shown under. "From your notes" would be untrue. */
export const INTEGRATED_LABEL = "From your notes, published evidence and Scholar's own explanation";
export const INTEGRATED_KEY = "Each sentence says what it rests on: a slide or page of your notes, a published source (E), or Scholar's own explanation (AI).";
/** Every reference in a pack was read this way, and each says so. */
export const ABSTRACT_ONLY_NOTE = "Abstract reviewed, not the full text.";
/** Automated retrieval is not endorsement. */
export const NOT_ENDORSED_NOTE = "Found automatically. Not reviewed or endorsed by Competen, and not clinical guidance.";

/** Short forms whose full stop does not end a sentence. Masked while splitting. */
const ABBREV = /\b(e\.g|i\.e|et al|cf|vs|etc|dr|mr|mrs|ms|prof|fig|no)\./gi;
/** A genus written short ("E. coli", "S. aureus"): one capital and a stop before a lowercase word. */
const INITIAL = /\b([A-Z])\.(?=\s+[a-z])/g;
const MASK = "\u0001";
/** The source tags of a sentence, with the space before each. */
export const TAGS = /\s*\[(?:[SER]\d+|AI)\]/g;
const TAG_AFTER_STOP = /([.!?])((?:\s*\[(?:[SER]\d+|AI)\])+)/g;

/** Pure. Text as sentences, each tag moved inside its sentence: "It grows. [S1]" reads as "It grows [S1]." */
export function sentencesOf(text: string): string[] {
  const moved = text.replace(TAG_AFTER_STOP, (_m, stop: string, tags: string) => `${tags}${stop}`);
  const masked = moved.replace(ABBREV, m => m.replace(/\.$/, MASK)).replace(INITIAL, `$1${MASK}`);
  // A rule, a stray tag or a bullet with no words in it is not a sentence. Emphasis marks are not shown, so they do not stay in the text.
  return masked.split(/(?<=[.!?])\s+/).map(s => s.split(MASK).join(".").replace(/\*+|(?<!\w)_+|_+(?!\w)/g, "").trim()).filter(s => /[a-z]{2}/i.test(s.replace(TAGS, "")));
}

export type SentenceTags = { s: number[]; e: number[]; r: number[]; ai: boolean };
export const tagsOf = (sentence: string): SentenceTags => ({
  s: [...sentence.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1])), e: [...sentence.matchAll(/\[E(\d+)\]/g)].map(m => Number(m[1])),
  r: [...sentence.matchAll(/\[R(\d+)\]/g)].map(m => Number(m[1])), ai: sentence.includes("[AI]"),
});

/** Pure. Only what rests on the notes, line by line. Anything that re-reads saved teaching AS NOTES uses this, so research and Scholar's own words never come back cited as the notes. */
export function notesSentencesOnly(text: string): string {
  return text.split("\n").map(line => sentencesOf(line).filter(s => { const t = tagsOf(s); return t.s.length > 0 && !t.e.length; }).join(" ")).filter(Boolean).join("\n");
}

/** The passage numbers a piece of text cites ([S2] -> 2), in order, once each. */
export const citedTags = (text: string): number[] => [...new Set([...text.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1])))];

/** Pure. Text cut into plain runs and [S n] citations, so each citation can be shown as a link to its source. */
export function citationSegments(text: string): ({ text: string } | { tag: number } | { evidence: number } | { ai: true })[] {
  const out: ({ text: string } | { tag: number } | { evidence: number } | { ai: true })[] = [];
  let last = 0;
  // SCHOLAR-RESEARCH-TEACH-001: [E n] is a published record and [AI] is Scholar's own explanation. Only a lesson written from the three sources carries them.
  for (const m of text.matchAll(/\[(?:S(\d+)|E(\d+)|(AI))\]/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push(m[1] ? { tag: Number(m[1]) } : m[2] ? { evidence: Number(m[2]) } : { ai: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** A check question as the learner answers it: its citations taken off (they are shown as links beside it). */
export const questionText = (q: string) => q.replace(/\s*\[S\d+\]/g, "").replace(/\s+([?.!,])/g, "$1").trim();

// ── HOW A LEARN REPLY IS SHOWN: the grounding outcome (L-A, act route) as a UI state ──
//   teach     the explanation, nothing more to say about coverage
//   partial   the explanation of what the notes support, THEN "Not covered in your notes: ..." and, where policy offers
//             a wider tier, the offer to explore it. Never a "This isn't in your notes" banner above supported teaching.
//   recovery  nothing was shown (withheld): the existing explanation of why and the evidence recovery beneath it
//   continuity no new AI now: what is saved
export type LearnGrounding = { outcome: "sufficient" | "partial" | "insufficient"; keyTerms: string[]; covered: string[]; uncoveredTerms: string[]; wider: string | null };
export type ReplyState = "teach" | "partial" | "recovery" | "continuity" | "none";

/** Pure. Which of the states a reply is in. A reply from before L-A (no grounding) that was shown is plain teaching. */
export function replyState(r: { continuity?: unknown; withheld?: boolean; answer?: string; action?: string; grounding?: LearnGrounding | null }): ReplyState {
  if (r.continuity) return "continuity";
  if (r.withheld) return "recovery";
  if (!r.answer) return "none";
  // A check question and a clarification are about the learner's answer, not the lesson's coverage.
  if (r.action === "check" || r.action === "clarify") return "teach";
  const g = r.grounding;
  return g && g.outcome !== "sufficient" && g.uncoveredTerms.length > 0 ? "partial" : "teach";
}
