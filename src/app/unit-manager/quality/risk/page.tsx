import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRiskRegister } from "@/lib/operations/risk-register";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";

export const dynamic = "force-dynamic";

// Enterprise Risk Register (UMG-QS-006) — aligned to the detailed + UI specs and both mockups. Consolidation
// over gov_risks + gov_controls (060), hospital + platform-wide; no store forked. Real: the KPI ribbon,
// residual 5×5 heat map, top-10 by residual (with residual-vs-inherent trend), category distribution,
// treatment-plan status, controls effectiveness by type, reviews due, emerging + escalated risks, recent
// updates and AI insights. Honest next-phase (spec §8 entities with no store): per-risk score-trend graphs /
// "Risks Trending Up" (no RiskHistory), Risks by Department (no department field), "Escalated To" and
// treatment-task progress.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const LIKELIHOOD = ["Almost Certain", "Likely", "Possible", "Unlikely", "Rare"];
const CONSEQUENCE = ["Minor", "Moderate", "Major", "Severe", "Catastrophic"];
const cellTone = (score: number) => (score >= 16 ? "bg-rose-500 text-white" : score >= 10 ? "bg-orange-400 text-white" : score >= 5 ? "bg-amber-300 text-amber-900" : "bg-emerald-400/80 text-emerald-950");
const lvlTone = (l: string) => (l === "Extreme" ? "bg-rose-100 text-rose-700" : l === "High" ? "bg-orange-100 text-orange-700" : l === "Moderate" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700");
const QUICK = [
  { label: "New Risk", icon: "➕", tint: "bg-rose-50" }, { label: "Risk Assessment", icon: "📋", tint: "bg-sky-50" },
  { label: "Risk Matrix", icon: "🔲", tint: "bg-violet-50" }, { label: "Treatment Plan", icon: "🗂️", tint: "bg-teal-50" },
  { label: "Risk Report", icon: "📊", tint: "bg-indigo-50" }, { label: "Export Register", icon: "⬇️", tint: "bg-amber-50" },
  { label: "Controls Library", icon: "🛡️", tint: "bg-emerald-50" }, { label: "Emerging Risks", icon: "⭐", tint: "bg-orange-50" },
  { label: "Risk Calendar", icon: "📅", tint: "bg-pink-50" }, { label: "Risk Settings", icon: "⚙️", tint: "bg-gray-50" },
];

function Spark({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2 || series.every(v => v === series[0])) return <div className="h-5" />;
  const max = Math.max(...series), min = Math.min(...series), rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${18 - ((v - min) / rng) * 16}`).join(" ");
  return <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-5"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
function Kpi({ icon, tint, label, value, unit, sub, tone, spark, sparkColor }: any) {
  return (
    <div className={`${card} p-3.5`}>
      <div className="flex items-center gap-1.5 mb-1"><span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs shrink-0 ${tint}`}>{icon}</span><span className="text-[9px] font-medium text-gray-500 uppercase tracking-wide truncate">{label}</span></div>
      <div className={`text-xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}{unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}</div>
      {spark ? <div className="mt-0.5"><Spark series={spark} color={sparkColor} /></div> : sub && <div className="text-[9px] text-gray-400 mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}
function SegDonut({ segs, total, label }: { segs: { n: number; color: string }[]; total: number; label: string }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1;
  const active = segs.filter(s => s.n > 0);
  const grad = active.length ? `conic-gradient(${active.map((s, i) => { const before = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(before / sum) * 360}deg ${((before + s.n) / sum) * 360}deg`; }).join(", ")})` : "#f1f5f9";
  return <div className="relative w-28 h-28 shrink-0"><div className="w-28 h-28 rounded-full" style={{ background: grad }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center text-center"><span className="text-xl font-bold text-gray-900 leading-none">{total}</span><span className="text-[8px] text-gray-400 leading-tight px-1">{label}</span></div></div>;
}

export default async function RiskRegister() {
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
    loadRiskRegister(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center text-lg">🛡️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Enterprise Risk Register</h1><p className="text-sm text-gray-500">Identify, assess, monitor and mitigate risks to protect patients, people and operations</p></div></div>
        <div className="flex items-center gap-2"><UnitFilters departments={departments} /><Link href="/unit-manager/quality/risk" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">↻ Refresh</Link><Link href="/super-admin/governance/risk" className="text-xs bg-rose-600 text-white rounded-lg px-3 py-2 hover:bg-rose-700 font-medium">+ New Risk</Link></div>
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Risk register not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 060 (gov_risks / gov_controls) to enable the risk register.</p></div></div>;

  const k = d.kpis;

  return (
    <div className="space-y-4">
      {header}

      {/* ── KPI ribbon (7) ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5">
        <Kpi icon="📊" tint="bg-rose-50" label="Risk Exposure" value={k.exposurePct != null ? `${k.exposurePct}%` : "—"} tone={k.exposurePct != null && k.exposurePct >= 55 ? "text-rose-600" : "text-gray-900"} sub={k.exposureBand} />
        <Kpi icon="🔴" tint="bg-orange-50" label="High & Extreme" value={k.highExtreme} tone={k.highExtreme ? "text-rose-600" : "text-gray-400"} sub={`${k.extreme} extreme`} />
        <Kpi icon="🛠️" tint="bg-sky-50" label="Under Treatment" value={k.underTreatment} sub="mitigating" />
        <Kpi icon="⏰" tint="bg-amber-50" label="Overdue Treatment" value={k.overdueTreatment} tone={k.overdueTreatment ? "text-amber-600" : "text-gray-400"} sub="past review / escalated" />
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Controls Effective" value={k.controlsEffectiveness != null ? `${k.controlsEffectiveness}%` : "—"} tone={k.controlsEffectiveness != null && k.controlsEffectiveness >= 75 ? "text-emerald-600" : "text-gray-900"} sub={`${k.total ? d.controlsTotal : 0} controls`} />
        <Kpi icon="📅" tint="bg-indigo-50" label="Due for Review" value={k.dueForReview} tone={k.dueForReview ? "text-amber-600" : "text-gray-400"} sub="within 30 days" />
        <Kpi icon="⭐" tint="bg-violet-50" label="Emerging Risks" value={k.emerging} spark={k.totalSpark} sparkColor="#8b5cf6" />
      </div>

      {/* ── Heat map · top 10 · category ───────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risk Heat Map <span className="text-[10px] text-gray-400 font-normal">residual · likelihood × consequence</span></h3>
          {d.hasData ? (
            <div className="flex gap-1.5">
              <div className="flex flex-col justify-around text-[8px] text-gray-400 text-right pr-0.5 w-16 shrink-0">{LIKELIHOOD.map(l => <span key={l} className="leading-tight">{l}</span>)}</div>
              <div className="flex-1 min-w-0">
                <div className="grid grid-cols-5 gap-1">{[5, 4, 3, 2, 1].map(l => [1, 2, 3, 4, 5].map(im => { const n = d.heat[`${l}-${im}`] ?? 0; const score = l * im; return <div key={`${l}-${im}`} className={`aspect-square rounded flex items-center justify-center text-[11px] font-bold ${n ? cellTone(score) : "bg-gray-50 text-gray-200"}`} title={`Likelihood ${l} × Consequence ${im} = ${score}`}>{n || ""}</div>; }))}</div>
                <div className="grid grid-cols-5 gap-1 mt-1 text-[7px] text-gray-400 text-center">{CONSEQUENCE.map(c => <span key={c} className="leading-tight truncate">{c}</span>)}</div>
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No open risks.</p>}
          <div className="flex flex-wrap gap-2 mt-3 text-[10px]"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500" />Extreme 16-25</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-400" />High 10-15</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-300" />Moderate 5-9</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400" />Low 1-4</span></div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Top 10 Risks <span className="text-[10px] text-gray-400 font-normal">by residual score</span></h3>
          {d.top10.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Risk</th><th className="py-1.5 font-medium">Category</th><th className="py-1.5 font-medium text-center">Residual</th><th className="py-1.5 font-medium text-center">Trend</th><th className="py-1.5 font-medium">Level</th></tr></thead>
                <tbody>{d.top10.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1.5 text-gray-700 max-w-[150px] truncate" title={r.title}>{r.title}</td>
                    <td className="py-1.5 text-gray-500 capitalize">{r.category}</td>
                    <td className="py-1.5 text-center"><span className={`inline-block w-7 rounded text-[11px] font-bold tabular-nums ${cellTone(r.residual)}`}>{r.residual}</span></td>
                    <td className={`py-1.5 text-center ${r.trend === "down" ? "text-emerald-600" : r.trend === "up" ? "text-rose-600" : "text-gray-400"}`}>{r.trend === "down" ? "↓" : r.trend === "up" ? "↑" : "→"}</td>
                    <td className="py-1.5"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${lvlTone(r.level)}`}>{r.level}</span></td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="text-[9px] text-gray-400 mt-2">Trend = residual vs inherent (mitigation effect). Per-risk score history is next-phase.</p>
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No risks registered.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risk Category Distribution</h3>
          {d.categoryDist.length ? <div className="flex items-center gap-4">
            <SegDonut total={k.total} label="Total Risks" segs={d.categoryDist.map((c: any) => ({ n: c.n, color: c.color }))} />
            <div className="text-[11px] space-y-1 flex-1 min-w-0">{d.categoryDist.slice(0, 8).map((c: any) => <div key={c.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-gray-600 flex-1 truncate capitalize">{c.label}</span><b className="tabular-nums">{c.n}</b><span className="text-gray-300 tabular-nums">({c.pct}%)</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No risks.</p>}
        </div>
      </div>

      {/* ── Treatment status · controls effectiveness · reviews due ────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risk Treatment Plan Status</h3>
          {d.treatmentStatus.length ? <div className="flex items-center gap-4">
            <div className="relative w-28 h-28 shrink-0"><div className="w-28 h-28 rounded-full" style={{ background: `conic-gradient(#10b981 ${(d.treatmentProgress ?? 0) * 3.6}deg, #f1f5f9 0)` }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-xl font-bold text-gray-900">{d.treatmentProgress != null ? `${d.treatmentProgress}%` : "—"}</span><span className="text-[8px] text-gray-400">Progress</span></div></div>
            <div className="text-[11px] space-y-1 flex-1 min-w-0">{d.treatmentStatus.map((s: any) => <div key={s.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="text-gray-600 flex-1">{s.label}</span><b className="tabular-nums">{s.n}</b></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No treatment plans.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Controls Effectiveness</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0" style={{ background: `conic-gradient(#10b981 ${(d.controlsEffectiveness ?? 0) * 3.6}deg, #f1f5f9 0)`, borderRadius: "9999px" }}><div className="absolute inset-[18%] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{d.controlsEffectiveness != null ? `${d.controlsEffectiveness}%` : "—"}</span><span className="text-[8px] text-gray-400">Effective</span></div></div>
            <div className="text-[11px] space-y-1.5 flex-1 min-w-0">{d.controlsByType.length ? d.controlsByType.map((c: any) => <div key={c.type}><div className="flex items-center justify-between"><span className="text-gray-600">{c.type}</span><b className="tabular-nums">{c.pct != null ? `${c.pct}%` : "—"}</b></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${c.pct ?? 0}%` }} /></div></div>) : <p className="text-gray-400">No controls recorded.</p>}</div>
          </div>
          <p className="text-[9px] text-gray-400 mt-2">Administrative / physical control types are next-phase (enum has preventive / detective / corrective).</p>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risks Due for Review</h3>
          {d.dueForReviewList.length ? <div className="space-y-1.5">{d.dueForReviewList.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs"><div className="min-w-0 flex-1"><p className="text-gray-700 truncate">{r.title}</p><p className="text-[10px] text-gray-400">{r.reviewDue}</p></div><span className={`text-[10px] font-semibold shrink-0 ${r.daysLeft < 0 ? "text-rose-600" : r.daysLeft <= 7 ? "text-amber-600" : "text-gray-500"}`}>{r.daysLeft < 0 ? `${Math.abs(r.daysLeft)}d overdue` : `${r.daysLeft}d left`}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No reviews scheduled.</p>}
        </div>
      </div>

      {/* ── Emerging · escalated · AI ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Emerging Risks <span className="text-[10px] text-gray-400 font-normal">last 30 days</span></h3>
          {d.emergingList.length ? <div className="space-y-2">{d.emergingList.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${lvlTone(r.level === "Medium" ? "Moderate" : r.level)}`}>{r.level}</span><span className="text-gray-700 flex-1 truncate">{r.title}</span><span className="text-gray-400 shrink-0">{r.at.slice(5)}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No emerging risks this month.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Escalated Risks</h3>
          {d.escalatedList.length ? <div className="space-y-2">{d.escalatedList.map((r: any, i: number) => (
            <div key={i} className="text-xs border-b border-gray-50 pb-1.5 last:border-0"><p className="text-gray-700 truncate">{r.title}</p><p className="text-[10px] text-gray-400 capitalize">{r.category}{r.owner ? ` · ${r.owner}` : ""} · escalated {r.at.slice(5)}</p></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No escalated risks.</p>}
          <p className="text-[9px] text-gray-400 mt-2">Escalation target (Escalated To) is next-phase.</p>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm">🤖</span><h3 className="font-semibold text-gray-900 text-sm">AI Risk Intelligence</h3></div>
          {d.ai.length ? <div className="space-y-2">{d.ai.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.tone === "rose" ? "bg-rose-500" : a.tone === "amber" ? "bg-amber-400" : a.tone === "sky" ? "bg-sky-400" : "bg-emerald-500"}`} /><div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 leading-snug">{a.text}</p><p className="text-[10px] text-gray-400 truncate">{a.detail}</p></div><span className="text-[10px] text-gray-400 shrink-0">conf {a.confidence}%</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No risk signals to action right now.</p>}
        </div>
      </div>

      {/* ── Recent updates · quick actions ─────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Risk Register — Recent Updates</h3><Link href="/super-admin/governance/risk" className="text-[11px] text-rose-700 hover:underline">View full register →</Link></div>
          {d.recentUpdates.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">ID</th><th className="py-1.5 font-medium">Risk Title</th><th className="py-1.5 font-medium">Category</th><th className="py-1.5 font-medium">Owner</th><th className="py-1.5 font-medium">Status</th><th className="py-1.5 font-medium text-center">Residual</th><th className="py-1.5 font-medium text-right">Review Date</th></tr></thead>
                <tbody>{d.recentUpdates.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-400 tabular-nums whitespace-nowrap font-mono text-[10px]">{r.id}</td>
                    <td className="py-2 text-gray-700 max-w-[170px] truncate" title={r.title}>{r.title}</td>
                    <td className="py-2 text-gray-500 capitalize">{r.category}</td>
                    <td className="py-2 text-gray-500 truncate max-w-[100px]">{r.owner ?? "—"}</td>
                    <td className="py-2 text-gray-500 capitalize">{r.status}</td>
                    <td className="py-2 text-center"><span className={`inline-block w-7 rounded text-[11px] font-bold tabular-nums ${cellTone(r.residual)}`}>{r.residual}</span></td>
                    <td className="py-2 text-right text-gray-400 tabular-nums">{r.reviewDate ?? "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No risks on the register.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Quick Actions</h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-2 gap-2">{QUICK.map(q => (
            <Link key={q.label} href="/super-admin/governance/risk" className="rounded-lg border border-gray-100 p-2 hover:border-rose-200 hover:bg-rose-50/40 transition-all text-center"><span className={`w-8 h-8 rounded-lg ${q.tint} flex items-center justify-center text-sm mx-auto mb-1`}>{q.icon}</span><p className="text-[9px] font-medium text-gray-700 leading-tight">{q.label}</p></Link>
          ))}</div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-gray-400 pb-4">
        <span>Data sources: Incident Management · Audit &amp; Compliance · CAPA &amp; Improvement · Patient Safety · Clinical Indicators · HR &amp; Workforce · Finance</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Risk register live · gov_risks / gov_controls (060) · score-history trends &amp; department view are next-phase</span>
      </div>
    </div>
  );
}
