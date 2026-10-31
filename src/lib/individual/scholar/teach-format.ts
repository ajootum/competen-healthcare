// SCHOLAR-LEARN-FIX-01 L-B: THE STRUCTURED TEACH ME ANSWER, and how a Learn reply is shown. Pure and client-safe:
// no server imports, so the Learn workspace reads the same parser the engine (generation.ts checkTeachAnswer) writes with.
//
// A Teach Me answer (PROMPT_VERSIONS.learnTeach) is written in labelled parts, each line starting with its label:
//   OVERVIEW:                   what the lesson is about and why it matters, cited
//   KEY POINTS:                 one '- ' line per key idea, each cited
//   EXAMPLE:                    only where the passages describe a situation; checked on its own and DROPPED if unsupported
//   CHECK YOUR UNDERSTANDING:   one or two questions, each ending with the [S n] that answers it; each checked, or dropped
// The engine re-writes what it shows in exactly this form (composeTeachAnswer), so a saved artefact and a new reply read
// the same. An answer saved before the structure (older prompt version) has none of the labels: parseTeachAnswer returns
// null and the answer is shown as it was written.

export type TeachParts = { overview: string; points: string[]; example: string | null; questions: string[] };

export const TEACH_LABEL = { overview: "OVERVIEW:", points: "KEY POINTS:", example: "EXAMPLE:", check: "CHECK YOUR UNDERSTANDING:" } as const;
/** At most this many understanding-check questions are kept from one Teach Me answer. */
export const TEACH_MAX_QUESTIONS = 2;

type Part = keyof typeof TEACH_LABEL;
// A label at the start of a line, tolerating the markdown a model adds anyway (**, #, >, -) and any case.
const LABEL_RE: Record<Part, RegExp> = {
  overview: /^[\s*_#>-]*overview\s*:[\s*_]*/i,
  points: /^[\s*_#>-]*key\s+points\s*:[\s*_]*/i,
  example: /^[\s*_#>-]*example\s*:[\s*_]*/i,
  check: /^[\s*_#>-]*check\s+your\s+understanding\s*:[\s*_]*/i,
};
const PARTS = Object.keys(LABEL_RE) as Part[];
const bullet = (l: string) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
const isBullet = (l: string) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l);

/** Pure. The labelled parts of a Teach Me answer, or null when it carries no OVERVIEW or KEY POINTS label (an older answer). */
export function parseTeachAnswer(text: string): TeachParts | null {
  const buckets: Record<Part, string[]> = { overview: [], points: [], example: [], check: [] };
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
  return { overview, points: points.filter(Boolean), example, questions };
}

/** Pure. The canonical text of a Teach Me answer: what is shown, saved and parsed back. Empty parts are left out. */
export function composeTeachAnswer(p: TeachParts): string {
  const out: string[] = [];
  if (p.overview.trim()) out.push(`${TEACH_LABEL.overview} ${p.overview.trim()}`);
  if (p.points.length) out.push(`${TEACH_LABEL.points}\n${p.points.map(x => `- ${x.trim()}`).join("\n")}`);
  if (p.example?.trim()) out.push(`${TEACH_LABEL.example} ${p.example.trim()}`);
  if (p.questions.length) out.push(`${TEACH_LABEL.check}\n${p.questions.map(x => `- ${x.trim()}`).join("\n")}`);
  return out.join("\n\n");
}

/** The passage numbers a piece of text cites ([S2] -> 2), in order, once each. */
export const citedTags = (text: string): number[] => [...new Set([...text.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1])))];

/** Pure. Text cut into plain runs and [S n] citations, so each citation can be shown as a link to its source. */
export function citationSegments(text: string): ({ text: string } | { tag: number })[] {
  const out: ({ text: string } | { tag: number })[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[S(\d+)\]/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ tag: Number(m[1]) });
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
