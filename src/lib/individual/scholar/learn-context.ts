// SCHOLAR-CUMULATIVE-TEACHING-01 (owner GO, 3 Nov 2026): WHAT HAS BEEN TAUGHT SO FAR, as one concise block.
//
// Pure and client-safe (no server imports, no I/O): the Learn workspace and the act route read the same builder. The route
// builds it from the lesson's SAVED teaching (store.ts listArtefacts for the lesson's own sections: Teach me, Go deeper,
// Explain, Simplify, Examples, Summarise) and from the checks the learner answered THIS VISIT (sent by the page as
// `priorChecks`: the question, their answer, the verdict and the clarification's parts). It is given to the next teaching
// request under its own header (generation.ts learnUserPrompt), so Go deeper extends the lesson instead of regenerating it,
// Explain again clarifies the same ground, and Guide me / Challenge me / the checks know what was asked and answered.
//
// ⚠ NOT A MEMORY ENGINE. Nothing here is stored: it is rebuilt per request from records the engine already keeps (owner
// ruling D10, and spec section 4: "Do not create a parallel learner-memory engine"). What the learner TYPED is never
// stored by this feature either: it reaches the prompt only for the request it was sent with.
// ⚠ NOT GROUNDING. The block steers what is taught next; the grounding check (generation.ts checkLearnMain) never reads
// it. The learner's own answers are added to the `asked` grounding by the route, as a clarify's answer always was.
// ⚠ CONCISE, ROUND BY ROUND. Each teaching round (the newest Teach me, then every Go deeper / Explain / ... in order) is
// summarised to a few lines, newest rounds kept whole and the oldest trimmed first when the block is over
// TAUGHT_BLOCK_MAX characters (spec section 4: never the whole lesson history where a summary will do). The acceptance run
// showed why: a flat list capped at fourteen concepts was filled by the first lesson, and Go deeper round two never saw
// what round one had taught.

import { parseCheckFeedback } from "./learn-check";
import { parseTeachAnswer, questionText } from "./teach-format";

/** A saved teaching record of this lesson (store.ts ArtefactRow, the fields read here). */
export type TaughtRecord = { action: string; content: string; background?: string | null; createdAt?: string | null };
/** A check the learner answered this visit, as the page holds it (the clarification text is the engine's own labelled reply). */
export type PriorCheck = { question: string; answer: string | null; verdict: string | null; feedback: string | null };

export type TaughtResponse = { question: string; answer: string | null; verdict: string | null; right: string[]; missing: string[]; misconceptions: string[] };
/** One teaching round as the block tells it: what that round explained, developed, illustrated and asked. */
export type TaughtRound = { action: string; concepts: string[]; understanding: string[]; examples: string[]; questions: string[] };
export type TaughtSoFar = {
  /** Anything has been taught or answered. */
  taught: boolean;
  /** How many records of each action count (teach is the newest only; deeper, explain ... every round): Go deeper's round is rounds.deeper + 1. */
  rounds: Record<string, number>;
  /** The rounds in teaching order (the newest Teach me first, then the rest by time). */
  records: TaughtRound[];
  /** The key points already given, across rounds (deduplicated). */
  concepts: string[];
  /** The mechanisms and relationships already developed, across rounds (one line per UNDERSTANDING paragraph). */
  understanding: string[];
  examples: string[];
  questionsAsked: string[];
  responses: TaughtResponse[];
  /** What the checks found missing or mistaken, and lesson focus the teaching has not named. */
  open: string[];
};

/** The most Go deeper rounds one lesson gets by AI; beyond it the route answers "depth reached" from the notes with no AI call. */
export const DEEPER_ROUNDS_MAX = 3;
/** The block given to the model is cut at this many characters (the oldest rounds are trimmed first, never mid-item). */
export const TAUGHT_BLOCK_MAX = 3200;
export const PRIOR_CHECKS_MAX = 4;
const ITEM_MAX = 170;
/** Per round: what one round contributes to the block. */
export const ROUND_MAX = { concepts: 7, understanding: 5, examples: 1, questions: 2 } as const;
const OPEN_MAX = 8, LABEL_MAX = 30;
const PRIOR_LIMITS = { question: 400, answer: 1500, feedback: 3000 } as const;
const ACTION_WORDS: Record<string, string> = { teach: "Teach me (the lesson)", deeper: "Go deeper", explain: "Explain again", simplify: "Simplify", examples: "Examples", summary: "Summary" };

const plain = (s: string) => s.replace(/\[[SRE]\d+\]/g, "").replace(/\*\*|__|^#+\s*/g, "").replace(/\s+/g, " ").replace(/\s+([?.!,;:])/g, "$1").trim();
const clip = (s: string, n = ITEM_MAX) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n) > n / 2 ? s.lastIndexOf(" ", n) : n).replace(/[\s,;:]+$/, "")}…`);
const keyOf = (s: string) => plain(s).toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 3).slice(0, 8).join(" ");
const firstSentence = (p: string) => { const m = /^(.+?[.!?])(\s|$)/.exec(p); return (m ? m[1] : p).trim(); };

/** Add items to a list, deduplicated by their first content words (against `seen`), clipped, up to the list's cap. */
function add(list: string[], items: readonly string[], max: number, seen: Set<string> = new Set(list.map(keyOf))) {
  for (const raw of items) {
    const t = plain(raw);
    if (!t || t.length < 4) continue;
    const k = keyOf(t);
    if (!k || seen.has(k)) continue;
    if (list.length >= max) return;
    seen.add(k); list.push(clip(t));
  }
}

/** Pure. A free-text answer (Explain, Simplify, Summarise, an older Go deeper) as its bullets and its paragraphs' first sentences. */
function freeTextParts(content: string): { bullets: string[]; sentences: string[] } {
  const bullets: string[] = [], sentences: string[] = [];
  for (const para of content.split(/\n\s*\n/)) {
    const lines = para.split("\n").map(l => l.trim()).filter(Boolean);
    const prose = lines.filter(l => !/^(?:[-*•]|\d+[.)])\s+/.test(l));
    bullets.push(...lines.filter(l => /^(?:[-*•]|\d+[.)])\s+/.test(l)).map(l => l.replace(/^(?:[-*•]|\d+[.)])\s+/, "")));
    if (prose.length) sentences.push(firstSentence(prose.join(" ")));
  }
  return { bullets, sentences };
}

/** Pure. The prior checks the page sent, bounded and well formed; anything else is dropped (never refused: a check is context, not the request). */
export function parsePriorChecks(raw: unknown): PriorCheck[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
  const out: PriorCheck[] = [];
  for (const item of raw.slice(-PRIOR_CHECKS_MAX)) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const question = str(o.question, PRIOR_LIMITS.question);
    if (!question) continue;
    const verdict = o.verdict === "understood" || o.verdict === "partly" || o.verdict === "not_yet" ? o.verdict : null;
    out.push({ question, answer: str(o.answer, PRIOR_LIMITS.answer), verdict, feedback: typeof o.feedback === "string" ? o.feedback.trim().slice(0, PRIOR_LIMITS.feedback) || null : null });
  }
  return out;
}

/** Every text the learner typed in the prior checks (screened by the route, and added to the `asked` grounding). */
export const priorCheckTexts = (checks: readonly PriorCheck[]): string[] => checks.flatMap(c => (c.answer ? [c.answer] : []));

/** Pure. One saved record as a round: its parts (structured) or its bullets and first sentences (free text), each capped. */
function roundOf(r: TaughtRecord): TaughtRound {
  const round: TaughtRound = { action: r.action, concepts: [], understanding: [], examples: [], questions: [] };
  const parts = parseTeachAnswer(r.content);
  if (parts) {
    if (parts.overview && !parts.understanding?.length) add(round.understanding, [firstSentence(parts.overview)], ROUND_MAX.understanding);
    add(round.understanding, (parts.understanding ?? []).map(firstSentence), ROUND_MAX.understanding);
    add(round.concepts, parts.points, ROUND_MAX.concepts);
    if (parts.example) add(round.examples, [parts.example], ROUND_MAX.examples);
    add(round.questions, parts.questions.map(questionText), ROUND_MAX.questions);
  } else {
    const { bullets, sentences } = freeTextParts(r.content);
    add(round.concepts, bullets, ROUND_MAX.concepts);
    add(round.understanding, sentences, ROUND_MAX.understanding);
  }
  return round;
}

/**
 * Pure. The concise representation of spec section 4: concepts introduced, mechanisms and relationships explained, examples
 * used, questions asked, the learner's responses with what was right, missing or mistaken, and what is still open.
 * Of several saved Teach me lessons (a refreshed lesson, an older prompt version) only the NEWEST counts: it replaced the
 * others. Every other record is a round of its own, in time order. `lesson.focus` (learn.ts lessonOutline): headings the
 * lesson holds; one the teaching has not used the words of is still open.
 */
export function buildTaughtSoFar(records: readonly TaughtRecord[], checks: readonly PriorCheck[] = [], lesson: { objective?: string | null; focus?: readonly string[] | null } = {}): TaughtSoFar {
  const out: TaughtSoFar = { taught: false, rounds: {}, records: [], concepts: [], understanding: [], examples: [], questionsAsked: [], responses: [], open: [] };
  const live = [...records].filter(r => r.content?.trim()).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const teaches = live.filter(r => r.action === "teach");
  const newestTeach = teaches.length ? teaches[teaches.length - 1] : null;
  const ordered = [...(newestTeach ? [newestTeach] : []), ...live.filter(r => r.action !== "teach")];
  let corpus = "";
  const seen = { concepts: new Set<string>(), understanding: new Set<string>(), examples: new Set<string>(), questions: new Set<string>() };
  for (const r of ordered) {
    out.taught = true;
    out.rounds[r.action] = (out.rounds[r.action] ?? 0) + 1;
    corpus += `\n${r.content}`;
    const round = roundOf(r);
    out.records.push(round);
    add(out.concepts, round.concepts, Number.POSITIVE_INFINITY, seen.concepts);
    add(out.understanding, round.understanding, Number.POSITIVE_INFINITY, seen.understanding);
    add(out.examples, round.examples, Number.POSITIVE_INFINITY, seen.examples);
    add(out.questionsAsked, round.questions, Number.POSITIVE_INFINITY, seen.questions);
  }
  for (const c of checks) {
    out.taught = true;
    const fb = c.feedback ? parseCheckFeedback(c.feedback.replace(/^\s*\**VERDICT:[^\n]*\n?/i, "")) : null;
    const resp: TaughtResponse = { question: clip(plain(c.question), 240), answer: c.answer ? clip(plain(c.answer), 300) : null, verdict: c.verdict, right: [], missing: [], misconceptions: [] };
    add(resp.right, fb?.right ?? [], 3); add(resp.missing, fb?.missing ?? [], 3); add(resp.misconceptions, fb?.misconceptions ?? [], 3);
    out.responses.push(resp);
    add(out.questionsAsked, [c.question], Number.POSITIVE_INFINITY, seen.questions);
    add(out.open, [...resp.missing, ...resp.misconceptions], OPEN_MAX);
  }
  // Lesson focus (a heading the lesson holds) whose words the teaching so far has not all used is still open ground.
  const said = corpus.toLowerCase();
  for (const f of lesson.focus ?? []) {
    const words = plain(f).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
    if (words.length && !words.every(w => said.includes(w))) add(out.open, [f], OPEN_MAX);
  }
  return out;
}

export const TAUGHT_HEADER = "TAUGHT SO FAR (what Scholar has already taught the student about these passages, round by round, and how they answered). Not part of the passages: never cite it, quote it or present it as the notes. Use it to decide what to teach NEXT and what not to repeat.";

/** Pure. One round's lines; `n` caps each of its lists (trimming). */
function roundLines(r: TaughtRound, index: number, n: number): string {
  const cut = (xs: readonly string[]) => xs.slice(0, Math.max(0, Math.min(xs.length, n)));
  const label = (ACTION_WORDS[r.action] ?? r.action).slice(0, LABEL_MAX);
  const lines = [`Round ${index + 1}, ${label}:`];
  const c = cut(r.concepts), u = cut(r.understanding), e = cut(r.examples), q = cut(r.questions);
  if (u.length) lines.push(`  explained: ${u.join(" | ")}`);
  if (c.length) lines.push(`  key points given: ${c.join(" | ")}`);
  if (e.length) lines.push(`  example used: ${e.join(" | ")}`);
  if (q.length) lines.push(`  questions asked: ${q.join(" | ")}`);
  return lines.join("\n");
}

/**
 * Pure. The block the model reads, or null when nothing has been taught or answered. Bounded (TAUGHT_BLOCK_MAX): the oldest
 * rounds' lists are trimmed first, so the newest round (what the next request must build on) is always told in full.
 */
export function taughtSoFarBlock(t: TaughtSoFar, max: number = TAUGHT_BLOCK_MAX): string | null {
  if (!t.taught) return null;
  const render = (trim: number) => {
    // trim = how many of the oldest rounds are told in one line each; the rest in full.
    const lines: string[] = [TAUGHT_HEADER];
    const rounds = Object.entries(t.rounds).filter(([, v]) => v > 0).map(([k, v]) => `${ACTION_WORDS[k] ?? k}${v > 1 ? ` x${v}` : ""}`);
    if (rounds.length) lines.push(`Teaching given: ${rounds.join(", ")}.`);
    t.records.forEach((r, i) => lines.push(roundLines(r, i, i < trim ? 1 : ROUND_MAX.concepts)));
    if (t.responses.length) lines.push(`The student's answers to checks:\n${t.responses.map(r => {
      const bits = [`Q: ${r.question}`, r.answer ? `A: ${r.answer}` : null, r.verdict ? `judged: ${r.verdict.replace("_", " ")}` : null,
        r.right.length ? `right: ${r.right.join("; ")}` : null, r.missing.length ? `missing: ${r.missing.join("; ")}` : null, r.misconceptions.length ? `misconceptions: ${r.misconceptions.join("; ")}` : null];
      return `- ${bits.filter(Boolean).join(" | ")}`;
    }).join("\n")}`);
    if (t.open.length) lines.push(`Still open or not yet taught (teach these before going further into what was taught):\n${t.open.map(x => `- ${x}`).join("\n")}`);
    return lines.join("\n");
  };
  let trim = 0, text = render(trim);
  while (text.length > max && trim < t.records.length) text = render(++trim);
  return text.length > max ? text.slice(0, max) : text;
}

/** Pure. A short stable fingerprint of the taught ground (client-safe FNV-1a): part of the saved-answer key, so the same request on new ground is a new answer. */
export function taughtHash(t: TaughtSoFar): string {
  const basis = [Object.entries(t.rounds).sort().map(([k, v]) => `${k}=${v}`).join(","), ...t.concepts, ...t.understanding, ...t.responses.map(r => `${r.question}|${r.verdict ?? ""}`)].join("\n").toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** The learning actions that read the taught-so-far block (every lesson action but Ask, which carries its own conversation, and Teach me itself). */
export const CONTEXT_ACTIONS: readonly string[] = ["deeper", "explain", "simplify", "examples", "summary", "check", "clarify", "ask_me", "guide", "challenge", "mistake", "teach_back", "high_yield"];

// ── DEPTH REACHED (Go deeper with nothing further of value in the passages) ──

export const DEPTH_REACHED = "DEPTH_REACHED";
/** Pure. A Go deeper reply that declares the passages exhausted: the marker on its first line, then the suggestion. Null otherwise. */
export function parseDepthReached(raw: string): { suggestion: string } | null {
  const t = raw.trim();
  if (!t.toUpperCase().startsWith(DEPTH_REACHED)) return null;
  return { suggestion: plain(t.slice(DEPTH_REACHED.length).replace(/^[\s:.\-]+/, "")) };
}
export const DEPTH_REACHED_MESSAGE = "Your notes on this lesson have been taught in the depth they support. Going deeper again would only restate them.";
export const DEPTH_REACHED_CAP_MESSAGE = "Scholar has gone deeper into this lesson several times already. Rather than restate it, try one of these next.";
/** What to do instead: existing activities, never a new mode. */
export const DEPTH_REACHED_NEXT = [
  { key: "challenge", label: "Challenge me on it" },
  { key: "practise", label: "Practise questions on these sections" },
  { key: "next", label: "Go on to the next lesson" },
] as const;
