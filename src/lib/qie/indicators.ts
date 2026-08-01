/* eslint-disable @typescript-eslint/no-explicit-any */
// QIE-002 (Metrics & Indicators) + QIE-003 (Leading & Lagging) — one read model, not two.
//
// The specs describe two engines. Over this platform they are one: a Metric Registry and an Indicator
// Registry across the same 38 KPIs would be two catalogues of the same rows. QIE-002's registry IS
// pa_kpis; QIE-003's split is a property OF those rows (migration 181), not a separate population.
//
// COMPOSING, NOT COPYING. Every number here is calculated by Performance Analytics and read, never
// recomputed: a second implementation of "how is this KPI doing" would eventually disagree with the
// first, and a hospital would have two answers.
//
// WHAT THIS DELIBERATELY DOES NOT DO is infer the leading/lagging split from KPI names. Some calls are
// obvious and plenty are not -- whether PEWS Compliance is a predictive signal or a record of process
// adherence is a clinical governance judgement that changes which board the number appears on.
// Unclassified is reported as unclassified.

export type IndicatorClass = "leading" | "lagging";

export type Indicator = {
  id: string; code: string | null; name: string; category: string | null; unit: string | null;
  direction: string | null; target: number | null; current_value: number | null; previous_value: number | null;
  threshold_amber: number | null; threshold_red: number | null;
  indicator_class: IndicatorClass | null;
  /** how the current value sits against target and thresholds, or null when there is nothing to judge */
  status: "on_target" | "watch" | "breach" | null;
  /** direction of travel vs the previous value, respecting whether higher or lower is better */
  trend: "improving" | "worsening" | "flat" | null;
  points: number;                       // recorded values behind it
};

export type IndicatorView = {
  ready: boolean;
  reason?: string;
  /** true once migration 181 is applied; false means the split cannot be recorded yet */
  classifiable: boolean;
  indicators: Indicator[];
  stats: {
    total: number; leading: number; lagging: number; unclassified: number;
    withValues: number; breaches: number; watch: number;
    byCategory: { category: string; total: number; leading: number; lagging: number }[];
  };
};

const NONE = "00000000-0000-0000-0000-000000000000";
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Status against target and thresholds.
 *
 * `direction` matters and is the reason this is not a comparison: for `lower_better` a value ABOVE the
 * red threshold is a breach, for `higher_better` it is a value BELOW it. Getting that backwards would
 * paint every safety metric green on the day it got worst.
 */
export function statusOf(i: { current_value: number | null; direction: string | null; threshold_amber: number | null; threshold_red: number | null; target: number | null }): Indicator["status"] {
  const v = num(i.current_value);
  if (v === null) return null;
  const lowerBetter = i.direction === "lower_better";
  const red = num(i.threshold_red), amber = num(i.threshold_amber), target = num(i.target);
  const worseThan = (t: number) => (lowerBetter ? v > t : v < t);
  if (red !== null && worseThan(red)) return "breach";
  if (amber !== null && worseThan(amber)) return "watch";
  if (target !== null) return worseThan(target) ? "watch" : "on_target";
  // Thresholds present and not crossed, but no target to compare to: on target is the honest read.
  return red !== null || amber !== null ? "on_target" : null;
}

export function trendOf(i: { current_value: number | null; previous_value: number | null; direction: string | null }): Indicator["trend"] {
  const v = num(i.current_value), p = num(i.previous_value);
  if (v === null || p === null || v === p) return v !== null && p !== null ? "flat" : null;
  const up = v > p;
  return (i.direction === "lower_better" ? !up : up) ? "improving" : "worsening";
}

export async function loadIndicators(admin: any, hospitalId: string | null, isSuper: boolean): Promise<IndicatorView> {
  const empty: IndicatorView = {
    ready: false, classifiable: false, indicators: [],
    stats: { total: 0, leading: 0, lagging: 0, unclassified: 0, withValues: 0, breaches: 0, watch: 0, byCategory: [] },
  };

  // Existence via a plain select, never head+count: PostgREST answers head on a missing table with
  // 204/no-error/null, which is indistinguishable from empty.
  const probe = await admin.from("pa_kpis").select("id").limit(1);
  if (probe.error) return { ...empty, reason: "pa_kpis is not deployed — Performance Analytics (migration 108) is the metric registry QIE reads." };

  // Migration 181 may not be applied. Ask for the column and degrade to unclassified rather than failing
  // the whole surface -- the 38 KPIs are still worth showing without the split.
  const withClass = await admin.from("pa_kpis").select("indicator_class").limit(1);
  const classifiable = !withClass.error;

  const cols = "id, code, name, category, unit, direction, target, current_value, previous_value, threshold_amber, threshold_red"
    + (classifiable ? ", indicator_class" : "");
  let q = admin.from("pa_kpis").select(cols).order("category").order("name").limit(500);
  if (!isSuper) q = q.eq("hospital_id", hospitalId ?? NONE);
  const { data, error } = await q;
  if (error) return { ...empty, reason: error.message };
  const rows = (data ?? []) as any[];

  // Value counts per KPI, in one query rather than one per indicator.
  const { data: vals } = rows.length
    ? await admin.from("pa_kpi_values").select("kpi_id").in("kpi_id", rows.map(r => r.id)).limit(20000)
    : { data: [] as any[] };
  const points = new Map<string, number>();
  for (const v of ((vals ?? []) as any[])) points.set(v.kpi_id, (points.get(v.kpi_id) ?? 0) + 1);

  const indicators: Indicator[] = rows.map(r => ({
    ...r,
    indicator_class: (classifiable ? r.indicator_class : null) ?? null,
    status: statusOf(r),
    trend: trendOf(r),
    points: points.get(r.id) ?? 0,
  }));

  const cats = new Map<string, { total: number; leading: number; lagging: number }>();
  for (const i of indicators) {
    const key = i.category ?? "Uncategorised";
    if (!cats.has(key)) cats.set(key, { total: 0, leading: 0, lagging: 0 });
    const c = cats.get(key)!;
    c.total++;
    if (i.indicator_class === "leading") c.leading++;
    if (i.indicator_class === "lagging") c.lagging++;
  }

  return {
    ready: true,
    classifiable,
    reason: classifiable ? undefined : "Migration 181 is not applied, so the leading/lagging split cannot be recorded yet.",
    indicators,
    stats: {
      total: indicators.length,
      leading: indicators.filter(i => i.indicator_class === "leading").length,
      lagging: indicators.filter(i => i.indicator_class === "lagging").length,
      unclassified: indicators.filter(i => !i.indicator_class).length,
      withValues: indicators.filter(i => i.points > 0).length,
      breaches: indicators.filter(i => i.status === "breach").length,
      watch: indicators.filter(i => i.status === "watch").length,
      byCategory: [...cats.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.total - a.total),
    },
  };
}
