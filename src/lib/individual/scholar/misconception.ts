// ── SCHOLAR-SQIE-LEARNER-01: THE NEXT ITEM FROM WHAT THE LEARNER KEEPS MISSING ── pure, a stated rule, no model ──────────
//
// Every generated item carries the misconceptions its rubric records (question-intel.ts Rubric.misconceptions) and, for a
// flashcard, its topic. When the learner misses an item, those are what they just showed they do not have. The next item an
// adaptive exam or a Weak areas session offers PREFERS an item they have not answered yet (or that is due for review) whose
// rubric names the same misconception, or whose topic is the topic they missed -- the section the missed item came from counts
// as its topic. Then the existing rotation decides, unchanged. Nothing is withheld by it and nothing is estimated: it only
// reorders what was already eligible, on the learner's own last thirty days.
//
// ⚠ FORMATIVE. Not a diagnosis, not a measure of competence.

import { rubricOf, stemKey } from "./question-intel";

/** The days of misses the preference looks back over. */
export const RECENT_MISS_DAYS = 30;

/** One missed item, as the preference reads it: what its rubric lists, its topic, its section, when it was last missed. */
export type RecentMiss = { misconceptions: readonly string[]; topic: string | null; chunkId: string | null; at: string };

/** An item that may be preferred: only the fields the preference reads. */
export type MisconceptionCandidate = {
  id: string; chunkId?: string | null; misconceptions?: readonly string[] | null; topic?: string | null; due?: boolean; lastAnsweredAt?: string | null;
};

/** Pure. The misses inside the window (the last `days` days up to `now`), newest first. */
export function recentMisses(rows: readonly RecentMiss[], now: string, days = RECENT_MISS_DAYS): RecentMiss[] {
  const from = Date.parse(now) - days * 864e5, to = Date.parse(now);
  return rows.filter(r => { const t = Date.parse(r.at); return Number.isFinite(t) && t >= from && t <= to; }).sort((a, b) => b.at.localeCompare(a.at));
}

const tokens = (s: string): Set<string> => new Set(stemKey(s).split(" ").filter(w => w.length >= 3));
/** Two misconceptions are the same when their normalised wording is, or their content words overlap by 60% (Jaccard). */
function same(a: string, b: string): boolean {
  const ka = stemKey(a), kb = stemKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / (ta.size + tb.size - shared) >= 0.6;
}
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Pure. How strongly an item matches what was missed: 3 for each of its misconceptions the learner's misses also list (at most
 * three counted), plus 1 when its topic, or its section, is one they missed. 0: no match.
 */
export function misconceptionScore(c: MisconceptionCandidate, misses: readonly RecentMiss[]): number {
  if (!misses.length) return 0;
  const mine = (c.misconceptions ?? []).filter(Boolean);
  const theirs = misses.flatMap(m => m.misconceptions).filter(Boolean);
  const hits = mine.filter(m => theirs.some(t => same(m, t))).length;
  const topic = c.topic ? flat(c.topic) : "";
  const onTopic = misses.some(m => (topic && m.topic && flat(m.topic) === topic) || (!!c.chunkId && !!m.chunkId && m.chunkId === c.chunkId));
  return Math.min(3, hits) * 3 + (onTopic ? 1 : 0);
}

/**
 * Pure. `items` reordered: first the items that match the learner's recent misses AND have not been answered yet or are due
 * (all of them, when `answeredToo`), best match first; then every other item in the order it came. A stable reorder: nothing is
 * added or dropped, and with no misses (or no match) the order is exactly the one given.
 */
export function pickByMisconception<T extends MisconceptionCandidate>(items: readonly T[], misses: readonly RecentMiss[], opts: { answeredToo?: boolean } = {}): T[] {
  if (!misses.length) return [...items];
  const scored = items.map((item, index) => ({
    item, index, score: opts.answeredToo || item.due || (item.lastAnsweredAt ?? null) === null ? misconceptionScore(item, misses) : 0,
  }));
  const preferred = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return [...preferred, ...scored.filter(s => s.score <= 0)].map(s => s.item);
}

/** Pure. What a stored question's rubric lists for the preference: its misconceptions and its topic (a flashcard's). */
export function signalsOf(q: { answer: unknown }): { misconceptions: string[]; topic: string | null } {
  const r = rubricOf(q.answer);
  return { misconceptions: r?.misconceptions ?? [], topic: r?.topic ?? null };
}

/** Pure. A missed question as the preference reads it, or none when it has not been missed. */
export function missOf(q: { answer: unknown; chunkId: string }, lastMissAt: string | null | undefined): RecentMiss[] {
  return lastMissAt ? [{ ...signalsOf(q), chunkId: q.chunkId, at: lastMissAt }] : [];
}
