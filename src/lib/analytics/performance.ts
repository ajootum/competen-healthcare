// UMW Performance Analytics shared data layer (UMW-PA-001..009). One fail-soft read of the PA stores (perspectives /
// KPIs / trend values / benchmarks / improvement projects / cost centres / reports / predictions) for a hospital,
// with KPIs whose `snapshot_field` maps to op_ops_snapshots resolved LIVE from the latest real operational snapshot.
// Provides RAG status, target achievement and balanced-scorecard rollups every PA module shares. Read model.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const NONE = "00000000-0000-0000-0000-000000000000";
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: null }));
const num = (v: any) => (v == null ? null : Number(v));

// RAG status from value vs target / amber / red thresholds, honouring direction.
export function ragStatus(kpi: any): "green" | "amber" | "red" {
  const v = num(kpi.value ?? kpi.current_value), t = num(kpi.target), a = num(kpi.threshold_amber), r = num(kpi.threshold_red);
  if (v == null || t == null) return "amber";
  if (kpi.direction === "lower_better") {
    if (v <= t) return "green"; if (a != null && v <= a) return "amber"; if (r != null && v <= r) return "amber"; return "red";
  }
  if (v >= t) return "green"; if (a != null && v >= a) return "amber"; if (r != null && v >= r) return "amber"; return "red";
}

// Target achievement as a 0-120% score (capped) for scorecard rollups.
export function achievement(kpi: any): number {
  const v = num(kpi.value ?? kpi.current_value), t = num(kpi.target);
  if (v == null || t == null || t === 0) return 0;
  const raw = kpi.direction === "lower_better" ? (v <= 0 ? 120 : (t / v) * 100) : (v / t) * 100;
  return Math.max(0, Math.min(120, Math.round(raw)));
}

export type PerfData = Awaited<ReturnType<typeof fetchPerformance>>;

export async function fetchPerformance(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [perspRes, kpiRes, valRes, benchRes, projRes, costRes, repRes, predRes, snapRes] = await Promise.all([
    soft(scope(admin.from("pa_perspectives").select("*")).order("sort_order")),
    soft(scope(admin.from("pa_kpis").select("*")).order("code")),
    soft(admin.from("pa_kpi_values").select("kpi_id, period, value").order("period")),
    soft(admin.from("pa_benchmarks").select("kpi_id, comparator, value")),
    soft(scope(admin.from("pa_improvement_projects").select("*"))),
    soft(scope(admin.from("pa_cost_centres").select("*"))),
    soft(scope(admin.from("pa_reports").select("*")).order("due_date")),
    soft(scope(admin.from("pa_predictions").select("*")).order("created_at", { ascending: false })),
    soft(scope(admin.from("op_ops_snapshots").select("*")).eq("period_type", "day").order("period", { ascending: false }).limit(1)),
  ]);
  if (perspRes.error && missing(perspRes.error)) return { provisioned: false as const };

  const perspectives = (perspRes.data ?? []) as any[];
  const rawKpis = (kpiRes.data ?? []) as any[];
  const values = (valRes.data ?? []) as any[];
  const benchmarks = (benchRes.data ?? []) as any[];
  const projects = (projRes.data ?? []) as any[];
  const costCentres = (costRes.data ?? []) as any[];
  const reports = (repRes.data ?? []) as any[];
  const predictions = (predRes.data ?? []) as any[];
  const snapshot = (snapRes.data ?? [])[0] ?? {};

  if (!perspectives.length && !rawKpis.length) return { provisioned: true as const, hasData: false, perspectives: [], kpis: [] as any[], projects, costCentres, reports, predictions, scorecard: [] as any[], overall: 0, snapshotPeriod: null as string | null };

  // Resolve live values from the latest operational snapshot where a KPI maps to a snapshot column.
  const valsByKpi = new Map<string, any[]>();
  values.forEach(v => { const a = valsByKpi.get(v.kpi_id) ?? []; a.push(v); valsByKpi.set(v.kpi_id, a); });
  const benchByKpi = new Map<string, any[]>();
  benchmarks.forEach(b => { const a = benchByKpi.get(b.kpi_id) ?? []; a.push(b); benchByKpi.set(b.kpi_id, a); });
  const perspById = new Map(perspectives.map(p => [p.id, p]));

  const kpis = rawKpis.map(k => {
    const live = k.snapshot_field && snapshot[k.snapshot_field] != null ? Number(snapshot[k.snapshot_field]) : null;
    const value = live != null ? Math.round(live * 100) / 100 : num(k.current_value);
    const withVal = { ...k, value, isLive: live != null, previous: num(k.previous_value) };
    const trend = (valsByKpi.get(k.id) ?? []).map(v => Number(v.value));
    return {
      ...withVal,
      status: ragStatus(withVal),
      achievement: achievement(withVal),
      deltaUp: withVal.previous != null && value != null ? (k.direction === "lower_better" ? value < withVal.previous : value > withVal.previous) : null,
      deltaPct: (value != null && withVal.previous) ? Math.round(((value - withVal.previous) / Math.abs(withVal.previous)) * 100) : null,
      trend,
      perspectiveName: perspById.get(k.perspective_id)?.name ?? null,
      perspectiveColor: perspById.get(k.perspective_id)?.color ?? "#94a3b8",
      benchmarks: benchByKpi.get(k.id) ?? [],
    };
  });

  // Balanced scorecard — score per perspective (weighted avg achievement of its active KPIs).
  const scorecard = perspectives.map(p => {
    const members = kpis.filter(k => k.perspective_id === p.id && k.status !== undefined);
    const score = members.length ? Math.round(members.reduce((a, k) => a + Math.min(100, k.achievement), 0) / members.length) : 0;
    const green = members.filter(k => k.status === "green").length;
    return { id: p.id, name: p.name, color: p.color, icon: p.icon, target: p.target_pct, kpiCount: members.length, green, score, status: score >= (p.target_pct ?? 85) ? "green" : score >= (p.target_pct ?? 85) - 8 ? "amber" : "red" };
  });

  const overall = scorecard.length ? Math.round(scorecard.reduce((a, s) => a + s.score * (perspById.get(s.id)?.weight ?? 1), 0) / scorecard.reduce((a, s) => a + (perspById.get(s.id)?.weight ?? 1), 0)) : 0;

  return { provisioned: true as const, hasData: true, perspectives, kpis, scorecard, overall, projects, costCentres, reports, predictions, snapshotPeriod: snapshot.period ?? null };
}

export const RAG_TONE: Record<string, string> = { green: "emerald", amber: "amber", red: "rose" };
export const RAG_DOT: Record<string, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" };
