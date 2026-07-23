import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTeamAssignments } from "@/lib/operations/team-assignments";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";

export const dynamic = "force-dynamic";

// Team Assignment Governance & Oversight (UMW-WFM-002) — the Unit Manager's managerial
// oversight of assignments across active shifts (NOT routine allocation, which the Shift
// Supervisor owns). Live per-shift coverage, exception queue, workload + competency-match
// by ward, real recent overrides + policy compliance, and a rule-based AI recommendation,
// all over live op_* data. Cross-unit deployment requests have no store → honest state.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SUBTABS = ["Live Overview", "Assignment Exceptions", "Workload Oversight", "Competency Matching", "Cross-Unit Deployments", "Rules & Templates", "History & Audit"];
const SEV: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700" };
const WL: Record<string, string> = { High: "bg-rose-500", Medium: "bg-amber-500", Good: "bg-emerald-500" };
const WL_BADGE: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Good: "bg-emerald-50 text-emerald-700", "At risk": "bg-amber-50 text-amber-700" };
const SHIFT_ICON: Record<string, string> = { day: "☀️", evening: "🌙", night: "🌑", long_day: "🌗", on_call: "📟" };
const cap = (s: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "");

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function TeamAssignments() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadTeamAssignments(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧩</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Team Assignment Governance &amp; Oversight</h1><p className="text-sm text-gray-500">Monitor assignments, ensure safe coverage, approve exceptions and manage assignment policies.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift / operational data</p><p className="text-sm text-amber-800 mt-1">Assignment oversight activates once operational shifts with assignments are running.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Shifts in progress" value={k.activeShifts} sub="All active" icon="🗓️" />
        <Kpi label="Overall coverage" value={k.overallCoverage != null ? `${k.overallCoverage}%` : "—"} sub={k.overallCoverage != null ? (k.overallCoverage >= 90 ? "Good" : "Review") : "n/a"} icon="🛡️" tone={k.overallCoverage != null && k.overallCoverage >= 90 ? "text-emerald-600" : undefined} />
        <Kpi label="Patients covered" value={`${k.patientsCovered}/${k.totalPatients}`} sub={k.patientCoveragePct != null ? `${k.patientCoveragePct}% covered` : ""} icon="🧑" />
        <Kpi label="High acuity" value={k.highAcuity} sub={`${k.highAcuityNeedReview} need review`} icon="❤️" tone={k.highAcuity ? "text-rose-600" : undefined} />
        <Kpi label="Unassigned patients" value={k.unassigned} sub="Require action" icon="🧑‍🤝‍🧑" tone={k.unassigned ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Critical alerts" value={k.criticalAlerts} sub="Require attention" icon="🔔" tone={k.criticalAlerts ? "text-rose-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Live assignments */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Live assignments across active shifts</h3>
          {d.liveShifts.length === 0 ? <p className="text-sm text-gray-400">No active shifts.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Shift</th><th className="py-2 pr-3 font-medium">Unit / Ward</th><th className="py-2 pr-3 font-medium">Supervisor</th><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Patients</th><th className="py-2 pr-3 font-medium">Workload</th><th className="py-2 font-medium">Status</th></tr></thead>
              <tbody>{d.liveShifts.map((s: any) => (<tr key={s.id} className="border-b border-gray-50"><td className="py-2 pr-3"><span className="flex items-center gap-1.5">{SHIFT_ICON[s.shiftType] ?? "🕐"}<span className="text-gray-800 font-medium">{cap(s.shiftType)}</span></span></td><td className="py-2 pr-3 text-gray-600">{s.ward}</td><td className="py-2 pr-3 text-gray-600 truncate max-w-[90px]">{s.supervisor}</td><td className="py-2 pr-3 text-gray-700">{s.present}/{s.scheduled}{s.staffCov != null && <span className="text-gray-400"> · {s.staffCov}%</span>}</td><td className="py-2 pr-3 text-gray-700">{s.covPatients}/{s.totalP}{s.patientCov != null && <span className="text-gray-400"> · {s.patientCov}%</span>}</td><td className="py-2 pr-3"><span className={`inline-flex items-center gap-1 ${s.workload === "High" ? "text-rose-600" : s.workload === "Moderate" ? "text-amber-600" : "text-emerald-600"}`}><span className={`w-1.5 h-1.5 rounded-full ${s.workload === "High" ? "bg-rose-500" : s.workload === "Moderate" ? "bg-amber-500" : "bg-emerald-500"}`} />{s.workload}</span></td><td className="py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === "On track" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{s.status}</span></td></tr>))}</tbody>
            </table></div>
          )}
        </div>

        {/* Exceptions */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Assignment exceptions</h3><span className="text-[10px] text-gray-400">{d.exceptionCounts.all} total</span></div>
          {d.exceptions.length === 0 ? <p className="text-sm text-gray-400">No exceptions — assignments are within policy. 🎉</p> : <div className="space-y-2">{d.exceptions.slice(0, 6).map((e: any, i: number) => (<div key={i} className="flex items-start gap-2.5 rounded-lg border border-gray-100 p-2.5"><span className="text-base shrink-0">{e.icon}</span><div className="flex-1 min-w-0"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-800 truncate">{e.title}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEV[e.severity]}`}>{e.severity}</span></div><p className="text-[11px] text-gray-500">{e.context} · {e.detail}</p></div></div>))}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Workload overview */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Workload overview <span className="text-[10px] text-gray-400 font-normal">today · by ward</span></h3>
          {d.workloadByWard.length === 0 ? <p className="text-sm text-gray-400">No patient data.</p> : <div className="space-y-2">{d.workloadByWard.map((w: any) => (<div key={w.ward} className="flex items-center gap-3 text-xs"><span className="text-gray-700 w-28 truncate">{w.ward}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${WL[w.status]}`} style={{ width: `${w.score}%` }} /></div><span className="text-gray-600 w-7 text-right font-semibold">{w.score}</span><span className={`text-[9px] px-1.5 py-0.5 rounded w-14 text-center ${WL_BADGE[w.status]}`}>{w.status}</span></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-2">Workload score = patient load × acuity weighting (derived). Trend needs history (next-phase).</p>
        </div>

        {/* Competency match */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Competency match overview <span className="text-[10px] text-gray-400 font-normal">by ward</span></h3>
          {d.competencyByWard.length === 0 ? <p className="text-sm text-gray-400">No validated assignments yet — competency validation runs during Supervisor allocation.</p> : <div className="space-y-2">{d.competencyByWard.map((c: any) => (<div key={c.ward} className="flex items-center gap-3 text-xs"><span className="text-gray-700 w-28 truncate">{c.ward}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${(c.pct ?? 0) >= 80 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${c.pct ?? 0}%` }} /></div><span className="text-gray-600 w-9 text-right font-semibold">{c.pct != null ? `${c.pct}%` : "—"}</span><span className={`text-[9px] px-1.5 py-0.5 rounded w-14 text-center ${WL_BADGE[c.status] ?? "bg-gray-100 text-gray-500"}`}>{c.status}</span></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-2">% of active assignments with competency_validated = true.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Cross-unit deployments (honest) */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Cross-unit deployment requests</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-4 text-center"><p className="text-sm text-gray-500">No cross-unit deployment request store yet.</p><p className="text-[11px] text-gray-400 mt-1">Formal cross-unit deployment requests (with From/To ward, role count and priority) and their manager approval flow are a next-phase build — shown honestly rather than as fabricated requests. Related staffing approvals live in <Link href="/unit-manager/approvals" className="text-emerald-700 hover:underline">Executive Actions</Link>.</p></div>
        </div>

        {/* Recent overrides */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent overrides</h3>
          {d.overrides.length === 0 ? <p className="text-sm text-gray-400">No assignment overrides recorded.</p> : <div className="space-y-1.5">{d.overrides.map((o: any, i: number) => (<div key={i} className="text-xs rounded-lg border border-gray-100 p-2"><div className="flex items-center justify-between"><span className="text-gray-800 font-medium">{o.patient} · {o.staff}</span>{o.today && <span className="text-[9px] text-amber-600">Today</span>}</div><p className="text-[11px] text-gray-500 truncate">{o.reason}</p></div>))}</div>}
        </div>

        {/* Quick actions & approvals */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Quick actions &amp; approvals</h3>
          <div className="space-y-1.5">
            {[["Review staffing approvals", "/unit-manager/approvals"], ["View Executive Actions", "/unit-manager/action-centre"], ["Staffing Engine", "/unit-manager/workforce-management/staffing-engine"]].map(([l, h]) => (<Link key={l} href={h} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-emerald-200 hover:bg-emerald-50/30"><span className="text-xs text-gray-700">{l}</span><span className="text-gray-300">›</span></Link>))}
            {[["Create assignment rule", "Assignment policies"], ["Create assignment template", "Standard team templates"]].map(([l, s]) => (<span key={l} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 cursor-default" title="Rules & Templates — next phase"><span><span className="text-xs text-gray-400 block">{l}</span><span className="text-[10px] text-gray-300">{s}</span></span><span className="text-gray-200">›</span></span>))}
          </div>
        </div>
      </div>

      {/* Policy compliance + AI insight */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Assignment policy compliance</h3>
          <div className="grid grid-cols-3 gap-3">
            <div><p className="text-[10px] text-gray-500 uppercase">Compliance rate</p><p className={`text-xl font-bold ${d.policy.complianceRate != null && d.policy.complianceRate >= 90 ? "text-emerald-600" : "text-amber-600"}`}>{d.policy.complianceRate != null ? `${d.policy.complianceRate}%` : "—"}</p><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden mt-1"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${d.policy.complianceRate ?? 0}%` }} /></div></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Overrides today</p><p className="text-xl font-bold text-gray-900">{d.policy.overridesToday}</p><p className="text-[10px] text-gray-400">With reason capture</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Violations</p><p className={`text-xl font-bold ${d.policy.violations ? "text-rose-600" : "text-emerald-600"}`}>{d.policy.violations}</p><p className="text-[10px] text-gray-400">Unvalidated · high-acuity</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Compliance = % of active assignments with validated competency. Violations = unvalidated assignments on high-acuity patients.</p>
        </div>
        <div className={`${card} p-5 bg-gradient-to-br from-emerald-50/40 to-white`}>
          <div className="flex items-start gap-2.5"><span className="text-lg">✨</span><div><p className="text-sm font-bold text-gray-900">AI insight</p><p className="text-xs text-gray-600 mt-1">{d.aiInsight}</p><p className="text-[10px] text-gray-400 mt-2">Advisory — AI recommendations require manager approval before execution.</p></div></div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Team Assignment Governance &amp; Oversight (UMW-WFM-002) gives the Unit Manager live oversight of assignments across active shifts without taking over routine allocation (owned by the Shift Supervisor). Real over live op_* data: per-shift staff + patient coverage, workload &amp; competency-match by ward (op_patient_assignments.competency_validated), recent overrides (override_reason) and policy compliance. Cross-unit deployment requests, assignment rules/templates, and trend history are honest next-phase states. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
