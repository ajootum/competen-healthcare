import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadLearningAnalytics } from "@/lib/operations/learning-analytics";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import LearningTabs from "../LearningTabs";
import AiInsights from "./AiInsights";

export const dynamic = "force-dynamic";

// Learning Analytics & Intelligence Centre (LDS-006) — the enterprise analytics + AI intelligence layer over
// the whole Learning & Development suite. A consolidation surface (spec §6): it composes the authoritative
// LDS-002..005 + CMO loaders — no new store. Real: the six health KPIs, the composite Learning Health Score,
// the capability radar, the competency-coverage heatmap (domain × Benner maturity), audience-bucketed AI
// recommendations and the compliance-risk table. Honest next-phase: the learning-event stream (logins /
// study minutes / videos, §9) and the persisted analytics_snapshots history full trend sparklines need.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const heatColor = (pct: number) => (pct >= 60 ? "bg-[var(--cmp-color-success)]/80 text-white" : pct >= 40 ? "bg-[var(--cmp-color-success)]/60 text-emerald-900" : pct >= 20 ? "bg-amber-300/60 text-amber-900" : pct > 0 ? "bg-orange-300/50 text-orange-900" : "bg-gray-50 text-gray-300");
const MAT_LABEL = ["Novice", "Advanced Beginner", "Competent", "Proficient", "Expert"];

// Single-value conic ring.
function Ring({ pct, color, center, sub }: { pct: number; color: string; center: string; sub?: string }) {
  return (
    <div className="relative w-[104px] h-[104px] shrink-0" style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, #f1f5f9 0)`, borderRadius: "9999px" }}>
      <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-gray-900 tabular-nums leading-none">{center}</span>
        {sub && <span className="text-[10px] font-medium mt-0.5" style={{ color }}>{sub}</span>}
      </div>
    </div>
  );
}

// Multi-segment donut from [{value, color}] with a centre label.
function SegDonut({ segments, center, sub }: { segments: { value: number; color: string }[]; center: string; sub?: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1;
  const active = segments.filter(s => s.value > 0);
  // Prefix-sum the arc offsets purely (no render-scope reassignment) so each segment starts where the previous ended.
  const grad = active.length
    ? `conic-gradient(${active.map((s, i) => { const before = active.slice(0, i).reduce((n, x) => n + x.value, 0); return `${s.color} ${(before / total) * 360}deg ${((before + s.value) / total) * 360}deg`; }).join(", ")})`
    : "conic-gradient(#f1f5f9 0deg 360deg)";
  return (
    <div className="relative w-[104px] h-[104px] shrink-0" style={{ background: grad, borderRadius: "9999px" }}>
      <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-gray-900 tabular-nums leading-none">{center}</span>
        {sub && <span className="text-[10px] text-gray-400 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

function Spark({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2) return null;
  const max = Math.max(...series, 1), min = Math.min(...series, 0);
  const rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${28 - ((v - min) / rng) * 26}`).join(" ");
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="w-full h-7"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

function Delta({ v, invert }: { v: number | null | undefined; invert?: boolean }) {
  if (v == null || v === 0) return <span className="text-[11px] text-gray-400">—</span>;
  const good = invert ? v < 0 : v > 0;
  return <span className={`text-[11px] font-medium ${good ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{v > 0 ? "↑" : "↓"} {Math.abs(v)}</span>;
}

// Capability radar — the five/six LDS pillars as real 0-100 axes.
function Radar({ data }: { data: { axis: string; value: number }[] }) {
  const cx = 130, cy = 120, R = 88, n = data.length;
  const ang = (i: number) => (-90 + (360 / n) * i) * (Math.PI / 180);
  const pt = (i: number, r: number) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  const poly = data.map((d, i) => pt(i, (Math.max(0, Math.min(100, d.value)) / 100) * R).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox="0 0 260 220" className="w-full max-w-[320px] mx-auto">
      {rings.map((f, ri) => <polygon key={ri} points={data.map((_, i) => pt(i, R * f).join(",")).join(" ")} fill="none" stroke="#e5e7eb" strokeWidth="1" />)}
      {data.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" strokeWidth="1" />; })}
      <polygon points={poly} fill="rgba(139,92,246,0.18)" stroke="#8b5cf6" strokeWidth="2" />
      {data.map((d, i) => { const [x, y] = pt(i, (Math.max(0, Math.min(100, d.value)) / 100) * R); return <circle key={i} cx={x} cy={y} r="2.5" fill="#8b5cf6" />; })}
      {data.map((d, i) => { const [x, y] = pt(i, R + 14); return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-gray-500" style={{ fontSize: 9 }}>{d.axis}</text>; })}
    </svg>
  );
}

function KStat({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return <div className="flex items-center justify-between gap-2 py-1"><span className="text-xs text-gray-500">{label}</span><span className="text-sm font-semibold text-gray-900 tabular-nums">{value}{sub && <span className="text-[10px] text-gray-400 font-normal ml-1">{sub}</span>}</span></div>;
}

export default async function LearningAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments] = await Promise.all([
    loadLearningAnalytics(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Learning Analytics &amp; Intelligence</h1><p className="text-sm text-gray-500">Transforming learning data into actionable intelligence · {d.scope} scope</p></div>
        <UnitFilters departments={departments} />
      </div>
      <LearningTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Learning analytics warming up</p><p className="text-sm text-amber-800 mt-1">This intelligence layer consolidates mandatory learning, competency, professional development, career progression and education planning. Once any of those has live data, the dashboards populate automatically.</p></div></div>;

  // Real average maturity (/5) from the coverage heatmap.
  const heat = d.heatmap;
  const matAgg = heat.rows.reduce((acc: any, r: any) => { r.cells.forEach((c: any, i: number) => { acc.sum += c.count * (i + 1); acc.n += c.count; }); return acc; }, { sum: 0, n: 0 });
  const avgMaturity = matAgg.n ? matAgg.sum / matAgg.n : null;
  const matBand = avgMaturity == null ? "—" : MAT_LABEL[Math.max(0, Math.min(4, Math.round(avgMaturity) - 1))];

  const health = d.health, mand = d.mandatory, comp = d.competency, pro = d.professional, car = d.career, edu = d.education;
  const healthColor = health.score >= 85 ? "#10b981" : health.score >= 70 ? "#22c55e" : health.score >= 55 ? "#f59e0b" : "#ef4444";

  return (
    <div className="space-y-4">
      {header}

      {/* ── Six health KPI cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {/* Learning Health Score */}
        <div className={`${card} p-4`}>
          <p className="text-xs font-medium text-gray-500 mb-2">Learning Health Score</p>
          {health.hasData ? (
            <div className="flex items-center gap-4">
              <Ring pct={health.score} color={healthColor} center={`${health.score}%`} sub={health.band} />
              <div className="min-w-0 text-[11px] text-gray-500 space-y-0.5">{health.components.map((c: any) => <div key={c.label} className="flex items-center justify-between gap-2"><span className="truncate">{c.label}</span><b className="tabular-nums text-gray-700">{c.value}%</b></div>)}</div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6">Awaiting live learning data.</p>}
        </div>

        {/* Mandatory Learning Compliance */}
        <div className={`${card} p-4`}>
          <p className="text-xs font-medium text-gray-500 mb-2">Mandatory Learning Compliance</p>
          {mand.provisioned ? (
            <div className="flex items-center gap-4">
              <SegDonut center={`${mand.compliance}%`} sub="compliant" segments={[{ value: mand.donut.compliant, color: "#10b981" }, { value: mand.donut.dueSoon, color: "#f59e0b" }, { value: mand.donut.overdue, color: "#ef4444" }, { value: mand.donut.notStarted, color: "#94a3b8" }, { value: mand.donut.exempt, color: "#e2e8f0" }]} />
              <div className="text-[11px] text-gray-600 space-y-1">
                <Legend color="#10b981" label="Completed" v={mand.donut.compliant} />
                <Legend color="#f59e0b" label="Due soon" v={mand.donut.dueSoon} />
                <Legend color="#ef4444" label="Overdue" v={mand.donut.overdue} />
                <Legend color="#94a3b8" label="Not started" v={mand.donut.notStarted} />
                <p className="text-[10px] text-gray-400 pt-0.5">{mand.totalLearners} learners</p>
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6">No mandatory enrolments yet — assign via <Link href="/unit-manager/learning/assign" className="text-emerald-700 hover:underline">Assign Learning</Link>.</p>}
        </div>

        {/* Competency Progress */}
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between"><p className="text-xs font-medium text-gray-500">Competency Progress</p>{comp.trend?.delta != null && <Delta v={comp.trend.delta} />}</div>
          {comp.ready ? (
            <div className="mt-2">
              <div className="flex items-end gap-2"><span className="text-3xl font-bold text-gray-900 tabular-nums leading-none">{avgMaturity != null ? avgMaturity.toFixed(2) : `${comp.readiness}%`}</span>{avgMaturity != null && <span className="text-sm text-gray-400 mb-0.5">/ 5</span>}</div>
              <p className="text-xs font-medium text-violet-600 mt-1">{avgMaturity != null ? matBand : "Readiness"}</p>
              {comp.trend?.series?.length >= 2 ? <div className="mt-1"><Spark series={comp.trend.series} color="#8b5cf6" /></div> : <p className="text-[10px] text-gray-400 mt-2">Readiness {comp.readiness}% · validated {comp.complianceScore}%</p>}
            </div>
          ) : <p className="text-sm text-gray-400 py-6">No competency decisions yet.</p>}
        </div>

        {/* Professional Development */}
        <div className={`${card} p-4`}>
          <p className="text-xs font-medium text-gray-500 mb-2">Professional Development</p>
          {pro.provisioned ? (
            <div className="mt-1">
              <KStat label="CPD points (YTD)" value={pro.points} />
              <KStat label="Activities approved" value={pro.approved} />
              <KStat label="Awaiting validation" value={pro.awaiting} />
              <KStat label="Avg / staff" value={pro.avgPerStaff} sub={`of ${pro.target}`} />
              <KStat label="Meeting target" value={pro.meetingTarget} sub={`/ ${pro.activeLearners}`} />
              {pro.monthlyTrend.some((v: number) => v > 0) && <div className="mt-1"><Spark series={pro.monthlyTrend} color="#0ea5e9" /></div>}
            </div>
          ) : <p className="text-sm text-gray-400 py-6">No CPD logged this year.</p>}
        </div>

        {/* Career Progress */}
        <div className={`${card} p-4`}>
          <p className="text-xs font-medium text-gray-500 mb-2">Career Progress</p>
          {car.ready ? (
            <div className="flex items-center gap-4">
              <Ring pct={car.readiness} color="#8b5cf6" center={`${car.readiness}%`} sub={car.band} />
              <div className="text-[11px] text-gray-600 space-y-1">
                <Legend color="#10b981" label="Fully deployable" v={car.bands.fullyDeployable} />
                <Legend color="#f59e0b" label="Renewal due" v={car.bands.renewalDue} />
                <Legend color="#ef4444" label="Awaiting renewal" v={car.bands.awaitingRenewal} />
                <Legend color="#94a3b8" label="Awaiting validation" v={car.bands.awaitingValidation} />
                <p className="text-[10px] text-gray-400 pt-0.5">{car.progressionReady} progression-ready</p>
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6">Readiness pending competency data.</p>}
        </div>

        {/* Education Plan Progress */}
        <div className={`${card} p-4`}>
          <p className="text-xs font-medium text-gray-500 mb-2">Education Plan Progress</p>
          {edu.hasData ? (
            <div className="flex items-center gap-4">
              <Ring pct={edu.avgProgress} color="#14b8a6" center={`${edu.avgProgress}%`} sub="on track" />
              <div className="text-[11px] text-gray-600 space-y-1">
                <Legend color="#14b8a6" label="Milestones done" v={`${edu.milestonesCompleted}/${edu.milestonesTotal}`} />
                <Legend color="#0ea5e9" label="Active plans" v={edu.activePlans} />
                <Legend color="#ef4444" label="Plans at risk" v={edu.plansAtRisk} />
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6">No education plans yet — start one in <Link href="/unit-manager/learning/schedule" className="text-emerald-700 hover:underline">Education Planning</Link>.</p>}
        </div>
      </div>

      {/* ── Activity roll-up + capability radar + coverage heatmap ────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Learning activity (real counts) */}
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Learning Activity</h3>
          <div className="space-y-1">
            <KStat label="Assignments issued" value={d.engagement.assignmentsIssued} />
            <KStat label="Learners tracked" value={d.engagement.learners} />
            <KStat label="Completions" value={d.engagement.completions} />
            <KStat label="CPD activities logged" value={d.engagement.cpdActivities} />
            <KStat label="Assessments today" value={d.engagement.assessmentsToday} />
            <KStat label="Validation queue" value={d.engagement.validationQueue} />
          </div>
          <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">Engagement events (daily logins, study minutes, videos watched, simulations) require the learning-event stream — a next-phase store (spec §9).</p>
        </div>

        {/* Learning effectiveness radar */}
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Learning Effectiveness</h3>
          <p className="text-[10px] text-gray-400 mb-1">Capability across the L&amp;D pillars (0–100)</p>
          <Radar data={d.radar} />
        </div>

        {/* Competency coverage heatmap */}
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Learning Heatmap <span className="text-[10px] text-gray-400 font-normal">competency coverage</span></h3>
          {heat.provisioned && heat.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-separate" style={{ borderSpacing: "2px" }}>
                <thead><tr><th className="text-left font-medium text-gray-400 pr-2"></th>{heat.levels.map((l: string) => <th key={l} className="font-medium text-gray-400 px-1 pb-1 whitespace-nowrap">{l}</th>)}</tr></thead>
                <tbody>{heat.rows.map((r: any) => (
                  <tr key={r.domain}><td className="text-gray-600 pr-2 whitespace-nowrap max-w-[110px] truncate" title={r.domain}>{r.domain}</td>{r.cells.map((c: any) => <td key={c.level} className={`text-center rounded font-medium tabular-nums ${heatColor(c.pct)}`} style={{ minWidth: 34, height: 22 }} title={`${c.count} at ${c.level}`}>{c.pct ? `${c.pct}%` : ""}</td>)}</tr>
                ))}</tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Share of each domain&apos;s achieved competencies at each Benner maturity band.</p>
            </div>
          ) : <p className="text-sm text-gray-400 py-6">No graded competency decisions with a maturity band yet.</p>}
        </div>
      </div>

      {/* ── AI insights + compliance risk ────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <AiInsights items={d.ai} />

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-[var(--cmp-surface-error)] flex items-center justify-center text-sm">⚠️</span><h3 className="font-semibold text-gray-900 text-sm">Compliance Risk Alert</h3></div>
          {d.risks.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Risk</th><th className="py-1.5 font-medium">Area</th><th className="py-1.5 font-medium text-right">Affected</th><th className="py-1.5 font-medium text-right">Score</th><th className="py-1.5 font-medium text-right">Window</th></tr></thead>
                <tbody>{d.risks.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2"><span className={`inline-flex items-center gap-1 font-medium ${r.level === "High" ? "text-[var(--cmp-text-error)]" : r.level === "Medium" ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"}`}><span className={`w-1.5 h-1.5 rounded-full ${r.level === "High" ? "bg-[var(--cmp-color-error)]" : r.level === "Medium" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-success)]"}`} />{r.level}</span></td>
                    <td className="py-2 text-gray-700 max-w-[180px] truncate" title={r.area}>{r.area}<span className="block text-[10px] text-gray-400">{r.kind}</span></td>
                    <td className="py-2 text-right tabular-nums text-gray-700">{r.affected}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-gray-800">{r.score}%</td>
                    <td className="py-2 text-right text-gray-500">{r.due}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No active compliance risks. 🎉</p>}
        </div>
      </div>

      {/* ── Recent activity ──────────────────────────────────────────────────── */}
      {d.activity.length > 0 && (
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Recent Learning &amp; Competency Activity</h3>
          <div className="space-y-1.5">{d.activity.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-gray-50 last:border-0">
              <span className="text-gray-700 truncate">{(a.action ?? "").replace(/_/g, " ")}</span>
              <span className="text-gray-400 shrink-0">{a.actor?.full_name ?? "System"} · {(a.created_at ?? "").slice(0, 10)}</span>
            </div>
          ))}</div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 pb-4">Learning Analytics &amp; Intelligence Centre (LDS-006) — a consolidation layer composing Mandatory Learning (LDS-002), Professional Development (LDS-003), Career Pathways (LDS-004), Education Planning (LDS-005) and the competency spine (CMO). Real: the six health KPIs, the composite Learning Health Score, capability radar, competency-coverage heatmap (domain × Benner maturity), audience-bucketed AI recommendations and the compliance-risk table. Honest next-phase: the learning-event stream (daily logins / study minutes / videos, §9), pre/post assessment-gain analytics, and the persisted analytics-snapshot history full trend sparklines need. Data as of {d.asOf}.</p>
    </div>
  );
}

function Legend({ color, label, v }: { color: string; label: string; v: any }) {
  return <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} /><span className="text-gray-500">{label}</span><b className="ml-auto tabular-nums text-gray-700">{v}</b></div>;
}
