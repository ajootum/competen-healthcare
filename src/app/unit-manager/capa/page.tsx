import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCAPA } from "@/lib/operations/capa";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import { CapaActions, NewCapaButton } from "./CapaActions";

export const dynamic = "force-dynamic";

// CAPA & Improvement Workspace (UMW-EA-003) — the Unit Manager's corrective/preventive
// action and quality-improvement command centre over the live op_quality_actions store.
// KPIs, CAPA register (risk-ranked), review panel with derived 5x5 risk assessment +
// rule-based AI recommendation, by-type/status distribution, closure trend, overdue,
// improvement projects and upcoming reviews are real; RCA methodology, evidence/
// verification, root-cause categorisation and the deep tabs are next-phase honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const PRI: Record<string, string> = { high: "bg-rose-50 text-rose-700", medium: "bg-amber-50 text-amber-700", low: "bg-green-50 text-green-700" };
const STATUS: Record<string, string> = { open: "bg-gray-100 text-gray-600", in_progress: "bg-blue-50 text-blue-700", overdue: "bg-rose-50 text-rose-700", completed: "bg-green-50 text-green-700" };
const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In Progress", overdue: "Overdue", completed: "Completed" };
const TYPE_COLOR = ["#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444", "#6b7280"];
const STATUS_COLOR: Record<string, string> = { open: "#94a3b8", in_progress: "#3b82f6", overdue: "#ef4444", completed: "#22c55e" };
const relTime = (iso?: string | null) => { if (!iso) return "—"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 0) return "soon"; if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const TABS = ["Overview", "CAPA Register", "Root Cause Analysis", "Action Tracker", "Effectiveness Review", "Improvement Projects", "AI Improvement Assistant", "Reports"];
const QUICK: [string, string | null][] = [["Create CAPA", "#create"], ["Open RCA", null], ["Create Improvement Project", "#create"], ["Upload Evidence", null], ["CAPA Template Library", null], ["Export Register", null]];

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}
function Donut({ segs, total }: { segs: { n: number; color: string }[]; total: number }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1; let acc = 0;
  const stops = segs.map(s => { const a = (acc / sum) * 100; acc += s.n; return `${s.color} ${a}% ${(acc / sum) * 100}%`; }).join(", ");
  return <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: sum > 0 ? `conic-gradient(${stops})` : "#f1f5f9" }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{total}</span><span className="text-[8px] text-gray-400">Total</span></div></div>;
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
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🔧</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">CAPA &amp; Improvement</h1><p className="text-sm text-gray-500">Manage corrective and preventive actions to drive continuous improvement and reduce risk.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-violet-600 text-violet-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Quality store not provisioned</p><p className="text-sm text-amber-800 mt-1">Run migration <code>073</code> to enable the CAPA &amp; quality-improvement store for this tenant.</p></div></div>;

  const k = d.kpis; const r = d.review;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Open CAPAs" value={k.open} sub="Requires action" icon="📋" />
        <Kpi label="Overdue" value={k.overdue} sub="Past due" tone={k.overdue ? "text-rose-600" : undefined} icon="⏰" />
        <Kpi label="In Progress" value={k.inProgress} sub="On track" tone={k.inProgress ? "text-blue-600" : undefined} icon="🔄" />
        <Kpi label="Pending Verification" value={k.pendingVerification} sub="Awaiting evidence" icon="🕐" />
        <Kpi label="Completed" value={k.completedThisPeriod} sub="This period (30d)" tone="text-green-600" icon="✅" />
        <Kpi label="Avg Closure Time" value={k.avgClosure != null ? `${k.avgClosure}` : "—"} sub={k.avgClosure != null ? "Days to close" : "No closures yet"} icon="⏳" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* CAPA register */}
        <div className={`${card} p-5 xl:col-span-2`} id="create">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900">CAPA Register</h3>
            <NewCapaButton />
          </div>
          <div className="flex gap-1 mb-3 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-600 text-white">All ({d.counts.all})</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-600">High Risk ({d.counts.high})</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">Medium ({d.counts.medium})</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-600">Low ({d.counts.low})</span>
          </div>
          {d.register.length === 0 ? (
            <div className="text-center py-8"><p className="text-3xl mb-2">✅</p><p className="text-sm font-semibold text-gray-700">{d.empty ? "No CAPAs yet" : "CAPA register is clear"}</p><p className="text-xs text-gray-400 mt-1">{d.empty ? "Create a CAPA, audit action or improvement project to get started." : "All corrective and preventive actions are closed."}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">ID</th><th className="py-2 pr-3 font-medium">Title / Issue</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Owner</th><th className="py-2 pr-3 font-medium">Due</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Progress</th><th className="py-2 pr-3 font-medium">Risk</th><th className="py-2 font-medium">Action</th></tr></thead>
                <tbody>
                  {d.register.slice(0, 8).map((c: any) => (
                    <tr key={c.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${r?.id === c.id ? "bg-violet-50/40" : ""}`}>
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${PRI[c.priority] ?? PRI.medium}`}>{c.priority}</span></td>
                      <td className="py-2 pr-3 text-gray-400 whitespace-nowrap font-mono text-[10px]">{c.code}</td>
                      <td className="py-2 pr-3 text-gray-800 font-medium max-w-[160px] truncate">{c.title}</td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{c.typeLabel}</td>
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
              <p className="text-[10px] text-gray-400 mt-2">Showing {Math.min(8, d.register.length)} of {d.register.length} open. High-risk first. Risk score &amp; progress are derived from stored priority + timeline (no explicit risk/%-complete column).</p>
            </div>
          )}
        </div>

        {/* Review panel */}
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

      {/* Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">CAPA by Type</h3>
          {d.byType.length === 0 ? <p className="text-sm text-gray-400">No CAPAs.</p> : (
            <div className="flex items-center gap-3"><Donut total={d.byType.reduce((a: number, x: any) => a + x.n, 0)} segs={d.byType.map((x: any, i: number) => ({ n: x.n, color: TYPE_COLOR[i % 6] }))} /><div className="text-[11px] space-y-0.5 flex-1">{d.byType.slice(0, 6).map((x: any, i: number) => <div key={x.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLOR[i % 6] }} /><span className="text-gray-600 flex-1">{x.label}</span><b>{x.n}</b><span className="text-gray-400">({x.pct}%)</span></div>)}</div></div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">CAPA by Status</h3>
          <div className="flex items-center gap-3"><Donut total={d.byStatus.reduce((a: number, x: any) => a + x.n, 0)} segs={d.byStatus.map((x: any) => ({ n: x.n, color: STATUS_COLOR[x.key] ?? "#9ca3af" }))} /><div className="text-[11px] space-y-0.5 flex-1">{d.byStatus.map((x: any) => <div key={x.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: STATUS_COLOR[x.key] ?? "#9ca3af" }} /><span className="text-gray-600 flex-1">{x.label}</span><b>{x.n}</b></div>)}</div></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Closure Trend (8 wks)</h3>
          <div className="flex items-end gap-1 h-20">{d.closureTrend.map((t: any, i: number) => { const max = Math.max(1, ...d.closureTrend.map((x: any) => x.n)); return <div key={i} className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full bg-violet-400 rounded-t" style={{ height: `${(t.n / max) * 100}%`, minHeight: t.n ? 3 : 0 }} title={`${t.label}: ${t.n}`} /></div>; })}</div>
          <p className="text-[10px] text-gray-400 mt-1">CAPAs closed per week.</p>
        </div>
        <div className={`${card} p-5 bg-gradient-to-br from-violet-50/40 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI Insights</h3>
          {d.aiInsights.length === 0 ? <p className="text-sm text-gray-400">No insights yet.</p> : (
            <div className="space-y-2">{d.aiInsights.map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{a.icon}</span><p className="text-xs text-gray-700 flex-1">{a.text}</p></div>))}</div>
          )}
        </div>
      </div>

      {/* Overdue + projects + upcoming */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Overdue CAPAs</h3>
          {d.overdueList.length === 0 ? <p className="text-sm text-gray-400">No overdue CAPAs. 🎉</p> : (
            <div className="space-y-1.5">{d.overdueList.slice(0, 6).map((c: any) => (<Link key={c.id} href={`/unit-manager/capa?id=${c.id}`} className="flex items-center gap-2 text-xs hover:bg-gray-50/60 rounded px-1 py-0.5"><span className="text-rose-500">●</span><span className="text-gray-700 flex-1 truncate">{c.title}</span><span className="text-rose-600 whitespace-nowrap">{c.due_at ? c.due_at.slice(5, 10) : "—"}</span></Link>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Improvement Projects</h3>
          {d.projects.length === 0 ? <p className="text-sm text-gray-400">No active improvement projects.</p> : (
            <div className="space-y-2">{d.projects.map((c: any) => (<div key={c.id} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate flex-1">{c.title}</span><span className="text-gray-400 ml-2">{c.progress}%</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${c.progress}%` }} /></div></div>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Upcoming Review Dates</h3>
          {d.upcoming.length === 0 ? <p className="text-sm text-gray-400">No upcoming reviews scheduled.</p> : (
            <div className="space-y-1.5">{d.upcoming.map((c: any) => (<div key={c.id} className="flex items-center gap-2 text-xs"><span className="text-violet-400">📅</span><span className="text-gray-700 flex-1 truncate">{c.title}</span><span className="text-gray-500 whitespace-nowrap">{c.due_at ? c.due_at.slice(0, 10) : "—"}</span></div>))}</div>
          )}
        </div>
      </div>

      {/* Root cause trends (honest next-phase) + quick actions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Root Cause Trends</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-4 text-center"><p className="text-sm text-gray-500">Structured root-cause categorisation isn&apos;t captured yet.</p><p className="text-xs text-gray-400 mt-1">Root Cause Trends (Staffing / Communication / Process / Equipment / Environment) populate once the RCA workspace records contributing factors against each CAPA — shown as an honest next-phase state rather than fabricated percentages.</p></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-1.5">{QUICK.map(([label, href]) => href ? <a key={label} href={href} className="text-[10px] text-gray-700 border border-gray-100 rounded-lg px-1.5 py-2 hover:border-violet-300 hover:bg-violet-50/40 text-center">{label}</a> : <span key={label} className="text-[10px] text-gray-300 border border-gray-100 rounded-lg px-1.5 py-2 text-center" title="Not wired yet">{label}</span>)}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The CAPA &amp; Improvement Workspace (UMW-EA-003) is the Unit Manager&apos;s corrective/preventive-action command centre over the live op_quality_actions store (CAPA / audit action / PDSA / improvement project / RCA / policy review). KPIs, the risk-ranked register, by-type/status distribution, closure trend, overdue, improvement projects and upcoming reviews are all real; the 5x5 risk score, timeline progress and AI recommendations are transparently derived from stored priority + dates (no explicit risk/%-complete column). Lifecycle actions (Take Action / Mark Complete / Reopen) and Create CAPA run through the audited /api/operations/quality-actions route. Structured RCA (5 Whys / Fishbone), evidence &amp; verification, root-cause categorisation and the deep tabs are next-phase honest states. <Link href="/unit-manager/action-centre" className="text-violet-700 hover:underline">← Executive Actions</Link></p>
    </div>
  );
}
