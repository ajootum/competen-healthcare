// ── RELEVANCE RANKING OF LIBRARY CASES ── SCHOLAR-INTELLIGENCE-COMPLETE-01 ────────────────────────────────────────────
//
// PURE. findLibraryCases (library.ts) still FILTERS exactly as before (level, competency, profession, specialty, topic);
// this only ORDERS what passed, so the most useful case is offered first and each offer can say why. It decides nothing
// about eligibility: delivery stays "published AND approved for the exact version" (case_library_deliverable).
//
//   score = 3 x competency overlap   share of the competencies asked for that the case teaches (0..1)
//         + 2 x topic overlap        share of the topic's words found in the case's title and objectives (0..1)
//         + 3 x gap match            1 when the case teaches a competency the learner's latest evaluation names as a gap,
//                                    0.5 when a gap's label shares a long word with the case, else 0
//         + level fit                +1 same level as the learner's, -1 two steps apart, else 0 (0 when either is unknown)
//   ties keep the order given, which is newest-published first.

export type RankGaps = { competencyIds?: readonly string[]; labels?: readonly string[] };
export type RankContext = { topic?: string | null; competencyIds?: readonly string[]; gaps?: RankGaps | null; level?: string | null };
export type Rankable = { level: string; competencyIds: readonly string[]; title: string; objectives?: readonly string[]; summary?: string | null };

const LEVELS = ["foundation", "intermediate", "advanced"];
const words = (s: string | null | undefined, min = 3): string[] => [...new Set((s ?? "").toLowerCase().split(/\W+/).filter(w => w.length >= min))];

/** Pure: the score and the reasons for one case. */
export function scoreCase(c: Rankable, ctx: RankContext): { score: number; why: string[] } {
  const why: string[] = [];
  const asked = ctx.competencyIds ?? [];
  const overlap = asked.length ? asked.filter(id => c.competencyIds.includes(id)).length / asked.length : 0;
  const hay = [c.title, ...(c.objectives ?? [])].join(" ").toLowerCase();
  const topicWords = words(ctx.topic);
  const topic = topicWords.length ? topicWords.filter(w => hay.includes(w)).length / topicWords.length : 0;
  const gapIds = ctx.gaps?.competencyIds ?? [];
  let gap = 0;
  if (gapIds.length && c.competencyIds.some(id => gapIds.includes(id))) gap = 1;
  else if (ctx.gaps?.labels?.length) {
    const long = words(ctx.gaps.labels.join(" "), 5);
    if (long.some(w => hay.includes(w))) gap = 0.5;
  }
  const li = LEVELS.indexOf(ctx.level ?? ""), ci = LEVELS.indexOf(c.level);
  const fit = li < 0 || ci < 0 ? 0 : Math.abs(li - ci) === 0 ? 1 : Math.abs(li - ci) >= 2 ? -1 : 0;
  if (overlap > 0) why.push(asked.length > 1 ? "Teaches some of the competencies you asked for" : "Teaches the competency you asked for");
  if (topic > 0) why.push("Matches your topic");
  if (gap > 0) why.push(gap === 1 ? "Targets a gap in your latest evaluation" : "Related to a gap in your latest evaluation");
  if (fit === 1) why.push("Pitched at your level");
  return { score: 3 * overlap + 2 * topic + 3 * gap + fit, why };
}

/** Pure: the cases, best first, each with its score and reasons. Equal scores keep the order given (newest first). */
export function rankLibraryCases<T extends Rankable>(cases: readonly T[], ctx: RankContext = {}): (T & { score: number; why: string[] })[] {
  return cases.map((c, i) => ({ c, i, ...scoreCase(c, ctx) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(x => ({ ...x.c, score: x.score, why: x.why }));
}

/** Pure: what a stored evaluation's gaps tell the ranking (its `results.gaps` areas). Competency and outcome areas name a competency; the rest are labels. */
export function gapsFromResults(results: unknown): RankGaps | undefined {
  const areas = Array.isArray((results as { gaps?: unknown } | null)?.gaps) ? (results as { gaps: any[] }).gaps.slice(0, 12) : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const competencyIds = new Set<string>(), labels: string[] = [];
  for (const a of areas) {
    if (typeof a?.label === "string") labels.push(a.label.slice(0, 120));
    if (a?.kind === "competency" || a?.kind === "outcome") { const m = typeof a.key === "string" ? a.key.match(UUID) : null; if (m) competencyIds.add(m[0].toLowerCase()); }
  }
  return competencyIds.size || labels.length ? { competencyIds: [...competencyIds], labels } : undefined;
}

/** How many filtered cases are ranked and delivery-checked at most (a bound on the per-version checks). */
export const RANK_POOL = 24;
