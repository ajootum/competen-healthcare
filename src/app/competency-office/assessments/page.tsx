import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAssessmentStatus } from "@/lib/assessment-status";

export const dynamic = "force-dynamic";

// Assessment Status (CMO-004) — the Assessment Operations Command Centre. Real over scheduled_assessments
// (pending/overdue/calendar) + assessments (completed/failed/by-method/trend/domain). Design follows the
// CMO-004 mockup; every value is real or an honest state — no fabricated targets or trend history.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (n: number) => (n >= 90 ? "text-emerald-600" : n >= 80 ? "text-amber-600" : "text-rose-600");
const cellTone = (n: number) => (n >= 90 ? "bg-emerald-500" : n >= 80 ? "bg-amber-400" : n >= 70 ? "bg-orange-400" : "bg-rose-500");
const todayLabel = () => new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const DOMAIN_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function Kpi({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href: string }) {
  return (
    <Link href={href} className={`${card} p-4 hover:border-teal-300 transition-colors block`}>
      <div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </Link>
  );
}

// Two-line SVG trend (completed green, failed red) over 12 weeks.
function TrendChart({ trend }: { trend: { weeks: string[]; completed: number[]; failed: number[] } }) {
  const w = 320, h = 120, n = trend.weeks.length;
  const max = Math.max(1, ...trend.completed, ...trend.failed);
  const line = (series: number[]) => series.map((v, i) => `${(i / Math.max(1, n - 1)) * w},${h - (v / max) * (h - 10) - 5}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <polyline points={line(trend.completed)} fill="none" stroke="#10b981" strokeWidth={2} strokeLinejoin="round" />
      <polyline points={line(trend.failed)} fill="none" stroke="#ef4444" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

export default async function AssessmentStatus() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadAssessmentStatus(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const k = d.kpis;
  const domTotal = d.domains.length || 1;
  const domDonut = d.domains.length ? (() => { let acc = 0; const segs = d.domains.map((dom: any, i: number) => { const a = (acc / domTotal) * 360; acc += 1; const b = (acc / domTotal) * 360; return `${DOMAIN_COLORS[i % DOMAIN_COLORS.length]} ${a}deg ${b}deg`; }); return `conic-gradient(${segs.join(", ")})`; })() : "conic-gradient(#e5e7eb 0deg 360deg)";
  const overviewTotal = d.overview.reduce((t: any, o: any) => ({ required: t.required + o.required, completed: t.completed + o.completed, pending: t.pending + o.pending, overdue: t.overdue + o.overdue }), { required: 0, completed: 0, pending: 0, overdue: 0 });

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div><h1 className="text-2xl font-bold text-gray-900">Assessment Status</h1><p className="text-sm text-gray-500">Assessment Operations Command Centre — scheduling to competency update.</p></div>
      <span className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-400">☰ Filters</span>
    </div>
  );
  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Assessment engine not provisioned</p><p className="text-sm text-amber-800 mt-1">No assessments or scheduled assessments for this tenant yet.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 shrink-0"><div className="w-12 h-12 rounded-full" style={{ background: `conic-gradient(${k.readiness >= 85 ? "#10b981" : k.readiness >= 70 ? "#f59e0b" : "#ef4444"} 0% ${k.readiness}%, #f3f4f6 ${k.readiness}% 100%)` }} /><div className="absolute inset-[20%] rounded-full bg-white flex items-center justify-center"><span className="text-[10px] font-bold text-gray-900">{k.readiness}%</span></div></div>
            <div><p className="text-xs text-gray-500">Overall Readiness</p><p className={`text-xl font-bold tabular-nums ${pctTone(k.readiness)}`}>{k.readiness}%</p></div>
          </div>
        </div>
        <Kpi icon="✅" tint="bg-emerald-50" label="Completed" value={k.completed.toLocaleString()} sub="completed & approved" href="/competency-office/assessments" />
        <Kpi icon="🕐" tint="bg-amber-50" label="Pending" value={k.pending} tone={k.pending ? "text-amber-600" : "text-gray-400"} sub="scheduled, not done" href="/competency-office/assessments" />
        <Kpi icon="⚠️" tint="bg-rose-50" label="Overdue" value={k.overdue} tone={k.overdue ? "text-rose-600" : "text-gray-400"} sub="immediate action" href="/competency-office/assessments" />
        <Kpi icon="❌" tint="bg-orange-50" label="Failed" value={k.failed} tone={k.failed ? "text-rose-600" : "text-gray-400"} sub="below pass — remediate" href="/competency-office/assessments" />
        <Kpi icon="🔁" tint="bg-violet-50" label="Reassessment Due" value={k.reassessmentDue} tone={k.reassessmentDue ? "text-amber-600" : "text-gray-400"} sub="expiring ≤30 days" href="/competency-office/credentialing" />
      </div>

      {/* Overview grid + trend + domain */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Assessment Status Overview</h3>
          <div className="flex gap-1 mb-2"><span className="text-[11px] bg-teal-600 text-white rounded-md px-2.5 py-1">By Type</span><span className="text-[11px] text-gray-400 px-2.5 py-1" title="Needs unit mapping (next-phase)">By Unit</span><span className="text-[11px] text-gray-400 px-2.5 py-1" title="Needs role mapping (next-phase)">By Role</span></div>
          {d.overview.length === 0 ? <p className="text-sm text-gray-400">No assessment data yet.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium text-right">Req</th><th className="py-1.5 font-medium text-right">Done</th><th className="py-1.5 font-medium text-right">Pend</th><th className="py-1.5 font-medium text-right">Over</th><th className="py-1.5 font-medium text-right">%</th></tr></thead>
              <tbody>{d.overview.map((o: any) => (<tr key={o.method} className="border-b border-gray-50"><td className="py-1.5 text-gray-700 truncate max-w-[7rem]">{o.method}</td><td className="py-1.5 text-right text-gray-600 tabular-nums">{o.required}</td><td className="py-1.5 text-right text-gray-600 tabular-nums">{o.completed}</td><td className="py-1.5 text-right text-gray-500 tabular-nums">{o.pending}</td><td className={`py-1.5 text-right tabular-nums ${o.overdue ? "text-rose-600" : "text-gray-400"}`}>{o.overdue}</td><td className={`py-1.5 text-right font-semibold tabular-nums ${pctTone(o.compliance)}`}>{o.compliance}%</td></tr>))}</tbody>
              <tfoot><tr className="border-t border-gray-200 font-bold"><td className="py-1.5 text-gray-800">Total</td><td className="py-1.5 text-right tabular-nums">{overviewTotal.required}</td><td className="py-1.5 text-right tabular-nums">{overviewTotal.completed}</td><td className="py-1.5 text-right tabular-nums">{overviewTotal.pending}</td><td className="py-1.5 text-right tabular-nums">{overviewTotal.overdue}</td><td className="py-1.5 text-right tabular-nums">{overviewTotal.required ? Math.round((overviewTotal.completed / overviewTotal.required) * 100) : 0}%</td></tr></tfoot>
            </table>
          )}
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-gray-900 text-sm">Assessment Trend</h3><span className="text-[10px] text-gray-400">last 12 weeks</span></div>
          <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-1"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Completed</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> Failed</span></div>
          <TrendChart trend={d.trend} />
          <p className="text-[10px] text-gray-400 mt-2">Completed &amp; failed by week (real). Pending/overdue trend lines need retained snapshots — next-phase.</p>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Readiness by Domain</h3><Link href="/competency-office/analytics" className="text-[11px] text-teal-600 hover:underline">Analytics →</Link></div>
          {d.domains.length === 0 ? <p className="text-sm text-gray-400">Domain readiness needs scored assessments.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24 shrink-0 rounded-full" style={{ background: domDonut }}><div className="absolute inset-[24%] rounded-full bg-white flex flex-col items-center justify-center"><span className={`text-base font-bold ${pctTone(k.readiness)}`}>{k.readiness}%</span><span className="text-[8px] text-gray-400">Ready</span></div></div>
              <div className="flex-1 space-y-1">{d.domains.map((dom: any, i: number) => (<div key={dom.name} className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOMAIN_COLORS[i % DOMAIN_COLORS.length] }} /><span className="text-gray-600 flex-1 truncate">{dom.name}</span><b className={`tabular-nums ${pctTone(dom.pct)}`}>{dom.pct}%</b></div>))}</div>
            </div>
          )}
        </div>
      </div>

      {/* Pending / Overdue / Completion-by-method */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Pending Assessments</h3>
          {d.pendingList.length === 0 ? <p className="text-sm text-gray-400">No pending assessments.</p> : (
            <div className="space-y-2">{d.pendingList.map((p: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{p.name}</p><p className="text-[10px] text-gray-400 truncate">{p.assessment}</p></div><span className="text-[10px] text-amber-600 font-medium shrink-0">{p.daysLeft}d left</span></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Overdue Assessments <span className="text-[10px] font-normal text-rose-500">action required</span></h3>
          {d.overdueList.length === 0 ? <p className="text-sm text-gray-400">No overdue assessments. 🎉</p> : (
            <div className="space-y-2">{d.overdueList.map((o: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{o.name}</p><p className="text-[10px] text-gray-400 truncate">{o.assessment}</p></div><span className="text-[10px] text-rose-600 font-medium shrink-0">{o.daysOverdue}d over</span></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Completion by Method</h3>
          {d.completionByMethod.length === 0 ? <p className="text-sm text-gray-400">No data.</p> : (
            <div className="space-y-2">{d.completionByMethod.map((u: any) => (<div key={u.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{u.name}</span><span className={`tabular-nums font-semibold ${pctTone(u.pct)}`}>{u.pct}%</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${cellTone(u.pct)}`} style={{ width: `${u.pct}%` }} /></div></div>))}</div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">By assessment method; by-unit completion needs unit assignment mapping — next-phase.</p>
        </div>
      </div>

      {/* Calendar + activity + AI */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Assessment Calendar <span className="text-[10px] font-normal text-gray-400">next 14 days</span></h3>
          {d.calendar.length === 0 ? <p className="text-sm text-gray-400">No scheduled assessments in the next 14 days.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-[10px]">
              <thead><tr className="text-gray-400"><th className="text-left font-medium py-1 pr-2">Type</th>{d.calDays.map((day: any) => <th key={day.key} className="font-medium py-1 px-1 text-center whitespace-nowrap">{day.label.split(" ")[0]}</th>)}</tr></thead>
              <tbody>{d.calendar.map((row: any) => (<tr key={row.method}><td className="text-gray-700 py-1 pr-2 whitespace-nowrap">{row.method}</td>{row.counts.map((c: number, i: number) => <td key={i} className={`text-center py-1 px-1 tabular-nums ${c ? "text-gray-800 font-semibold" : "text-gray-200"}`}>{c || "·"}</td>)}</tr>))}</tbody>
            </table></div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">✨ AI Assessment Insights</h3>
          {d.ai.length === 0 ? <p className="text-sm text-gray-400">No priority assessment actions.</p> : (
            <div className="space-y-2">{d.ai.slice(0, 4).map((a: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs text-gray-800 flex-1">{a.text}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${a.priority === "high" ? "bg-rose-50 text-rose-700" : a.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.priority}</span></div><p className="text-[10px] text-gray-400 mt-1">Why: {a.why}</p></div>))}</div>
          )}
        </div>
      </div>

      {/* Upcoming + activity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Upcoming Assessments</h3>
          {d.upcoming.length === 0 ? <p className="text-sm text-gray-400">No upcoming assessments scheduled.</p> : (
            <div className="divide-y divide-gray-50">{d.upcoming.map((u: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="text-gray-700 truncate">{u.method} · {u.name}</span><span className="text-gray-400 shrink-0">{new Date(u.at).toLocaleDateString([], { day: "2-digit", month: "short" })}</span></div>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Assessment Activity Feed</h3>
          {d.activity.length === 0 ? <p className="text-sm text-gray-400">No recent assessment activity.</p> : (
            <div className="divide-y divide-gray-50">{d.activity.slice(0, 8).map((a: any) => (<div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="text-gray-700 truncate">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 shrink-0">{a.actor?.full_name ?? "—"}</span></div>))}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Assessment Status (CMO-004) over scheduled_assessments (pending/overdue/calendar/upcoming) + assessments (completed/failed/by-method/trend/domain readiness). Real: the 6 KPIs, by-method overview, 12-week completed/failed trend, domain readiness, named pending/overdue queues, the 14-day calendar, activity and rule-based explainable AI insights. Honest next-phase: assessment targets, pending/overdue historical trend lines, By-Unit/Role grouping (needs assignment mapping) and moderation/appeal workflows. Assessments are created &amp; scored in the <Link href="/admin/competencies" className="text-teal-700 hover:underline">assessment cycles</Link>. Source: assessment engine; calculated {todayLabel()}.</p>
    </div>
  );
}
