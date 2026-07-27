import Link from "next/link";
import { loadAnalyticsHub } from "@/lib/analytics-hub";
import { cmoGuard, Head, Card, Kpi, Pill, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// COMP-012 Competency Analytics & Intelligence Framework — enterprise insight over ONE governed competency
// data model (a reframe of CMO-006 onto the shared CMO kit; loadAnalyticsHub is unchanged). Real: the KPI
// catalogue (readiness, mandatory compliance, assessment pass rate, credential validity + a composite org
// index), competency heatmap by unit, readiness by domain, the readiness trend (daily snapshots, migration
// 088), rule-based explainable AI insights and predictive trend signals. Honest next-phase: time-to-
// competency / reassessment / unit-capability KPIs (need cycle timing + a capability model), per-role layer
// switching, configurable KPI definitions, external benchmarking and drill-down/export.
/* eslint-disable @typescript-eslint/no-explicit-any */

const pctTone = (n: number) => (n >= 90 ? "text-emerald-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const cellTone = (n: number) => (n >= 90 ? "bg-emerald-500" : n >= 80 ? "bg-amber-400" : n >= 70 ? "bg-orange-400" : "bg-rose-500");

function Line({ series, color }: { series: number[]; color: string }) {
  const nums = (series ?? []).map(Number);
  if (nums.length < 2) return <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center"><p className="text-xs text-gray-400">Readiness trend builds from daily snapshots — appears once ≥2 days are recorded (per-hospital).</p></div>;
  const w = 300, h = 90, max = Math.max(...nums), min = Math.min(...nums), range = (max - min) || 1;
  const pts = nums.map((v, i) => `${(i / (nums.length - 1)) * w},${h - ((v - min) / range) * (h - 10) - 5}`).join(" ");
  return <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" /></svg>;
}

// The competency data model is surfaced role-by-role — the layers COMP-012 governs.
const ROLE_LAYERS: { label: string; tone: string }[] = [
  { label: "Healthcare Worker", tone: "slate" },
  { label: "Assessor", tone: "blue" },
  { label: "Educator", tone: "teal" },
  { label: "Supervisor", tone: "violet" },
  { label: "Unit Manager", tone: "amber" },
  { label: "Director", tone: "emerald" },
  { label: "Competency Office", tone: "teal" },
  { label: "Executive", tone: "rose" },
];

export default async function CompetencyAnalytics() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadAnalyticsHub(admin, hid, isSuper);
  const head = <Head code="COMP-012 · Competency Office" title="Competency Analytics & Intelligence" sub="Enterprise insight from a single governed competency data model — operational, managerial and executive." />;

  if (!d.ready) return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">Competency analytics activate once competency decisions are recorded for this tenant.</p></div>
    </div>
  );

  // Org Competency Index — composite of the AVAILABLE real sub-scores (readiness & compliance always present;
  // assessment & credential only when their stores hold data). Derived from real values, not fabricated.
  const subScores = [d.readiness, d.compliance, d.assessmentSuccess, d.credentialValidity].filter((v): v is number => v != null).map(Number);
  const orgIndex = subScores.length ? Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length) : null;

  // Predictive trend signals — real day-over-day deltas from the readiness snapshots (rule-based detection).
  const t = d.trends;
  const hasTrend = !!(t && t.points >= 2);
  const signals: { label: string; delta: number | null; invert?: boolean }[] = hasTrend ? [
    { label: "Readiness", delta: t.readiness?.delta ?? null },
    { label: "Compliance", delta: t.compliance?.delta ?? null },
    { label: "Expiring ≤30d", delta: t.expiring?.delta ?? null, invert: true },
    { label: "At-risk units", delta: t.atRisk?.delta ?? null, invert: true },
  ] : [];

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}

      {/* KPI catalogue — COMP-012 metrics mapped to real loadAnalyticsHub fields; honest "—" where no source. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Competency Completion" value={`${d.readiness}%`} tone={pctTone(Number(d.readiness))} sub="workforce competencies current" />
        <Kpi label="Assessment Pass Rate" value={d.assessmentSuccess != null ? `${d.assessmentSuccess}%` : "—"} tone={d.assessmentSuccess != null ? pctTone(Number(d.assessmentSuccess)) : "text-gray-300"} sub={d.assessmentSuccess != null ? "scored assessments" : "no scored data"} />
        <Kpi label="Mandatory Compliance" value={`${d.compliance}%`} tone={pctTone(Number(d.compliance))} sub="validated & current" />
        <Kpi label="Credential Validity" value={d.credentialValidity != null ? `${d.credentialValidity}%` : "—"} tone={d.credentialValidity != null ? pctTone(Number(d.credentialValidity)) : "text-gray-300"} sub={d.credentialValidity != null ? "verified & in-date" : "no credential records"} />
        <Kpi label="Org Competency Index" value={orgIndex != null ? `${orgIndex}%` : "—"} tone={orgIndex != null ? pctTone(orgIndex) : "text-gray-300"} sub={orgIndex != null ? `composite · ${subScores.length} live sub-scores` : "—"} />
        <Kpi label="Time-to-Competency" value="—" tone="text-gray-300" sub="needs cycle timing" />
        <Kpi label="Reassessment Compliance" value="—" tone="text-gray-300" sub="needs reassessment scheduling" />
        <Kpi label="Unit Capability Index" value="—" tone="text-gray-300" sub="needs unit capability model" />
      </div>

      {/* Heatmap + domain + trend */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Competency Heatmap" right={<span className="text-[11px] text-gray-400">by unit</span>}>
          {d.heatmap.length === 0 ? <p className="text-sm text-gray-400">No unit readiness data yet.</p> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{d.heatmap.slice(0, 9).map((u: any) => (<div key={u.id} className={`rounded-lg p-2.5 text-white ${cellTone(Number(u.pct))}`}><p className="text-[10px] font-medium truncate opacity-90">{u.name}</p><p className="text-lg font-bold tabular-nums">{u.pct}%</p></div>))}</div>
          )}
        </Card>

        <Card title="Readiness by Domain">
          {d.domains.length === 0 ? <p className="text-sm text-gray-400">Domain mapping needed.</p> : (
            <div className="space-y-2">{d.domains.map((dom: any) => (<div key={dom.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{dom.name}</span><span className={`tabular-nums font-semibold ${pctTone(Number(dom.pct))}`}>{dom.pct}%</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${cellTone(Number(dom.pct))}`} style={{ width: `${dom.pct}%` }} /></div></div>))}</div>
          )}
        </Card>

        <Card title="Readiness Trend" right={<span className="text-[11px] text-gray-400">daily snapshots</span>}>
          <Line series={d.trends?.readiness?.series ?? []} color="#10b981" />
        </Card>
      </div>

      {/* Risk matrix + AI & predictive intelligence */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Risk Matrix" right={<span className="text-[11px] text-gray-400">units below 70%</span>}>
          {d.highRiskUnits.length === 0 ? <p className="text-sm text-gray-400">No high-risk units. 🎉</p> : (
            <div className="space-y-1.5">{d.highRiskUnits.slice(0, 8).map((u: any) => (<div key={u.id} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate">{u.name}</span><span className="flex items-center gap-2"><span className="text-rose-600 font-semibold tabular-nums">{u.pct}%</span><span className="text-gray-400">({u.current}/{u.total})</span></span></div>))}</div>
          )}
        </Card>

        <Card title="AI & Predictive Intelligence" right={<span className="text-[11px] text-gray-400">rule-based · explainable</span>}>
          {hasTrend ? (
            <div className="grid grid-cols-2 gap-2 mb-3">{signals.map((s) => {
              const has = s.delta != null, dv = Number(s.delta), flat = !has || dv === 0;
              const good = has && !flat && (s.invert ? dv < 0 : dv > 0);
              const tone = flat ? "text-gray-400" : good ? "text-emerald-600" : "text-rose-600";
              const arrow = !has ? "" : dv > 0 ? "▲" : dv < 0 ? "▼" : "▬";
              return <div key={s.label} className="border border-gray-100 rounded-lg px-2.5 py-1.5"><p className="text-[10px] text-gray-500 truncate">{s.label}</p><p className={`text-sm font-semibold tabular-nums ${tone}`}>{arrow} {has ? Math.abs(dv) : "—"}</p></div>;
            })}</div>
          ) : (
            <p className="text-[11px] text-gray-400 mb-3">Trend detection appears once ≥2 daily snapshots are recorded (per-hospital).</p>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-600 mb-3"><span className="font-medium text-gray-500">Expiry forecast:</span><span className="tabular-nums">{d.expiring.d30} ≤30d</span><span className="text-gray-300">·</span><span className="tabular-nums">{d.expiring.d60} ≤60d</span><span className="text-gray-300">·</span><span className="tabular-nums">{d.expiring.d90} ≤90d</span><span className="text-gray-400">({d.expiring.individuals} staff)</span></div>

          {d.ai.length === 0 ? <p className="text-sm text-gray-400">No priority insights right now.</p> : (
            <div className="space-y-2">{d.ai.slice(0, 4).map((a: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs text-gray-800 flex-1">{a.text}</p><Pill text={a.priority} tone={a.priority === "high" ? "rose" : a.priority === "medium" ? "amber" : "slate"} /></div><p className="text-[10px] text-gray-400 mt-1">Why: {a.why}</p></div>))}</div>
          )}

          <p className="text-[10px] text-gray-400 mt-3">Risk prediction, expiry forecasting and trend detection are rule-based and explainable — not ML. Capability-gap prediction and ML-based forecasting are the next phase.</p>
        </Card>
      </div>

      {/* Analytics modules + role layers */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Analytics Modules" className="xl:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {d.modules.map((m: any) => (<Link key={m.name} href={m.href} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors"><span className="truncate">{m.name}</span><span className="text-gray-300">→</span></Link>))}
          </div>
        </Card>

        <Card title="Analytics Layers">
          <div className="flex flex-wrap gap-1.5">{ROLE_LAYERS.map((r) => <Pill key={r.label} text={r.label} tone={r.tone} />)}</div>
          <p className="text-[11px] text-gray-400 mt-3">One governed competency model surfaced role-by-role. Per-role layer switching, configurable KPI definitions, external benchmarking and drill-down/export are the next phase.</p>
        </Card>
      </div>

      <Foot>COMP-012 — live over loadAnalyticsHub across one governed competency data model: overall readiness, mandatory compliance, assessment pass rate, credential validity, the composite org index, competency heatmap by unit, readiness by domain, the readiness trend (daily snapshots, migration 088) and rule-based explainable AI insights + predictive trend signals. Forecasts are rule-based, not ML. Time-to-competency / reassessment / unit-capability KPIs, per-role layer switching, configurable KPI definitions, external benchmarking and drill-down/export are honest next-phase.</Foot>
    </div>
  );
}
