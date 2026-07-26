// QAW-007 Quality Analytics & Reporting Centre — enterprise quality intelligence + automated reporting.
// Grounded in quality_score_snapshots (091, the immutable daily executive-KPI history — the spine for
// every score, trend and forecast here) plus report_definitions / report_schedules (035, the report
// builder + scheduler). Active-indicator counts and the below-target list are reused from the live
// Quality Indicators loader (QAW-006); audits / capa_actions are counted only for the data-source tally.
// The "predictive risk forecast" is a RULE-BASED slope over the snapshot history — not machine learning.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";
import { loadIndicators } from "@/lib/qaw/indicators";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DS_TONE = ["teal", "blue", "indigo", "violet", "amber", "rose", "emerald", "slate"];

export async function loadAnalytics(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // PRIMARY — daily quality-score snapshots (immutable exec KPI history).
  const { data: snapRows, error } = await scope(
    admin.from("quality_score_snapshots")
      .select("snapshot_date, health_score, quality_score, safety_index, compliance_score, open_capas, overdue_capas, critical_incidents, high_risks, patient_safety_events")
      .order("snapshot_date", { ascending: false }).limit(400)
  );
  if (error) return { provisioned: false as const };
  const snaps = (snapRows ?? []) as any[];
  const latest = snaps[0] ?? null;
  const num = (v: any) => (v == null ? null : Number(v));

  // Latest composite scores.
  const cur = latest ? {
    quality: num(latest.quality_score), safety: num(latest.safety_index),
    compliance: num(latest.compliance_score), health: num(latest.health_score),
    alerts: Number(latest.critical_incidents || 0) + Number(latest.high_risks || 0),
  } : null;

  // Monthly series helper — latest snapshot per calendar month (snaps are date-desc), oldest→newest.
  const monthly = (field: string): [string, number][] => {
    const m = new Map<string, number>();
    snaps.forEach(s => { const key = String(s.snapshot_date).slice(0, 7); if (!m.has(key) && s[field] != null) m.set(key, Number(s[field])); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  // 12-month overall quality-score trend.
  const qm = monthly("quality_score").slice(-12);
  const qualityTrend = qm.map(([key, v]) => ({ label: MONTHS[Number(key.slice(5, 7)) - 1], value: v }));
  const hasHistory = qm.length >= 2;

  // Performance by dimension — the four composite sub-scores from the latest snapshot.
  const dimDefs = [
    { label: "Quality", k: "quality", tone: "teal" },
    { label: "Safety", k: "safety", tone: "blue" },
    { label: "Compliance", k: "compliance", tone: "indigo" },
    { label: "Health", k: "health", tone: "violet" },
  ] as const;
  let domain: { segments: { value: number; tone: string; label: string }[]; items: { label: string; value: any; tone: string }[]; center: number } | null = null;
  if (cur) {
    const items = dimDefs.map(dd => ({ label: dd.label, value: (cur as any)[dd.k] as number | null, tone: dd.tone })).filter(dd => dd.value != null).map(dd => ({ ...dd, value: dd.value as number }));
    const segments = dimDefs.map(dd => ({ value: Number((cur as any)[dd.k] ?? 0), tone: dd.tone, label: dd.label })).filter(s => s.value > 0);
    const subs = [cur.quality, cur.safety, cur.compliance].filter((x): x is number => x != null);
    const center = cur.health != null ? cur.health : (subs.length ? Math.round(subs.reduce((a, b) => a + b, 0) / subs.length) : 0);
    if (segments.length) domain = { segments, items, center };
  }

  // Key highlights — rule-based on the direction of each monthly series (honest, not ML).
  const highlights: { text: string; tone: string }[] = [];
  const trendHi = (field: string, label: string, goodUp: boolean) => {
    const s = monthly(field);
    if (s.length < 2) return;
    const first = s[0][1], last = s[s.length - 1][1], delta = last - first;
    if (delta === 0) { highlights.push({ text: `${label} held steady at ${last} across ${s.length} months.`, tone: "slate" }); return; }
    const good = goodUp ? delta > 0 : delta < 0;
    highlights.push({ text: `${label} ${delta > 0 ? "rose" : "fell"} ${Math.abs(delta)} over ${s.length} months.`, tone: good ? "emerald" : "rose" });
  };
  trendHi("quality_score", "Overall quality score", true);
  trendHi("compliance_score", "Compliance score", true);
  trendHi("safety_index", "Safety index", true);
  trendHi("high_risks", "Open high / extreme risks", false);
  trendHi("overdue_capas", "Overdue CAPAs", false);

  // Predictive risk forecast — rule-based slope (latest vs ~3 months prior). All signals are lower-is-better.
  const FCAST = [
    { key: "high_risks", label: "High / extreme risks" },
    { key: "critical_incidents", label: "Critical incidents" },
    { key: "overdue_capas", label: "Overdue CAPAs" },
    { key: "patient_safety_events", label: "Patient safety events" },
  ];
  const forecast = FCAST.map(f => {
    const s = monthly(f.key).map(x => x[1]);
    const current: number | null = s.length ? s[s.length - 1] : null;
    if (s.length < 2) return { label: f.label, current, delta: null as number | null, dir: "flat" as "up" | "down" | "flat", outlook: "Insufficient history", tone: "slate" };
    const base = s.length >= 4 ? s[s.length - 4] : s[0];
    const delta = (current as number) - base;
    return {
      label: f.label, current, delta: delta as number | null,
      dir: (delta > 0 ? "up" : delta < 0 ? "down" : "flat") as "up" | "down" | "flat",
      outlook: delta > 0 ? "Elevated" : delta < 0 ? "Improving" : "Stable",
      tone: delta > 0 ? "rose" : delta < 0 ? "emerald" : "slate",
    };
  });

  // Data-quality / completeness — non-null fill rate of each KPI field over the recent snapshots.
  const recent = snaps.slice(0, 30);
  const dqDefs: [string, string][] = [
    ["Health score", "health_score"], ["Quality score", "quality_score"], ["Safety index", "safety_index"],
    ["Compliance score", "compliance_score"], ["CAPA metrics", "open_capas"], ["Incident metrics", "critical_incidents"],
    ["Risk metrics", "high_risks"], ["Safety events", "patient_safety_events"],
  ];
  const dataQuality = dqDefs.map(([label, f]) => {
    const filled = recent.filter(s => s[f] != null).length;
    const pct = recent.length ? Math.round((filled / recent.length) * 100) : 0;
    return { label, pct, value: `${pct}%` };
  });

  // Report builder — saved definitions grouped by dataset.
  const { data: defRows } = await scope(admin.from("report_definitions").select("id, name, dataset, created_by_name, created_at").order("created_at", { ascending: false }).limit(2000));
  const defs = (defRows ?? []) as any[];
  const dsMap = new Map<string, number>();
  defs.forEach(d => { const key = d.dataset || "unknown"; dsMap.set(key, (dsMap.get(key) ?? 0) + 1); });
  const reportsByDataset = [...dsMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label: String(label).replace(/_/g, " "), value, tone: DS_TONE[i % DS_TONE.length] }));

  // Scheduled reports.
  const { data: schedRows } = await scope(admin.from("report_schedules").select("name, frequency, active, next_run_at, last_status").order("next_run_at", { ascending: true }).limit(500));
  const scheds = (schedRows ?? []) as any[];
  const scheduledActive = scheds.filter(s => s.active).length;

  // Reused live indicator intelligence (QAW-006) — active count + the real below-target list.
  let indicators: any = null;
  try { indicators = await loadIndicators(admin, hid, isSuper); } catch { indicators = null; }
  const indicatorsLive = !!(indicators && indicators.provisioned && !indicators.empty);
  const indicatorsTracked = indicatorsLive ? indicators.kpis.total : null;
  const topBelow = indicatorsLive ? (indicators.topBelow ?? []) : [];

  // Data-source tally — distinct wired stores that actually returned data.
  let auditCount = 0, capaCount = 0;
  try { const { count } = await scope(admin.from("audits").select("id", { count: "exact", head: true })); auditCount = count ?? 0; } catch { /* optional */ }
  try { const { count } = await scope(admin.from("capa_actions").select("id", { count: "exact", head: true })); capaCount = count ?? 0; } catch { /* optional */ }
  const dataSources = [snaps.length > 0, defs.length > 0, scheds.length > 0, indicatorsLive, auditCount > 0, capaCount > 0].filter(Boolean).length;

  return {
    provisioned: true as const,
    hasHistory,
    snapCount: snaps.length,
    kpis: {
      qualityScore: cur ? cur.quality : null,
      indicatorsTracked,
      reportsGenerated: defs.length,
      dataSources,
      alerts: cur ? cur.alerts : null,
      scheduledActive,
    },
    qualityTrend, domain, highlights, forecast, dataQuality,
    reportsByDataset, reportsTotal: defs.length,
    scheds, topBelow, indicatorsLive,
  };
}
