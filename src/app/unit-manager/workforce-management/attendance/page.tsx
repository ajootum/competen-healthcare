import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import AttendanceTabs from "./AttendanceTabs";

export const dynamic = "force-dynamic";

// Live Overview (UMW-WFM-005 §7) — the default landing: a concise operational picture of
// workforce presence, availability and attendance risk. Real over op_shift_staff attendance
// state (§39 non-integrated implementation). KPIs, status distribution, critical alerts and
// timeline are real; check-in timestamps / late detection need an attendance-event store.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const RISK: Record<string, { tone: string; ring: string }> = { Low: { tone: "text-emerald-600", ring: "#10b981" }, Moderate: { tone: "text-amber-600", ring: "#f59e0b" }, High: { tone: "text-orange-600", ring: "#f97316" }, Critical: { tone: "text-rose-600", ring: "#e11d48" } };
const COV: Record<string, string> = { "Fully covered": "text-emerald-600", "Covered with redeployment": "text-emerald-600", "Below target": "text-amber-600", "Below minimum": "text-rose-600", "—": "text-gray-400" };
const SEG: Record<string, string> = { emerald: "bg-emerald-500", sky: "bg-sky-500", amber: "bg-amber-500", rose: "bg-rose-500", gray: "bg-gray-300" };
const ALERT: Record<string, string> = { Critical: "bg-rose-50 text-rose-700 border-rose-100", High: "bg-amber-50 text-amber-700 border-amber-100" };

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300" title="Data source">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function AttendanceLiveOverview() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadAttendance(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Availability &amp; Attendance</h1><p className="text-sm text-gray-500">Who is expected, present, absent or unavailable — and what action is needed.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p><p className="text-sm text-amber-800 mt-1">Attendance activates once an operational shift with staffing is running. Expected attendance is populated from the approved roster (§39).</p></div></div>;

  const k = d.kpis;
  const r = RISK[k.riskLevel] ?? RISK.Low;
  const distTotal = d.distribution.reduce((n: number, s: any) => n + s.n, 0) || 1;

  return (
    <div className="space-y-4">
      {header}

      {/* Summary KPI cards (§7.1) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Expected today" value={k.expected} sub="Rostered to report" foot="ⁱ" />
        <Kpi label="Present" value={k.present} sub={k.presentRate != null ? `${k.presentRate}% present rate` : ""} tone="text-emerald-600" foot="ⁱ" />
        <Kpi label="Not yet reported" value={k.notReported} sub="Scheduled, awaited" tone={k.notReported ? "text-amber-600" : undefined} foot="ⁱ" />
        <Kpi label="Absent" value={k.absent} sub={k.confirmed ? `${k.confirmed} confirmed` : "For this shift"} tone={k.absent ? "text-rose-600" : "text-emerald-600"} foot="ⁱ" />
        <Kpi label="Available replacements" value={k.replacements} sub="Clinical, off-shift" tone="text-violet-600" foot="ⁱ" />
        <Kpi label="Attendance risk" value={k.riskLevel} sub={`${k.pendingActions} pending actions`} tone={r.tone} foot="ⁱ" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Status distribution */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Attendance status distribution</h3>
          <div className="flex h-3 rounded-full overflow-hidden mb-3">{d.distribution.filter((s: any) => s.n > 0).map((s: any) => (<div key={s.label} className={SEG[s.tone]} style={{ width: `${(s.n / distTotal) * 100}%` }} title={`${s.label}: ${s.n}`} />))}</div>
          <div className="space-y-1.5">{d.distribution.map((s: any) => (<Link key={s.label} href="/unit-manager/workforce-management/attendance/today" className="flex items-center justify-between text-xs hover:bg-gray-50 rounded px-1 py-0.5"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${SEG[s.tone]}`} />{s.label}</span><span className="font-semibold text-gray-700">{s.n}</span></Link>))}</div>
        </div>

        {/* Coverage after attendance + risk gauge */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Coverage after attendance <span className="text-[9px] text-gray-300">ⁱ</span></h3>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0"><div className="w-20 h-20 rounded-full" style={{ background: k.coveragePct != null ? `conic-gradient(${r.ring} ${Math.min(100, k.coveragePct)}%, #f1f5f9 0)` : "#f1f5f9" }} /><div className="absolute inset-[20%] rounded-full bg-white flex items-center justify-center text-sm font-bold">{k.coveragePct != null ? `${k.coveragePct}%` : "—"}</div></div>
            <div><p className={`text-sm font-bold ${COV[k.coverageState]}`}>{k.coverageState}</p><p className="text-[11px] text-gray-500 mt-0.5">{k.present} present of {k.coverageBasis} {k.requiredKnown ? "required" : "expected"}</p><p className="text-[10px] text-gray-400 mt-1">{k.requiredKnown ? "vs op_staffing_standards minimum" : "no staffing standard set → vs expected"}</p></div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">{d.roleBreakdown.slice(0, 3).map((rb: any) => (<div key={rb.role} className="rounded-lg border border-gray-100 p-2"><p className="text-[10px] text-gray-400 truncate">{rb.label}</p><p className="text-sm font-bold text-gray-800">{rb.present}/{rb.expected}</p></div>))}</div>
        </div>

        {/* Critical alerts */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Critical attendance alerts</h3>
          {d.alerts.length === 0 ? <p className="text-sm text-gray-400">No critical attendance alerts. 🎉</p> : <div className="space-y-2">{d.alerts.slice(0, 5).map((a: any, i: number) => (<div key={i} className={`rounded-lg border p-2.5 ${ALERT[a.sev] ?? "bg-gray-50 border-gray-100"}`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-800">{a.title}</p><span className="text-[9px] px-1.5 py-0.5 rounded bg-white/60">{a.sev}</span></div><p className="text-[11px] text-gray-600 mt-0.5">{a.detail}</p><p className="text-[10px] text-gray-400 mt-0.5">→ {a.action}</p></div>))}</div>}
        </div>
      </div>

      {/* Live timeline + role breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Expected vs present by role</h3>
          <div className="space-y-2">{d.roleBreakdown.map((rb: any) => { const pct = rb.expected ? Math.round((rb.present / rb.expected) * 100) : 0; return (<div key={rb.role} className="flex items-center gap-3 text-xs"><span className="text-gray-600 w-32 truncate">{rb.label}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : pct >= 80 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${pct}%` }} /></div><span className="text-gray-700 w-16 text-right">{rb.present}/{rb.expected}{rb.absent ? ` · ${rb.absent} abs` : ""}</span></div>); })}</div>
          <Link href="/unit-manager/workforce-management/attendance/today" className="mt-3 inline-block text-[11px] font-semibold text-emerald-700 hover:underline">Open today&apos;s attendance register →</Link>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Live attendance timeline</h3>
          {d.timeline.length === 0 ? <p className="text-sm text-gray-400">No recent attendance events.</p> : <ol className="space-y-0">{d.timeline.slice(0, 8).map((t: any, i: number) => (<li key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /><div className="min-w-0"><p className="text-[11px] text-gray-700">{t.action === "record_attendance" ? "Attendance recorded" : t.action === "deploy_staff" ? "Staff deployed" : t.action === "open_shift" ? "Shift opened" : t.action === "schedule_break" ? "Break scheduled" : t.action === "raise_escalation" ? "Escalation raised" : t.action}</p><p className="text-[10px] text-gray-400">{t.actor_name || "System"} · {new Date(t.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p></div></li>))}</ol>}
          <p className="text-[10px] text-gray-400 mt-2">A per-event check-in/out timeline needs an attendance-event store (next-phase).</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Availability &amp; Attendance (UMW-WFM-005 §7) is real over op_shift_staff attendance state — the spec&apos;s §39 non-integrated implementation (approved roster = expected; Shift Supervisor confirmation = present/absent). <span className="text-gray-300">ⁱ</span> Source: approved roster, op_shift_staff attendance, op_staffing_standards. Check-in/out timestamps, minutes-late, absence sub-classification and biometric/payroll integration need an attendance-event + leave store → honest next-phase. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
