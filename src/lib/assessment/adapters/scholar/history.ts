import { PRIMARY, evalField, orderedItems, type InstrumentDef, type InstrumentItem, type Responses, type Treatment } from "../../core";

// ── SELF-RATED PROFICIENCY OVER TIME ── Checklist Studio S3, owner addenda 4 and 5 ──────────────────────────────────
//
// Pure. A competency can be assessed by several criteria (one item each). Its self rating in ONE instance is the MEDIAN of the
// criteria the learner rated (the lower of the two middle values when there is an even number), shown beside the lowest and the
// highest. A median is an order statistic, so it is valid for an ordinal scale; an average of ordinals is not, and is never taken.
// "Unable to judge" and "not answered" are NOT zeros: they are counted apart and never enter the median.
//
// Every attempt is its own instance, never overwritten. The history of a competency is every SUBMITTED self instance that
// rated it, by submitted_at; the delta is the latest rating minus the one before it.

export type CompetencyRating = {
  /** The median rating (an ordinal on the instrument's scale), or null when no criterion was rated. */
  rating: number | null;
  /** The label of the level at the median, as the scale words it. */
  descriptor: string | null;
  low: number | null; high: number | null;
  rated: number; unjudged: number; unanswered: number; criteria: number;
};

export const lowerMedian = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

const levelLabel = (item: InstrumentItem, ordinal: number): string | null => item.scale?.levels.find(l => l.ordinal === ordinal)?.label ?? null;

/** Ratings of one instance by competency: only items that are rating-scale and mapped to a competency count. */
export function ratingsByCompetency(def: InstrumentDef, responses: Responses, competencyOf: ReadonlyMap<string, string>, defaults?: Treatment): Map<string, CompetencyRating> {
  const groups = new Map<string, { ordinals: number[]; items: InstrumentItem[]; unjudged: number; unanswered: number; criteria: number }>();
  for (const item of orderedItems(def)) {
    const competencyId = competencyOf.get(item.stable_key);
    if (!competencyId || item.response_type !== "rating_scale") continue;
    const g = groups.get(competencyId) ?? { ordinals: [], items: [], unjudged: 0, unanswered: 0, criteria: 0 };
    g.criteria++;
    const ev = evalField(item, PRIMARY, responses, defaults);
    if (ev.ordinal !== null) { g.ordinals.push(ev.ordinal); g.items.push(item); }
    else if (ev.state === "unable_to_determine" || ev.state === "unable_to_demonstrate") g.unjudged++;
    else if (ev.state !== "not_observed" && ev.state !== "not_applicable") g.unanswered++;
    groups.set(competencyId, g);
  }
  const out = new Map<string, CompetencyRating>();
  for (const [id, g] of groups) {
    const rating = lowerMedian(g.ordinals);
    const at = rating === null ? undefined : g.items.find(i => levelLabel(i, rating) !== null);
    out.set(id, {
      rating, descriptor: at && rating !== null ? levelLabel(at, rating) : null,
      low: g.ordinals.length ? Math.min(...g.ordinals) : null, high: g.ordinals.length ? Math.max(...g.ordinals) : null,
      rated: g.ordinals.length, unjudged: g.unjudged, unanswered: g.unanswered, criteria: g.criteria,
    });
  }
  return out;
}

export type Attempt = { instanceId: string; submittedAt: string; instrumentCode: string; instrumentName: string; rating: CompetencyRating };
export type Trend = "none" | "first" | "up" | "down" | "same";
export type CompetencyHistory = {
  /** Oldest first. */
  attempts: Attempt[];
  latest: Attempt | null;
  previous: Attempt | null;
  /** latest rating minus the previous rating, when both attempts rated the competency. */
  delta: number | null;
  trend: Trend;
};

export function buildHistory(attempts: readonly Attempt[]): CompetencyHistory {
  const sorted = [...attempts].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.instanceId.localeCompare(b.instanceId));
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const a = latest?.rating.rating ?? null, b = previous?.rating.rating ?? null;
  const delta = a !== null && b !== null ? a - b : null;
  const trend: Trend = !latest ? "none" : !previous || delta === null ? "first" : delta > 0 ? "up" : delta < 0 ? "down" : "same";
  return { attempts: sorted, latest, previous, delta, trend };
}

export const TREND_TEXT: Record<Trend, string> = {
  none: "No attempts yet", first: "First attempt", up: "Up since your previous attempt", down: "Down since your previous attempt", same: "Same as your previous attempt",
};

/** "+1", "-2" or "no change", or null when there is nothing to compare. */
export const deltaText = (delta: number | null): string | null => (delta === null ? null : delta === 0 ? "no change" : delta > 0 ? `+${delta}` : `${delta}`);
