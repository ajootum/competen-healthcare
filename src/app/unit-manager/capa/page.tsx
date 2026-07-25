import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCAPA } from "@/lib/operations/capa";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import { CapaActions, NewCapaButton } from "./CapaActions";

export const dynamic = "force-dynamic";

// CAPA & Continuous Improvement Centre (UMG-QS-004 / UMW-EA-003) — aligned to the QS-004 high-fidelity design
// spec. Command-centre layout over the live op_quality_actions store: the 8-KPI ribbon (with opened/closed/
// closure-time sparklines + period deltas, all real from the action timestamps), the Work Queue (CAPA
// register, risk-ranked, with a Source column + drill-down to the review panel with real lifecycle actions),
// CAPA status / source / priority distributions, completion trend, PDSA cycles, improvement projects, overdue,
// upcoming reviews and AI insights. Honest next-phase (op_quality_actions has no such columns): true
// source-module linkage (source shown by action type), the full Improvement Project Workspace (milestones /
// timeline / budget / dependencies) and the Evidence → Verification → Effectiveness → Lessons Learned stages.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const PRI: Record<string, string> = { high: "bg-rose-50 text-rose-700", medium: "bg-amber-50 text-amber-700", low: "bg-green-50 text-green-700" };
const STATUS: Record<string, string> = { open: "bg-gray-100 text-gray-600", in_progress: "bg-blue-50 text-blue-700", overdue: "bg-rose-50 text-rose-700", completed: "bg-green-50 text-green-700" };
const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In Progress", overdue: "Overdue", completed: "Completed" };
const TYPE_COLOR = ["#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444", "#6b7280"];
const STATUS_COLOR: Record<string, string> = { open: "#94a3b8", in_progress: "#3b82f6", overdue: "#ef4444", completed: "#22c55e" };
const relTime = (iso?: string | null) => { if (!iso) return "—"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 0) return "soon"; if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const QUICK = [
  { label: "Create CAPA", sub: "New corrective action", icon: "➕", tint: "bg-violet-50", href: "#create" },
  { label: "CAPA Register", sub: "Work queue", icon: "📋", tint: "bg-sky-50", href: "#queue" },
  { label: "Improvement Projects", sub: "QI initiatives", icon: "📈", tint: "bg-teal-50", href: "#projects" },
  { label: "PDSA Manager", sub: "Plan-Do-Study-Act", icon: "🔁", tint: "bg-emerald-50", href: "#pdsa" },
  { label: "RCA Follow-up", sub: "Root cause actions", icon: "🧩", tint: "bg-orange-50", href: "/supervisor/quality-safety" },
  { label: "Effectiveness Review", sub: "Verify outcomes", icon: "✅", tint: "bg-green-50", href: "#queue" },
  { label: "Lessons Learned", sub: "Share learning", icon: "💡", tint: "bg-pink-50", href: "/unit-manager/quality/ai" },
  { label: "Reports & Analytics", sub: "Export & trends", icon: "📊", tint: "bg-indigo-50", href: "/unit-manager/reports" },
];

function Spark({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2 || series.every(v => v === series[0])) return <div className="h-5" />;
  const max = Math.max(...series), min = Math.min(...series), rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${18 - ((v - min) / rng) * 16}`).join(" ");
  return <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-5"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
function Delta({ v, invert }: { v: number | null | undefined; invert?: boolean }) {
  if (v == null || v === 0) return null;
  const good = invert ? v < 0 : v > 0;
  return <span className={`text-[10px] font-medium ${good ? "text-emerald-600" : "text-rose-600"}`}>{v > 0 ? "↑" : "↓"} {Math.abs(v)}% MoM</span>;
}
function Kpi({ icon, tint, label, value, unit, sub, tone, spark, sparkColor, delta, deltaInvert }: any) {
  return (
    <div className={`${card} p-3.5`}>
      <div className="flex items-center justify-between mb-1"><div className="flex items-center gap-1.5 min-w-0"><span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs shrink-0 ${tint}`}>{icon}</span><span className="text-[9px] font-medium text-gray-500 uppercase tracking-wide truncate">{label}</span></div></div>
      <div className={`text-xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}{unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}</div>
      {spark ? <div className="mt-0.5"><Spark series={spark} color={sparkColor} /></div> : sub && <div className="text-[9px] text-gray-400 mt-0.5 leading-tight">{sub}</div>}
      {delta !== undefined && <div className="mt-0.5"><Delta v={delta} invert={deltaInvert} /></div>}
    </div>
  );
}
function SegDonut({ segs, total, label }: { segs: { n: number; color: string }[]; total: number; label?: string }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1;
  const active = segs.filter(s => s.n > 0);
  const grad = active.length ? `conic-gradient(${active.map((s, i) => { const before = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(before / sum) * 360}deg ${((before + s.n) / sum) * 360}deg`; }).join(", ")})` : "#f1f5f9";
  return <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: grad }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{total}</span><span className="text-[8px] text-gray-400">{label ?? "Total"}</span></div></div>;
}
function Bar({ label, level }: { label: string; level: string }) {
  const tone = ["High", "At Risk"].includes(level) ? "text-rose-600" : level === "Medium" ? "text-amber-600" : "text-gray-500";
  return <div className="flex items-center justify-between text-[11px]"><span className="text-gray-500">{label}</span><span className={`font-semibold ${tone}`}>{level}</span></div>;
}

export default async function CapaWorkspace({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const selId = typeof sp.id === "string" ? sp.id : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, departments] = await Promise.all([
    loadCAPA(admin, profile?.hospital_id ?? null, isSuper, dept, selId) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center text-lg">🔧</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">CAPA &amp; Continuous Improvement</h1><p className="text-sm text-gray-500">Manage corrective &amp; preventive actions and quality-improvement to reduce risk · Reporting period: This month</p></div></div>
      <div className="flex items-center gap-2"><UnitFilters departments={departments} /><Link href="/unit-manager/capa" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">↻ Refresh</Link><Link href="/unit-manager/reports" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">⇩ Export</Link><NewCapaButton /></div>
    </div>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Quality store not provisioned</p><p className="text-sm text-amber-800 mt-1">Run migration <code>073</code> to enable the CAPA &amp; quality-improvement store for this tenant.</p></div></div>;

  const k = d.kpis; const r = d.review;
  return (
    <div className="space-y-4">
      {header}

      {/* ── KPI ribbon (8) ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
        <Kpi icon="📋" tint="bg-violet-50" label="Open CAPAs" value={k.open} spark={d.sparks.opened} sparkColor="#8b5cf6" delta={d.deltas.opened} deltaInvert />
        <Kpi icon="⏰" tint="bg-rose-50" label="Overdue CAPAs" value={k.overdue} tone={k.overdue ? "text-rose-600" : "text-gray-400"} sub="past due" />
        <Kpi icon="📅" tint="bg-amber-50" label="Due This Week" value={k.dueThisWeek} tone={k.dueThisWeek ? "text-amber-600" : "text-gray-400"} sub="next 7 days" />
        <Kpi icon="🚩" tint="bg-orange-50" label="High Priority" value={k.highPriority} tone={k.highPriority ? "text-orange-600" : "text-gray-400"} sub="priority = high" />
        <Kpi icon="🕐" tint="bg-sky-50" label="Awaiting Verification" value={k.pendingVerification} sub="timeline ≥ 80%" />
        <Kpi icon="✅" tint="bg-green-50" label="Effectiveness Reviews" value={k.effectivenessReviews} spark={d.sparks.closed} sparkColor="#22c55e" delta={d.deltas.closed} />
        <Kpi icon="📈" tint="bg-teal-50" label="Completion Rate" value={k.completionRate != null ? `${k.completionRate}%` : "—"} tone={k.completionRate != null && k.completionRate >= 70 ? "text-emerald-600" : "text-gray-900"} sub="closed / all" />
        <Kpi icon="⏳" tint="bg-indigo-50" label="Avg Closure Time" value={k.avgClosure != null ? k.avgClosure : "—"} unit={k.avgClosure != null ? "d" : ""} spark={d.sparks.closure} sparkColor="#6366f1" />
      </div>

      {/* ── Work Queue + Review panel ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4" id="queue">
        <div className={`${card} p-5 xl:col-span-2`} id="create">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900">Work Queue <span className="text-[10px] text-gray-400 font-normal">CAPA register · risk-ranked</span></h3>
            <NewCapaButton />
          </div>
          <div className="flex gap-1 mb-3 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-600 text-white">All ({d.counts.all})</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-600">High Risk ({d.counts.high})</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">Medium ({d.counts.medium})</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-600">Low ({d.counts.low})</span>
          </div>
          {d.register.length === 0 ? (
            <div className="text-center py-8"><p className="text-3xl mb-2">✅</p><p className="text-sm font-semibold text-gray-700">{d.empty ? "No CAPAs yet" : "Work queue is clear"}</p><p className="text-xs text-gray-400 mt-1">{d.empty ? "Create a CAPA, audit action or improvement project to get started." : "All corrective and preventive actions are closed."}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">CAPA ID</th><th className="py-2 pr-3 font-medium">Title</th><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">Owner</th><th className="py-2 pr-3 font-medium">Due</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Progress</th><th className="py-2 pr-3 font-medium">Risk</th><th className="py-2 font-medium">Actions</th></tr></thead>
                <tbody>
                  {d.register.slice(0, 8).map((c: any) => (
                    <tr key={c.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${r?.id === c.id ? "bg-violet-50/40" : ""}`}>
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${PRI[c.priority] ?? PRI.medium}`}>{c.priority}</span></td>
                      <td className="py-2 pr-3 text-gray-400 whitespace-nowrap font-mono text-[10px]">{c.code}</td>
                      <td className="py-2 pr-3 text-gray-800 font-medium max-w-[150px] truncate">{c.title}</td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{c.source}</td>
                      <td className="py-2 pr-3 text-gray-600 truncate max-w-[90px]">{c.owner}</td>
                      <td className={`py-2 pr-3 whitespace-nowrap ${c.overdue ? "text-rose-600 font-semibold" : "text-gray-500"}`}>{c.due_at ? c.due_at.slice(5, 10) : "—"}</td>
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS[c.status]}`}>{STATUS_LABEL[c.status]}</span></td>
                      <td className="py-2 pr-3"><div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${c.riskBand === "High" ? "bg-rose-500" : c.progress >= 70 ? "bg-green-500" : "bg-amber-400"}`} style={{ width: `${c.progress}%` }} /></div><span className="text-[9px] text-gray-400">{c.progress}%</span></td>
                      <td className={`py-2 pr-3 whitespace-nowrap font-semibold ${c.riskBand === "High" ? "text-rose-600" : c.riskBand === "Medium" ? "text-amber-600" : "text-gray-500"}`}>{c.risk}/25</td>
                      <td className="py-2"><Link href={`/unit-manager/capa?id=${c.id}`} className="text-violet-700 hover:underline">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Showing {Math.min(8, d.register.length)} of {d.register.length} open · high-risk first. Source is the action type (true source-module linkage is next-phase). Risk score &amp; progress are derived from stored priority + timeline. Sorting / bulk / inline edits are next-phase.</p>
            </div>
          )}
        </div>

        {/* Review panel (slide-over detail is next-phase; inline detail preserved) */}
        <div className={`${card} p-5 xl:col-span-1`}>
          {!r ? <div className="text-center py-8"><p className="text-2xl mb-2">🗂️</p><p className="text-sm text-gray-400">Select a CAPA to review.</p></div> : (
            <>
              <div className="flex items-start justify-between mb-2"><div><h3 className="text-sm font-bold text-gray-900">{r.title}</h3><p className="text-[10px] text-gray-400">{r.code} · {r.typeLabel} · Reported {relTime(r.created_at)}</p></div><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold h-fit ${r.riskBand === "High" ? "bg-rose-50 text-rose-700" : r.riskBand === "Medium" ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>{r.riskBand} Risk</span></div>
              <div className="flex gap-3 border-b border-gray-100 mb-2 text-[10px]">{["Overview", "RCA", "Actions", "Evidence", "History"].map((t, i) => <span key={t} className={`pb-1 -mb-px border-b-2 ${i === 0 ? "border-violet-600 text-violet-700 font-semibold" : "border-transparent text-gray-300"}`}>{t}</span>)}</div>
              {r.description && <p className="text-[11px] text-gray-600 mb-3">{r.description}</p>}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-gray-100 p-2.5">
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Impact</p>
                  <div className="space-y-1">{r.impact.map((x: any) => <Bar key={x.label} label={x.label} level={x.level} />)}</div>
                </div>
                <div className="rounded-lg border border-gray-100 p-2.5">
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Risk Assessment</p>
                  <p className={`text-lg font-bold ${r.riskBand === "High" ? "text-rose-600" : r.riskBand === "Medium" ? "text-amber-600" : "text-gray-700"}`}>{r.risk}<span className="text-xs text-gray-400"> / 25</span></p>
                  <div className="text-[10px] text-gray-500 space-y-0.5 mt-1"><div>Likelihood: <b>{r.likelihood}/5</b></div><div>Severity: <b>{r.severity}/5</b></div><div>Detectability: <b>{r.detectability}/5</b></div><div>Controls: <b className={r.controls === "Weak" ? "text-rose-600" : ""}>{r.controls}</b></div></div>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-violet-50/50 border border-violet-100 p-2.5">
                <div className="flex items-center justify-between"><p className="text-[10px] font-bold text-violet-700 uppercase">AI Recommendation</p><span className="text-[10px] text-gray-500">{r.aiConfidence}%</span></div>
                <p className="text-xs font-semibold text-violet-700">{r.aiRec}</p>
                <ul className="text-[11px] text-gray-600 space-y-0.5 mt-1">{r.aiActions.map((x: string, i: number) => <li key={i}>✓ {x}</li>)}</ul>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-gray-400"><span>Owner: <b className="text-gray-600">{r.owner}</b></span><span>Due: <b className={r.overdue ? "text-rose-600" : "text-gray-600"}>{r.due_at ? r.due_at.slice(0, 10) : "—"}</b></span><span>Status: <b className="text-gray-600">{STATUS_LABEL[r.status]}</b></span><span>Progress: <b className="text-gray-600">{r.progress}%</b></span></div>
              <div className="mt-3"><CapaActions id={r.id} status={r.status} /></div>
            </>
          )}
        </div>
      </div>

      {/* ── Status · Source · Priority · Completion trend ──────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">CAPA Status Overview</h3>
          <div className="flex items-center gap-3"><SegDonut total={d.byStatus.reduce((a: number, x: any) => a + x.n, 0)} segs={d.byStatus.map((x: any) => ({ n: x.n, color: STATUS_COLOR[x.key] ?? "#9ca3af" }))} /><div className="text-[11px] space-y-0.5 flex-1">{d.byStatus.map((x: any) => <div key={x.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: STATUS_COLOR[x.key] ?? "#9ca3af" }} /><span className="text-gray-600 flex-1">{x.label}</span><b>{x.n}</b></div>)}</div></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">CAPA by Source</h3>
          {d.bySource.length === 0 ? <p className="text-sm text-gray-400">No CAPAs.</p> : (
            <div className="flex items-center gap-3"><SegDonut total={d.bySource.reduce((a: number, x: any) => a + x.n, 0)} segs={d.bySource.map((x: any, i: number) => ({ n: x.n, color: TYPE_COLOR[i % 6] }))} /><div className="text-[11px] space-y-0.5 flex-1">{d.bySource.slice(0, 6).map((x: any, i: number) => <div key={x.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLOR[i % 6] }} /><span className="text-gray-600 flex-1 truncate">{x.label}</span><b>{x.n}</b></div>)}</div></div>
          )}
          <p className="text-[9px] text-gray-400 mt-2">By action type · source-module linkage is next-phase.</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Priority Distribution</h3>
          {d.priorityDist.every((p: any) => p.n === 0) ? <p className="text-sm text-gray-400">No open CAPAs.</p> : (
            <div className="space-y-2.5 mt-1">{d.priorityDist.map((p: any) => { const tot = d.priorityDist.reduce((a: number, x: any) => a + x.n, 0) || 1; return <div key={p.label}><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{p.label}</span><b className="tabular-nums text-gray-800">{p.n}</b></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(p.n / tot) * 100}%`, background: p.color }} /></div></div>; })}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Completion Trend <span className="text-[10px] text-gray-400 font-normal">8 wks</span></h3>
          <div className="flex items-end gap-1 h-20">{d.closureTrend.map((t: any, i: number) => { const max = Math.max(1, ...d.closureTrend.map((x: any) => x.n)); return <div key={i} className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full bg-violet-400 rounded-t" style={{ height: `${(t.n / max) * 100}%`, minHeight: t.n ? 3 : 0 }} title={`${t.label}: ${t.n}`} /></div>; })}</div>
          <p className="text-[10px] text-gray-400 mt-1">CAPAs closed per week.</p>
        </div>
      </div>

      {/* ── PDSA · Improvement projects · AI insights ──────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`} id="pdsa">
          <h3 className="text-sm font-bold text-gray-900 mb-3">PDSA Cycles</h3>
          {d.pdsa.length === 0 ? <p className="text-sm text-gray-400">No PDSA cycles. Create one with action type &ldquo;PDSA&rdquo;.</p> : (
            <div className="space-y-2">{d.pdsa.map((p: any) => (<div key={p.id} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate flex-1">{p.title}</span><span className={`text-[9px] px-1 py-0.5 rounded ${STATUS[p.status]}`}>{STATUS_LABEL[p.status]}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.progress}%` }} /></div></div>))}</div>
          )}
        </div>
        <div className={`${card} p-5`} id="projects">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Improvement Projects</h3></div>
          {d.projects.length === 0 ? <p className="text-sm text-gray-400">No active improvement projects.</p> : (
            <div className="space-y-2">{d.projects.map((c: any) => (<div key={c.id} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate flex-1">{c.title}</span><span className="text-gray-400 ml-2">{c.progress}%</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${c.progress}%` }} /></div></div>))}</div>
          )}
          <p className="text-[9px] text-gray-400 mt-2">Full project workspace (milestones / timeline / budget / dependencies) is next-phase — needs a project store.</p>
        </div>
        <div className={`${card} p-5 bg-gradient-to-br from-violet-50/40 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI Improvement Insights</h3>
          {d.aiInsights.length === 0 ? <p className="text-sm text-gray-400">No insights yet.</p> : (
            <div className="space-y-2">{d.aiInsights.map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{a.icon}</span><p className="text-xs text-gray-700 flex-1">{a.text}</p></div>))}</div>
          )}
        </div>
      </div>

      {/* ── Overdue · upcoming · quick access ──────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Overdue CAPAs</h3>
          {d.overdueList.length === 0 ? <p className="text-sm text-gray-400">No overdue CAPAs. 🎉</p> : (
            <div className="space-y-1.5">{d.overdueList.slice(0, 6).map((c: any) => (<Link key={c.id} href={`/unit-manager/capa?id=${c.id}`} className="flex items-center gap-2 text-xs hover:bg-gray-50/60 rounded px-1 py-0.5"><span className="text-rose-500">●</span><span className="text-gray-700 flex-1 truncate">{c.title}</span><span className="text-rose-600 whitespace-nowrap">{c.due_at ? c.due_at.slice(5, 10) : "—"}</span></Link>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Upcoming Review Dates</h3>
          {d.upcoming.length === 0 ? <p className="text-sm text-gray-400">No upcoming reviews scheduled.</p> : (
            <div className="space-y-1.5">{d.upcoming.map((c: any) => (<div key={c.id} className="flex items-center gap-2 text-xs"><span className="text-violet-400">📅</span><span className="text-gray-700 flex-1 truncate">{c.title}</span><span className="text-gray-500 whitespace-nowrap">{c.due_at ? c.due_at.slice(0, 10) : "—"}</span></div>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Quick Access</h3>
          <div className="grid grid-cols-2 gap-2">{QUICK.map(q => (
            <Link key={q.label} href={q.href} className="rounded-lg border border-gray-100 p-2 hover:border-violet-200 hover:bg-violet-50/40 transition-all"><div className="flex items-center gap-1.5"><span className={`w-6 h-6 rounded-md ${q.tint} flex items-center justify-center text-xs shrink-0`}>{q.icon}</span><div className="min-w-0"><p className="text-[10px] font-medium text-gray-800 leading-tight truncate">{q.label}</p><p className="text-[8px] text-gray-400 leading-tight truncate">{q.sub}</p></div></div></Link>
          ))}</div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-gray-400 pb-4">
        <span>Data sources: Incident Management · Audit &amp; Compliance · Risk Register · Patient Operations · Executive Actions</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Quality-action store live · consolidation over op_quality_actions (migration 073) · <Link href="/unit-manager/action-centre" className="text-violet-700 hover:underline">Executive Actions</Link></span>
      </div>
    </div>
  );
}
