import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// Workforce Management (UMW-WFM-000) — the Unit Manager's operational hub for workforce
// planning, deployment, competency readiness and staffing optimisation. Overview reuses
// the live workforce engine (loadWorkforceOps over op_shift_staff / op_staffing_standards
// / op_patient_assignments / op_staff_breaks / op_supervisor_notes): real KPIs, per-role
// staffing, skill-mix compliance, alerts, breaks and a rule-based AI recommendation.
// Honest states where nothing is stored (hourly coverage history, future roster, leave).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const STATUS_BADGE: Record<string, string> = { Good: "bg-emerald-50 text-emerald-700", "At Risk": "bg-amber-50 text-amber-700", "Below Required": "bg-rose-50 text-rose-700", "—": "bg-gray-100 text-gray-500" };
const TABS = ["Overview", "Staffing Engine", "Team Assignments", "Roster & Scheduling", "Competency Readiness", "Break Management", "Supervisor Notes", "Analytics"];

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function WorkforceManagement() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [w, departments] = await Promise.all([
    loadWorkforceOps(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Management</h1><p className="text-sm text-gray-500">Plan, allocate and optimise your workforce to deliver safe, efficient care.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!w.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift / operational data</p><p className="text-sm text-amber-800 mt-1">Workforce Management activates once an operational shift with staffing is running for this unit.</p></div></div>;

  const ov = w.overviewTotal;
  const skill = w.skillMix;
  const breaksDue = w.breaks?.provisioned && !("error" in w.breaks) ? (w.breaks.due ?? 0) : null;
  const overtimeRisk = w.kpis.criticalGaps > 0 ? "High" : (ov.variance != null && ov.variance < 0) ? "Medium" : "Low";
  const coveragePct = ov.coverage ?? null;

  // Rule-based AI recommendation (honest — from live staffing state)
  const worst = [...w.staffingOverview].filter((r: any) => r.coverage != null).sort((a: any, b: any) => (a.coverage ?? 999) - (b.coverage ?? 999))[0];
  const floatAvail = (w.floatPool ?? []).filter((f: any) => f.status === "Available").length;
  const aiRec = worst && worst.coverage != null && worst.coverage < 100
    ? `${worst.label} coverage is ${worst.coverage}%${floatAvail ? ` — consider deploying ${Math.min(floatAvail, Math.max(1, -(worst.variance ?? 1)))} of ${floatAvail} available float staff` : " — review deployment to close the gap"} to optimise coverage and reduce overtime risk.`
    : "Staffing is balanced across roles — no reallocation required this shift.";

  // Top alerts from live state
  const alerts: { icon: string; title: string; sub: string; tone: string }[] = [];
  const under = w.openShifts ?? [];
  if (under.length) alerts.push({ icon: "🧑‍⚕️", title: `${under.length} role${under.length === 1 ? "" : "s"} under-staffed`, sub: under.map((u: any) => `${u.role} (-${u.positions})`).slice(0, 2).join(", "), tone: "rose" });
  if (breaksDue) alerts.push({ icon: "☕", title: `${breaksDue} break${breaksDue === 1 ? "" : "s"} due soon`, sub: "Assign relief cover", tone: "amber" });
  if (w.absence?.total) alerts.push({ icon: "🏖️", title: `${w.absence.total} staff on leave / absent`, sub: "Today", tone: "gray" });
  if (w.kpis.criticalGaps) alerts.push({ icon: "⚠", title: `${w.kpis.criticalGaps} critical staffing gap(s)`, sub: "Immediate action", tone: "rose" });

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Staff on shift" value={`${ov.present}/${ov.planned}`} sub={coveragePct != null ? `${coveragePct}% coverage` : "coverage n/a"} icon="👥" />
        <Kpi label="Skill mix score" value={skill.pct != null ? `${skill.pct}%` : "—"} sub={skill.pct != null ? (skill.pct >= 85 ? "Optimal" : skill.pct >= 70 ? "Adequate" : "Review") : "No competency data"} icon="🛡️" tone={skill.pct != null && skill.pct >= 85 ? "text-emerald-600" : undefined} />
        <Kpi label="Overtime risk" value={overtimeRisk} sub="Derived from gaps" icon="⏰" tone={overtimeRisk === "High" ? "text-rose-600" : overtimeRisk === "Medium" ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Breaks due" value={breaksDue ?? "—"} sub={breaksDue != null ? "Within 60 min" : "Run migration 069"} icon="☕" tone={breaksDue ? "text-amber-600" : undefined} />
        <Kpi label="Open shifts" value={w.openShiftCount ?? 0} sub="Require action" icon="📅" tone={(w.openShiftCount ?? 0) ? "text-rose-600" : undefined} />
        <Kpi label="Leave / absent" value={w.absence?.total ?? 0} sub="Today" icon="🏖️" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Staffing overview */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Staffing overview</h3>
          <table className="w-full text-xs"><thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Role</th><th className="py-1.5 font-medium text-right">Req</th><th className="py-1.5 font-medium text-right">On</th><th className="py-1.5 font-medium text-right">Cover</th><th className="py-1.5 font-medium text-right">Status</th></tr></thead>
            <tbody>{w.staffingOverview.map((r: any) => (<tr key={r.role} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{r.label}</td><td className="py-1.5 text-right text-gray-600">{r.required ?? "—"}</td><td className="py-1.5 text-right text-gray-600">{r.present}</td><td className="py-1.5 text-right font-semibold">{r.coverage != null ? `${r.coverage}%` : "—"}</td><td className="py-1.5 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{r.status}</span></td></tr>))}</tbody>
            <tfoot><tr className="border-t border-gray-200"><td className="py-1.5 font-bold text-gray-800">Overall</td><td className="py-1.5 text-right font-bold">{ov.required ?? "—"}</td><td className="py-1.5 text-right font-bold">{ov.present}</td><td className="py-1.5 text-right font-bold text-emerald-600" colSpan={2}>{coveragePct != null ? `${coveragePct}%` : "—"}</td></tr></tfoot>
          </table>
        </div>

        {/* Coverage by time (honest) */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Coverage by time</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-4 text-center"><p className="text-sm text-gray-500">A 24-hour coverage timeline needs per-hour staffing history, which isn&apos;t captured yet.</p><p className="text-[11px] text-gray-400 mt-1">Showing current coverage instead — the hourly trend is an honest next-phase state.</p></div>
          <div className="mt-3"><div className="flex items-center justify-between text-xs mb-1"><span className="text-gray-600">Present vs required (now)</span><b>{ov.present}/{ov.required ?? "—"}</b></div><div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${coveragePct != null && coveragePct >= 90 ? "bg-emerald-500" : coveragePct != null && coveragePct >= 75 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${Math.min(100, coveragePct ?? 0)}%` }} /></div></div>
        </div>

        {/* Top alerts */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Top alerts</h3>
          {alerts.length === 0 ? <p className="text-sm text-gray-400">No workforce alerts. 🎉</p> : <div className="space-y-2">{alerts.map((a, i) => (<div key={i} className="flex items-start gap-2.5"><span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 ${a.tone === "rose" ? "bg-rose-50" : a.tone === "amber" ? "bg-amber-50" : "bg-gray-50"}`}>{a.icon}</span><div><p className="text-xs font-semibold text-gray-800">{a.title}</p><p className="text-[11px] text-gray-500">{a.sub}</p></div></div>))}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Assignments by role */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Today&apos;s assignments <span className="text-[10px] text-gray-400 font-normal">by role</span></h3>
          <div className="space-y-2">{w.staffingOverview.map((r: any) => (<div key={r.role} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{r.label}</span><span className="text-gray-500">{r.present}/{r.required ?? "—"} · {r.assigned} pt</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${r.status === "Good" ? "bg-emerald-500" : r.status === "At Risk" ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${Math.min(100, r.coverage ?? 0)}%` }} /></div></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">By-unit breakdown needs per-unit establishment (honest next-phase).</p>
        </div>

        {/* Open shifts / gaps */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shifts requiring staff</h3>
          {(w.openShifts ?? []).length === 0 ? <p className="text-sm text-gray-400">No open shifts — all roles covered.</p> : <div className="space-y-2">{(w.openShifts ?? []).map((u: any, i: number) => (<div key={i} className="flex items-center justify-between rounded-lg border border-gray-100 p-2.5"><div><p className="text-xs font-semibold text-gray-800">{u.role}</p><p className="text-[11px] text-gray-500">{u.positions} position{u.positions === 1 ? "" : "s"} open</p></div><span className={`text-[10px] px-1.5 py-0.5 rounded ${u.urgency === "Urgent" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{u.urgency}</span></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-2">Future roster scheduling is a next-phase build — these are current-shift gaps.</p>
        </div>

        {/* Skill mix snapshot */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Skill mix snapshot</h3>
          {skill.total === 0 || skill.pct == null ? <div className="text-center py-6"><p className="text-3xl mb-2">🛡️</p><p className="text-sm text-gray-500">No competency scores for on-shift staff yet.</p></div> : (
            <div className="flex items-center gap-4"><div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: `conic-gradient(#10b981 0% ${(skill.compliant / skill.total) * 100}%, #f59e0b ${(skill.compliant / skill.total) * 100}% ${((skill.compliant + skill.minor) / skill.total) * 100}%, #ef4444 ${((skill.compliant + skill.minor) / skill.total) * 100}% 100%)` }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900">{skill.pct}%</span><span className="text-[8px] text-gray-400">Skill mix</span></div></div>
              <div className="text-[11px] space-y-1 flex-1"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500" /><span className="text-gray-600 flex-1">Compliant</span><b>{skill.compliant}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-500" /><span className="text-gray-600 flex-1">Developing</span><b>{skill.minor}</b></div><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-rose-500" /><span className="text-gray-600 flex-1">Below required</span><b>{skill.major}</b></div></div>
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Competency compliance of on-shift staff (real). Expert/novice proficiency tiers aren&apos;t stored.</p>
        </div>
      </div>

      {/* AI recommendation */}
      <div className={`${card} p-4 bg-gradient-to-br from-emerald-50/40 to-white flex items-start justify-between gap-3`}>
        <div className="flex items-start gap-2.5"><span className="text-lg">✨</span><div><p className="text-sm font-bold text-gray-900">AI recommendation</p><p className="text-xs text-gray-600 mt-0.5">{aiRec}</p></div></div>
        <span className="text-[10px] text-gray-400 whitespace-nowrap">Advisory · needs approval</span>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Management (UMW-WFM-000) is the Unit Manager&apos;s workforce hub over the live workforce engine (op_shift_staff, op_staffing_standards, op_patient_assignments, op_staff_breaks, op_supervisor_notes). Real: per-role staffing &amp; coverage, skill-mix compliance, open-shift gaps, breaks, absence and the rule-based AI recommendation (advisory, needs manager approval). Honest next-phase: the 24-hour coverage timeline (no hourly history), future roster building &amp; shift swaps, expert/novice proficiency tiers, per-unit establishment, and the Staffing Engine / Roster / Analytics deep tabs. Break Management &amp; Supervisor Notes reuse the live <Link href="/supervisor/workforce-operations" className="text-emerald-700 hover:underline">workforce stores</Link>.</p>
    </div>
  );
}
