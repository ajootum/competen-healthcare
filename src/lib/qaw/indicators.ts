// QAW-006 Quality Indicators & Measurement Centre — enterprise KPI engine.
// Grounded in quality_indicators (019) + indicator_measurements (the real value time-series).
// Indicators are scoped via their hospital-owned quality_objects; RAG status is computed from the
// latest measurement vs target_value/escalation_value honouring the indicator's direction.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOMAIN_TONE = ["teal", "blue", "indigo", "violet", "amber", "rose", "emerald", "slate"];

function statusOf(ind: any, value: number | null): "met" | "near" | "below" | "nodata" {
  const t = ind.target_value != null ? Number(ind.target_value) : null;
  if (value == null || t == null) return "nodata";
  const higher = ind.direction === "higher_is_better";
  if (higher ? value >= t : value <= t) return "met";
  const esc = ind.escalation_value != null ? Number(ind.escalation_value) : null;
  const breach = esc != null ? (higher ? value < esc : value > esc) : false;
  return breach ? "below" : "near";
}
function achievement(ind: any, value: number | null): number | null {
  const t = ind.target_value != null ? Number(ind.target_value) : null;
  if (value == null || !t) return null;
  const a = ind.direction === "higher_is_better" ? value / t : t / value;
  return Math.round(Math.min(1.5, Math.max(0, a)) * 100);
}
const fmt = (v: number | null, unit: string) => v == null ? "—" : unit === "percent" ? `${v}%` : unit === "rate_per_1000" ? `${v}` : unit === "days" ? `${v}d` : unit === "minutes" ? `${v}m` : `${v}`;

export async function loadIndicators(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Objects (for scope + domain) and domains.
  const { data: objs, error } = await scope(admin.from("quality_objects").select("id, domain_id").limit(4000));
  if (error) return { provisioned: false as const };
  const objIds = (objs ?? []).map((o: any) => o.id);
  if (!objIds.length) return { provisioned: true as const, empty: true as const };
  const { data: domains } = await admin.from("quality_domains").select("id, name").limit(100);
  const domName = new Map((domains ?? []).map((d: any) => [d.id, d.name]));
  const objDomain = new Map((objs ?? []).map((o: any) => [o.id, o.domain_id]));

  const { data: indRows } = await admin.from("quality_indicators").select("id, code, name, unit, direction, target_value, escalation_value, frequency, is_active, quality_object_id").in("quality_object_id", objIds).eq("is_active", true).limit(5000);
  const indicators = (indRows ?? []) as any[];
  if (!indicators.length) return { provisioned: true as const, empty: true as const };
  const indById = new Map(indicators.map(i => [i.id, i]));
  const indIds = indicators.map(i => i.id);

  // Measurements (real values), scoped by hospital.
  let meas: any[] = [];
  for (let i = 0; i < indIds.length; i += 200) {
    const q = admin.from("indicator_measurements").select("indicator_id, period, value").in("indicator_id", indIds.slice(i, i + 200)).order("period", { ascending: false }).limit(20000);
    const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
    meas = meas.concat(data ?? []);
  }
  // Latest value per indicator.
  const latest = new Map<string, number>();
  meas.forEach(m => { if (!latest.has(m.indicator_id)) latest.set(m.indicator_id, Number(m.value)); });

  // Classify each indicator.
  const classified = indicators.map(i => {
    const v = latest.has(i.id) ? latest.get(i.id)! : null;
    return { ...i, value: v, status: statusOf(i, v), achievement: achievement(i, v), domain: domName.get(objDomain.get(i.quality_object_id)) ?? "General" };
  });
  const met = classified.filter(c => c.status === "met");
  const near = classified.filter(c => c.status === "near");
  const below = classified.filter(c => c.status === "below");
  const nodata = classified.filter(c => c.status === "nodata");
  const withData = classified.filter(c => c.achievement != null);
  const overall = withData.length ? Math.round(withData.reduce((s, c) => s + Math.min(100, c.achievement!), 0) / withData.length) : null;

  // By domain — % meeting target.
  const domMap = new Map<string, { total: number; met: number }>();
  classified.forEach(c => { const d = domMap.get(c.domain) ?? { total: 0, met: 0 }; d.total++; if (c.status === "met") d.met++; domMap.set(c.domain, d); });
  const byDomain = [...domMap.entries()].map(([label, v], i) => ({ label, pct: v.total ? Math.round((v.met / v.total) * 100) : 0, value: v.total, tone: DOMAIN_TONE[i % DOMAIN_TONE.length] })).sort((a, b) => b.value - a.value);

  // Trend — % of measurements meeting their target, per month (last 6).
  const monthAgg = new Map<string, { total: number; met: number }>();
  meas.forEach(m => {
    const ind = indById.get(m.indicator_id); if (!ind) return;
    const k = String(m.period).slice(0, 7);
    const a = monthAgg.get(k) ?? { total: 0, met: 0 };
    a.total++; if (statusOf(ind, Number(m.value)) === "met") a.met++;
    monthAgg.set(k, a);
  });
  const trend = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v.total ? Math.round((v.met / v.total) * 100) : 0 }));

  const topBelow = [...below, ...near].sort((a, b) => (a.achievement ?? 0) - (b.achievement ?? 0)).slice(0, 6).map(c => ({ name: c.name, domain: c.domain, value: fmt(c.value, c.unit), target: fmt(c.target_value != null ? Number(c.target_value) : null, c.unit), status: c.status, achievement: c.achievement }));
  const sample = classified.slice(0, 6).map(c => ({ name: c.name, domain: c.domain, value: fmt(c.value, c.unit), target: fmt(c.target_value != null ? Number(c.target_value) : null, c.unit), status: c.status }));

  return {
    provisioned: true as const, empty: false as const,
    kpis: {
      total: classified.length, met: met.length, near: near.length, below: below.length, nodata: nodata.length,
      overall, completeness: classified.length ? Math.round(((classified.length - nodata.length) / classified.length) * 100) : 0,
    },
    statusDonut: [
      { label: "Met target", value: met.length, tone: "emerald" },
      { label: "Near target", value: near.length, tone: "amber" },
      { label: "Below target", value: below.length, tone: "rose" },
      { label: "No data", value: nodata.length, tone: "slate" },
    ],
    byDomain, trend, topBelow, sample,
  };
}
