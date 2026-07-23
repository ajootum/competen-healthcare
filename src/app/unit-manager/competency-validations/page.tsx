import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCompetencyValidations } from "@/lib/operations/competency-validations";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import ValidationActions from "./ValidationActions";

export const dynamic = "force-dynamic";

// Competency Validations Workspace (UMW-EA-004) — review, validate and monitor staff
// competencies. Reads passing competency_scores awaiting educator validation, joined
// to their cycle (learner) and framework competency (name, risk). KPIs, validation
// queue, review panel with rule-based AI validation insight + risk indicators,
// by-type/status analytics, weekly trend, AI early-warning, recently-completed and
// frameworks. Decisions run through the audited /api/educator/validate route.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const PRI: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-green-50 text-green-700" };
const TYPE_COLOR = ["#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444", "#6b7280"];
const STATUS_COLOR: Record<string, string> = { Pending: "#f59e0b", Returned: "#ef4444", Validated: "#22c55e" };
const DOT: Record<string, string> = { red: "bg-rose-500", amber: "bg-amber-500", gray: "bg-gray-300" };
const relTime = (iso?: string | null) => { if (!iso) return "—"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const TABS = ["Validation Dashboard", "Validation Queue", "Competency Evidence", "Decision Workflows", "Validation Analytics", "Validation Calendar", "Standards & Frameworks"];
const QUICK = [["Create Validation Request", null], ["Upload Evidence", null], ["Create OSCE Schedule", null], ["Assign Validation", null], ["Validation Reports", "/unit-manager/shift-intelligence"], ["Manage Frameworks", "/unit-manager/competency"]];

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}
function Donut({ segs, total }: { segs: { n: number; color: string }[]; total: number }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1; let acc = 0;
  const stops = segs.map(s => { const a = (acc / sum) * 100; acc += s.n; return `${s.color} ${a}% ${(acc / sum) * 100}%`; }).join(", ");
  return <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: sum > 0 ? `conic-gradient(${stops})` : "#f1f5f9" }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{total}</span><span className="text-[8px] text-gray-400">Total</span></div></div>;
}

export default async function CompetencyValidationsWorkspace({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
    loadCompetencyValidations(admin, profile?.hospital_id ?? null, isSuper, dept, selId) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🎓</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Competency Validations</h1><p className="text-sm text-gray-500">Review and validate competency evidence, assessments and competency decisions.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-teal-600 text-teal-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Competency tables not provisioned</p><p className="text-sm text-amber-800 mt-1">The competency store isn&apos;t available for this tenant yet.</p></div></div>;

  const k = d.kpis; const r = d.review;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi label="Pending Validations" value={k.pending} sub="Requires review" icon="📋" />
        <Kpi label="Overdue" value={k.overdue} sub="Past due date" tone={k.overdue ? "text-rose-600" : undefined} icon="⏰" />
        <Kpi label="Due Today" value={k.dueToday} sub="Needs attention" tone={k.dueToday ? "text-amber-600" : undefined} icon="📅" />
        <Kpi label="High Priority" value={k.highPriority} sub="High-risk items" tone={k.highPriority ? "text-rose-600" : undefined} icon="🔺" />
        <Kpi label="Validated This Week" value={k.validatedThisWeek} sub="This period" tone="text-green-600" icon="✅" />
        <Kpi label="Decision Quality" value={k.decisionQuality != null ? `${k.decisionQuality}%` : "—"} sub="Validated / decided" icon="🏅" />
        <Kpi label="Validation Health" value={`${k.health}%`} sub={k.health >= 80 ? "Good" : k.health >= 60 ? "Fair" : "At risk"} tone={k.health >= 80 ? "text-green-600" : k.health >= 60 ? "text-amber-600" : "text-rose-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Validation queue */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Validation Queue</h3><div className="flex gap-1">{["All", "Overdue", "High Priority", "Due Today"].map((f, i) => <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full ${i === 0 ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"}`}>{f}</span>)}</div></div>
          {d.queue.length === 0 ? (
            <div className="text-center py-8"><p className="text-3xl mb-2">✅</p><p className="text-sm font-semibold text-gray-700">{d.empty ? "No competency cycles yet" : "Validation queue is clear"}</p><p className="text-xs text-gray-400 mt-1">{d.empty ? "Validations appear once assessment cycles produce passing scores." : "All passing competencies have been validated."}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Learner</th><th className="py-2 pr-3 font-medium">Competency</th><th className="py-2 pr-3 font-medium">Submitted</th><th className="py-2 pr-3 font-medium">Due</th><th className="py-2 pr-3 font-medium">Risk</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Action</th></tr></thead>
                <tbody>
                  {d.queue.slice(0, 8).map((s: any) => (
                    <tr key={s.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${r?.id === s.id ? "bg-teal-50/40" : ""}`}>
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${PRI[s.priority]}`}>{s.priority}</span></td>
                      <td className="py-2 pr-3 text-gray-600 capitalize">{s.type}</td>
                      <td className="py-2 pr-3 text-gray-700 truncate max-w-[90px]">{s.learner}</td>
                      <td className="py-2 pr-3 text-gray-800 font-medium max-w-[140px] truncate">{s.competency}</td>
                      <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{relTime(s.created_at)}</td>
                      <td className={`py-2 pr-3 whitespace-nowrap ${s.endDate && s.endDate < new Date().toISOString().slice(0, 10) ? "text-rose-600" : "text-gray-500"}`}>{s.endDate ? s.endDate.slice(5) : "—"}</td>
                      <td className={`py-2 pr-3 ${s.risk === "High" ? "text-rose-600" : s.risk === "Medium" ? "text-amber-600" : "text-gray-500"}`}>{s.risk}</td>
                      <td className="py-2 pr-3"><span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">{s.returned ? "Returned" : "Pending"}</span></td>
                      <td className="py-2"><Link href={`/unit-manager/competency-validations?id=${s.id}`} className="text-teal-700 hover:underline">Review</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Showing {Math.min(8, d.queue.length)} of {d.queue.length}. High-risk first. AI validation insight is rule-based over score + risk.</p>
            </div>
          )}
        </div>

        {/* Review panel */}
        <div className={`${card} p-5 xl:col-span-1`}>
          {!r ? <div className="text-center py-8"><p className="text-2xl mb-2">🗂️</p><p className="text-sm text-gray-400">Select a competency to validate.</p></div> : (
            <>
              <div className="flex items-start justify-between mb-2"><div><h3 className="text-sm font-bold text-gray-900">{r.competency}</h3><p className="text-[10px] text-gray-400">{r.learner} · {r.code} · {r.type}</p></div><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold h-fit ${PRI[r.priority]}`}>{r.priority}</span></div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-gray-100 p-2.5"><p className="text-[10px] font-bold text-gray-500 uppercase">Overall Score</p><p className={`text-lg font-bold ${r.score != null && r.score >= 80 ? "text-green-600" : r.score != null && r.score >= 70 ? "text-amber-600" : "text-rose-600"}`}>{r.score != null ? `${r.score}%` : "—"}</p><p className="text-[10px] text-gray-400">Standard 80%</p></div>
                <div className="rounded-lg bg-violet-50/50 border border-violet-100 p-2.5"><p className="text-[10px] font-bold text-violet-700 uppercase">AI Insight</p><p className="text-sm font-bold text-violet-700">{r.aiRec}</p><p className="text-[10px] text-gray-500">{r.aiConfidence}% confidence</p></div>
              </div>
              <div className="mt-3"><p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Rationale</p><ul className="text-[11px] text-gray-600 space-y-0.5">{r.rationale.map((x: string, i: number) => <li key={i}>✓ {x}</li>)}</ul></div>
              <div className="mt-3"><p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Risk Indicators</p><div className="space-y-0.5">{r.riskIndicators.map((x: any, i: number) => <div key={i} className="flex items-center gap-1.5 text-[11px]"><span className={`w-1.5 h-1.5 rounded-full ${DOT[x.tone]}`} /><span className="text-gray-600">{x.label}</span></div>)}</div></div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-gray-400"><span>Status: <b className="text-gray-600">{r.returned ? "Returned" : "Pending"}</b></span><span>Risk: <b className="text-gray-600">{r.risk}</b></span></div>
              <div className="mt-3"><ValidationActions scoreId={r.id} validated={r.educator_validated} /></div>
            </>
          )}
        </div>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Validations by Type</h3>
          {d.byType.length === 0 ? <p className="text-sm text-gray-400">No pending validations.</p> : (
            <div className="flex items-center gap-3"><Donut total={k.pending} segs={d.byType.map((x: any, i: number) => ({ n: x.n, color: TYPE_COLOR[i % 6] }))} /><div className="text-[11px] space-y-0.5 flex-1">{d.byType.slice(0, 5).map((x: any, i: number) => <div key={x.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLOR[i % 6] }} /><span className="text-gray-600 flex-1 capitalize">{x.label}</span><b>{x.n}</b></div>)}</div></div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Validations by Status</h3>
          <div className="flex items-center gap-3"><Donut total={d.byStatus.reduce((a: number, x: any) => a + x.n, 0)} segs={d.byStatus.map((x: any) => ({ n: x.n, color: STATUS_COLOR[x.label] ?? "#9ca3af" }))} /><div className="text-[11px] space-y-0.5 flex-1">{d.byStatus.map((x: any) => <div key={x.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: STATUS_COLOR[x.label] ?? "#9ca3af" }} /><span className="text-gray-600 flex-1">{x.label}</span><b>{x.n}</b></div>)}</div></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Validation Trend (7d)</h3>
          <div className="flex items-end gap-1 h-20">{d.trend.map((t: any, i: number) => { const max = Math.max(1, ...d.trend.map((x: any) => x.validated)); return <div key={i} className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full bg-teal-400 rounded-t" style={{ height: `${(t.validated / max) * 100}%`, minHeight: t.validated ? 3 : 0 }} title={`${t.date}: ${t.validated}`} /></div>; })}</div>
          <p className="text-[10px] text-gray-400 mt-1">Validated per day.</p>
        </div>
        <div className={`${card} p-5 bg-gradient-to-br from-violet-50/40 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI Early Warnings</h3>
          {d.aiWarn.length === 0 ? <p className="text-sm text-gray-400">No warnings.</p> : (
            <div className="space-y-2">{d.aiWarn.map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${DOT[a.tone]}`} /><p className="text-xs text-gray-700 flex-1">{a.title}</p><span className={`text-[9px] px-1 rounded ${a.sev === "High" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}>{a.sev}</span></div>))}</div>
          )}
        </div>
      </div>

      {/* Recently completed + frameworks + quick actions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recently Completed</h3>
          {d.recentlyCompleted.length === 0 ? <p className="text-sm text-gray-400">No validations completed yet.</p> : (
            <div className="space-y-1.5">{d.recentlyCompleted.map((s: any) => (<div key={s.id} className="flex items-center gap-2 text-xs"><span className="text-green-600">✓</span><span className="text-gray-700 flex-1 truncate">{s.competency} · {s.learner}</span><span className="text-green-600">Validated</span><span className="text-gray-400">{relTime(s.validated_at)}</span></div>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Standards &amp; Frameworks</h3>
          {d.frameworks.length === 0 ? <p className="text-sm text-gray-400">No frameworks configured.</p> : (
            <div className="space-y-1">{d.frameworks.map((f: any, i: number) => <div key={i} className="flex items-center justify-between text-xs py-0.5"><span className="text-gray-700 truncate">{f.name}</span><span className="text-green-600 text-[10px]">Active</span></div>)}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-1.5">{QUICK.map(([label, href]: any) => href ? <Link key={label} href={href} className="text-[10px] text-gray-700 border border-gray-100 rounded-lg px-1.5 py-2 hover:border-teal-300 hover:bg-teal-50/40 text-center">{label}</Link> : <span key={label} className="text-[10px] text-gray-300 border border-gray-100 rounded-lg px-1.5 py-2 text-center" title="Not wired yet">{label}</span>)}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Competency Validations Workspace (UMW-EA-004) is the Unit Manager&apos;s competency decision centre over the live competency store — passing competency_scores awaiting validation, joined to their cycle (learner) and framework competency (name, risk category). KPIs, queue, review panel with rule-based AI validation insight + risk indicators, by-type/status analytics, weekly trend and AI early-warning are all real; decisions run through the audited /api/educator/validate route (Approve→validate, Reject/Return/Request-Info→return). Evidence/OSCE/Simulation document review, assign-learning/escalate cross-actions, and the deep Evidence/Workflows/Analytics/Calendar tabs are next-phase. <Link href="/unit-manager/action-centre" className="text-teal-700 hover:underline">← Executive Actions</Link></p>
    </div>
  );
}
