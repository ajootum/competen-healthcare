import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadExecutiveQuality } from "@/lib/operations/executive-quality";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, RiskHeat, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Executive Quality Command Centre (UMG-QS-010) — aligned to the high-fidelity spec + mockup. The governance /
// orchestration layer over the Quality & Safety domain (QS-001..009): composes loadExecutiveQuality (which folds
// loadQualityCommand + loadClinicalIndicators + accreditation + competency + the CAPA register). Real: the 7-score
// executive ribbon, AI-style executive summary + top risks, 6-month quality performance trend, strategic
// priorities (from the worst indicators), executive actions due, enterprise risk heat map, improvement portfolio,
// regulatory & accreditation overview and board-report list. Committee registry + board-pack generation are honest
// next-phase. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const band = (s: number | null) => (s == null ? "—" : s >= 85 ? "Good" : s >= 70 ? "In Progress" : s >= 60 ? "Moderate" : "At Risk");
const tone = (s: number | null) => (s == null ? "text-gray-400" : s >= 85 ? "text-emerald-600" : s >= 70 ? "text-amber-600" : "text-rose-600");
const riskBandPill: Record<string, string> = { critical: "bg-rose-100 text-rose-700", high: "bg-orange-100 text-orange-700", moderate: "bg-amber-100 text-amber-700", low: "bg-emerald-100 text-emerald-700" };
const riskWord: Record<string, string> = { critical: "High", high: "High", moderate: "Medium", low: "Low" };
const MONTHS: Record<string, string> = { "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };
const PORT_SEG = [{ key: "onTrack", label: "On Track", color: "#10b981" }, { key: "atRisk", label: "At Risk", color: "#f59e0b" }, { key: "delayed", label: "Delayed", color: "#ef4444" }, { key: "completed", label: "Completed", color: "#3b82f6" }, { key: "notStarted", label: "Not Started", color: "#cbd5e1" }];

function KpiCard({ icon, tint, label, value, unit, band: bd, bdTone, delta, deltaGood, sub }: { icon: string; tint: string; label: string; value: any; unit?: string; band?: string; bdTone?: string; delta?: number | null; deltaGood?: "up" | "down"; sub?: string }) {
  const good = delta != null && delta !== 0 ? ((delta > 0 && deltaGood === "up") || (delta < 0 && deltaGood === "down")) : null;
  return (
    <div className={`${qcard} p-3`}>
      <div className="flex items-center gap-2 mb-1"><span className={`w-7 h-7 rounded-lg ${tint} flex items-center justify-center text-sm shrink-0`}>{icon}</span><span className="text-[10px] text-gray-500 leading-tight">{label}</span></div>
      <div className="flex items-baseline gap-1.5"><p className="text-xl font-bold tabular-nums text-gray-900">{value}{unit && <span className="text-[11px] text-gray-400 font-normal">{unit}</span>}</p>{bd && <span className={`text-[10px] font-medium ${bdTone ?? "text-gray-400"}`}>{bd}</span>}</div>
      {delta != null ? <p className={`text-[10px] ${good == null ? "text-gray-400" : good ? "text-emerald-600" : "text-rose-600"}`}>{delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {Math.abs(delta)} vs last month</p> : sub ? <p className="text-[10px] text-gray-400">{sub}</p> : null}
    </div>
  );
}
function Gauge({ score }: { score: number | null }) {
  const s = score ?? 0; const col = s >= 85 ? "#10b981" : s >= 70 ? "#f59e0b" : "#ef4444";
  return <div className="relative" style={{ width: 150, height: 150 }}><div className="rounded-full w-full h-full" style={{ background: `conic-gradient(${col} ${s * 3.6}deg, #f1f5f9 0deg)` }} /><div className="absolute inset-[16px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-3xl font-bold tabular-nums" style={{ color: col }}>{score ?? "—"}%</span><span className="text-[10px] text-gray-400">Enterprise Quality Score</span><span className="text-[11px] font-medium mt-0.5" style={{ color: col }}>{band(score)}</span></div></div>;
}
function MultiLine({ months, series, meta, max = 100 }: { months: string[]; series: Record<string, number[]>; meta: { key: string; label: string; color: string }[]; max?: number }) {
  const W = 420, Hh = 150, pad = 8;
  const n = months.length;
  const x = (i: number) => n < 2 ? W / 2 : (i / (n - 1)) * (W - pad * 2 - 30) + pad;
  const y = (v: number) => Hh - 14 - (Math.max(0, Math.min(max, v)) / max) * (Hh - 28);
  return <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full" style={{ height: 190 }}>
    {[0, 25, 50, 75, 100].map(g => <g key={g}><line x1={0} x2={W - 30} y1={y(g)} y2={y(g)} stroke="#f1f5f9" strokeWidth="1" /><text x={W - 26} y={y(g) + 3} fontSize="8" fill="#cbd5e1">{g}</text></g>)}
    {meta.map(m => { const arr = series[m.key] ?? []; const pts = arr.map((v, i) => v == null ? null : `${x(i)},${y(v)}`).filter(Boolean).join(" "); const last = arr[arr.length - 1]; return <g key={m.key}><polyline points={pts} fill="none" stroke={m.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />{arr.map((v, i) => v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={m.color} />)}{last != null && <text x={W - 30} y={y(last) + 3} fontSize="9" fontWeight="600" fill={m.color}>{last}</text>}</g>; })}
  </svg>;
}
function SegDonut({ segments, center, sub }: { segments: { n: number; color: string }[]; center: any; sub?: string }) {
  const sum = segments.reduce((a, s) => a + s.n, 0) || 1;
  const active = segments.filter(s => s.n > 0);
  const grad = active.length ? `conic-gradient(${active.map((s, i) => { const b = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(b / sum) * 360}deg ${((b + s.n) / sum) * 360}deg`; }).join(", ")})` : "#e5e7eb";
  return <div className="relative shrink-0" style={{ width: 128, height: 128 }}><div className="rounded-full w-full h-full" style={{ background: grad }} /><div className="absolute inset-[17px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-2xl font-bold text-gray-900 tabular-nums">{center}</span>{sub && <span className="text-[10px] text-gray-400">{sub}</span>}</div></div>;
}

export default async function ExecutiveQualityCommandCentre() {
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
    loadExecutiveQuality(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-010" title="Executive Quality Command Centre" subtitle="Enterprise Quality Governance & Strategic Oversight" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Quality domain not provisioned</p><p className="text-sm text-amber-800 mt-1">The Executive Command Centre composes the Quality &amp; Safety domain (incidents / audits / CAPA / risk / indicators). Provision those stores to populate it.</p></div></div>;

  const k = d.kpis;
  const KPIS = [
    { icon: "🏆", tint: "bg-emerald-50", label: "Enterprise Quality Score", value: k.enterpriseQuality ?? "—", unit: "%", bd: band(k.enterpriseQuality), delta: k.enterpriseDelta, dg: "up" as const },
    { icon: "🛡️", tint: "bg-orange-50", label: "Patient Safety Score", value: k.patientSafety ?? "—", unit: "%", bd: band(k.patientSafety), delta: k.safetyDelta, dg: "up" as const },
    { icon: "🚨", tint: "bg-rose-50", label: "Risk Score", value: k.riskScore ?? "—", unit: "%", bd: band(k.riskScore), delta: k.riskDelta, dg: "up" as const },
    { icon: "📋", tint: "bg-violet-50", label: "Accreditation Score", value: k.accreditation ?? "—", unit: "%", bd: band(k.accreditation) },
    { icon: "💓", tint: "bg-sky-50", label: "Clinical Performance", value: k.clinical ?? "—", unit: "%", bd: band(k.clinical) },
    { icon: "👥", tint: "bg-teal-50", label: "Workforce Readiness", value: k.workforce ?? "—", unit: "%", bd: band(k.workforce) },
    { icon: "✅", tint: "bg-amber-50", label: "Executive Actions Due", value: k.actionsDue, sub: "Due within 7 days" },
  ];
  const months = d.trend.months.map((m: string) => MONTHS[m] ?? m);
  const trendMeta = [{ key: "quality", label: "Quality", color: "#10b981" }, { key: "safety", label: "Safety", color: "#f59e0b" }, { key: "compliance", label: "Compliance", color: "#3b82f6" }];

  return (
    <div className="space-y-4">
      {header}

      {/* Executive KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5">
        {KPIS.map(kp => <KpiCard key={kp.label} icon={kp.icon} tint={kp.tint} label={kp.label} value={kp.value} unit={kp.unit} band={kp.bd} bdTone={tone(typeof kp.value === "number" ? kp.value : null)} delta={kp.delta} deltaGood={kp.dg} sub={kp.sub} />)}
      </div>

      {/* Executive summary · quality performance trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm">Executive Summary</h3>
          <p className="text-[10px] text-gray-400 mb-3">AI-generated briefing based on enterprise data</p>
          <div className="flex gap-4 flex-wrap">
            <div className="flex flex-col items-center shrink-0"><Gauge score={d.summary.score} /></div>
            <div className="flex-1 min-w-[140px] space-y-1.5">{d.summary.bullets.map((b: string, i: number) => <p key={i} className="text-[11px] text-gray-600 flex gap-1.5"><span className="text-emerald-500 mt-0.5">●</span><span>{b}</span></p>)}</div>
            <div className="w-40 shrink-0 bg-gray-50 rounded-lg p-2.5">
              <p className="text-[10px] font-semibold text-gray-500 mb-1.5">Top Risks</p>
              <div className="space-y-1">{d.summary.topRisks.map((r: any, i: number) => (<div key={i} className="flex items-center justify-between gap-1"><span className="text-[10px] text-gray-600 truncate">{r.title}</span><span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${riskBandPill[r.band] ?? riskBandPill.low}`}>{riskWord[r.band] ?? "Low"}</span></div>))}{!d.summary.topRisks.length && <p className="text-[10px] text-gray-400">No open risks.</p>}</div>
            </div>
          </div>
        </div>

        <div className={`${qcard} p-5`}>
          <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-gray-900 text-sm">Quality Performance Trend</h3><div className="flex gap-2">{trendMeta.map(m => <span key={m.key} className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full" style={{ background: m.color }} />{m.label}</span>)}</div></div>
          {d.trend.months.length >= 2 ? <>
            <MultiLine months={months} series={{ quality: d.trend.quality, safety: d.trend.safety, compliance: d.trend.compliance }} meta={trendMeta} />
            <div className="flex justify-between text-[9px] text-gray-400 px-1 pr-8">{months.map((m: string, i: number) => <span key={i}>{m}</span>)}</div>
          </> : <p className="text-[11px] text-gray-400 py-8 text-center">Trend accrues from daily quality snapshots — building.</p>}
        </div>
      </div>

      {/* Strategic priorities · executive actions · committee */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Strategic Priorities</h3>
          <div className="space-y-2.5">{d.strategicPriorities.map((p: any) => (
            <div key={p.rank} className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center text-[10px] font-semibold text-gray-500 shrink-0">{p.rank}</span>
              <div className="flex-1 min-w-0"><p className="text-[11px] text-gray-700 truncate">{p.name}</p><div className="h-1.5 bg-gray-100 rounded overflow-hidden mt-0.5"><div className="h-full rounded" style={{ width: `${p.progress}%`, background: p.status === "On Track" ? "#10b981" : "#f59e0b" }} /></div></div>
              <span className="text-[10px] tabular-nums text-gray-500 w-8 text-right">{p.progress}%</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${p.status === "On Track" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{p.status}</span>
            </div>
          ))}{!d.strategicPriorities.length && <p className="text-[11px] text-gray-400">No priorities derived.</p>}</div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Executive Actions Due</h3>
          <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1 font-medium">Action</th><th className="py-1 font-medium">Owner</th><th className="py-1 font-medium">Due</th><th className="py-1 font-medium">Status</th></tr></thead>
            <tbody>{d.actions.map((a: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-1.5 text-gray-700 max-w-[120px] truncate" title={a.action}>{a.action}</td><td className="py-1.5 text-gray-500">{a.owner}</td><td className="py-1.5 text-gray-500 tabular-nums">{a.due}</td><td className="py-1.5"><span className={`text-[9px] px-1.5 py-0.5 rounded ${a.dueSoon ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{a.dueSoon ? "Due Soon" : a.status.replace(/_/g, " ")}</span></td></tr>))}{!d.actions.length && <tr><td colSpan={4} className="py-6 text-center text-gray-400">No actions due.</td></tr>}</tbody></table></div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Committee Overview</h3>
          <NextPhase>The governance-committee registry (meetings, agendas, minutes, attendance, action tracking) needs its own store — next-phase. Committee actions currently live in the CAPA &amp; improvement register.</NextPhase>
          <CrossLink href="/unit-manager/capa">Open CAPA &amp; Improvement →</CrossLink>
        </div>
      </div>

      {/* Risk heat · portfolio · regulatory · board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Enterprise Risk Heat Map</h3>
          <p className="text-[10px] text-gray-400 mb-2">{d.riskTotals.high + d.riskTotals.extreme} high/extreme of {d.riskTotals.total}</p>
          {d.riskHeat ? <RiskHeat count={(l: number, im: number) => d.riskHeat[l - 1]?.[im - 1] ?? 0} /> : <p className="text-[11px] text-gray-400 py-6 text-center">No risk register data.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Improvement Portfolio</h3>
          {d.portfolio ? <div className="flex items-center gap-3">
            <SegDonut segments={PORT_SEG.map(s => ({ n: d.portfolio[s.key], color: s.color }))} center={d.portfolio.total} sub="Projects" />
            <div className="space-y-1 text-[10px] flex-1">{PORT_SEG.map(s => (<div key={s.key} className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label}</span><span className="tabular-nums text-gray-500">{d.portfolio[s.key]} ({d.portfolio.total ? Math.round((d.portfolio[s.key] / d.portfolio.total) * 100) : 0}%)</span></div>))}</div>
          </div> : <p className="text-[11px] text-gray-400 py-6 text-center">No improvement projects.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Regulatory &amp; Accreditation</h3>
          {d.regulatory.length ? <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1 font-medium">Standard</th><th className="py-1 font-medium">Status</th><th className="py-1 font-medium text-right">Compliance</th></tr></thead>
            <tbody>{d.regulatory.map((r: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-1.5 text-gray-700 max-w-[110px] truncate">{r.name}</td><td className="py-1.5"><span className={`text-[9px] px-1.5 py-0.5 rounded ${r.status === "Compliant" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{r.status}</span></td><td className="py-1.5 text-right tabular-nums text-gray-600">{r.compliance != null ? `${r.compliance}%` : "—"}</td></tr>))}</tbody></table></div> : <NextPhase>Regulatory framework readiness comes from the Accreditation store — provision it (migration 019/061) to populate.</NextPhase>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Board Reporting</h3>
          <div className="space-y-1.5">{d.boardReports.map((r: any, i: number) => (<div key={i} className="flex items-center justify-between text-[11px]"><span className="flex items-center gap-1.5 text-gray-700"><span className="text-gray-300">📄</span>{r.name}</span><span className="text-[9px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{r.fmt}</span></div>))}</div>
          <p className="text-[9px] text-gray-300 mt-2">Board-pack generation + publication workflow are next-phase.</p>
        </div>
      </div>

      {/* Quick links */}
      <div className={`${qcard} p-4`}>
        <div className="flex items-center gap-2 flex-wrap"><span className="text-[11px] font-semibold text-gray-500 mr-2">Quick Links</span>
          {[["Incident (QS-002)", "/unit-manager/quality/incidents"], ["Audit (QS-003)", "/unit-manager/quality/audits"], ["CAPA (QS-004)", "/unit-manager/capa"], ["Risk (QS-006)", "/unit-manager/quality/risk"], ["Clinical Indicators (QS-008)", "/unit-manager/quality/indicators"], ["Mortality (QS-009)", "/unit-manager/quality/mortality"]].map(([l, h]) => <a key={h} href={h} className="text-[10px] font-medium text-indigo-700 border border-indigo-100 rounded-lg px-2 py-1 hover:bg-indigo-50">{l}</a>)}
        </div>
      </div>

      <NextPhase>Executive Quality Command Centre (UMG-QS-010) composes the Quality &amp; Safety domain (QS-001..009) via loadExecutiveQuality (loadQualityCommand + clinical indicators + accreditation + competency + CAPA register). Live: the 7-score executive ribbon (with real month-over-month deltas from the quality-score snapshot history), the executive summary + top risks, the 6-month quality performance trend, strategic priorities (from the worst indicators), executive actions due, the enterprise risk heat map, the improvement portfolio, and the regulatory overview. Honest next-phase: the governance-committee registry (meetings / minutes / attendance / voting), automated board-pack generation + publication workflow, the strategic-priorities objectives engine, and the enterprise data explorer. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
