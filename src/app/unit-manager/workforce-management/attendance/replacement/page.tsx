import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAttendance, ROLE_LABEL } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Replacement & Redeployment (UMW-WFM-005 §17) — the operational response to attendance gaps.
// The eligible candidate pool (off-shift clinical staff) is real; the replacement/redeployment
// request workflow (offer → response → roster update → cost/audit) needs a replacement store →
// honest next-phase. Deployment itself is wired today via the Staffing Engine + Team Assignments.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const OPTIONS = ["Call off-duty staff", "Activate standby", "Activate on-call", "Offer overtime", "Approve shift extension", "Redeploy from another unit", "Request float-pool", "Request agency", "Adjust team assignments", "Escalate shortage"];

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function ReplacementRedeployment() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Replacement &amp; Redeployment</h1><p className="text-sm text-gray-500">The operational response to availability and attendance gaps.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p></div></div>;

  const gaps = d.register.filter((r: any) => r.status === "absent").length;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Gaps to fill" value={gaps} tone={gaps ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Candidate pool" value={d.kpis.replacements} tone="text-violet-600" />
        <Kpi label="Coverage after" value={d.kpis.coveragePct != null ? `${d.kpis.coveragePct}%` : "—"} tone={d.kpis.coverageState === "Below minimum" ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Attendance risk" value={d.kpis.riskLevel} tone={d.kpis.riskLevel === "Critical" || d.kpis.riskLevel === "High" ? "text-rose-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Eligible replacement candidates <span className="text-[10px] text-gray-400 font-normal">off-shift clinical staff</span></h3>
          {(d.replacementPool ?? []).length === 0 ? <p className="text-sm text-gray-400">No off-shift clinical staff available.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Candidate</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Availability</th><th className="py-2 font-medium">Deploy</th></tr></thead>
              <tbody>{d.replacementPool.map((p: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{p.full_name ?? "Staff"}</td><td className="py-2 pr-3 text-gray-500">{ROLE_LABEL[p.role] ?? p.role}</td><td className="py-2 pr-3"><span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">Off-shift</span></td><td className="py-2"><Link href="/unit-manager/workforce-management/staffing-engine" className="text-[10px] font-semibold text-emerald-700 hover:underline">Deploy →</Link></td></tr>))}</tbody>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">A replacement candidate must meet competency, credential and working-hour rules before being recommended (BR-ATT-005). Ranked candidate scoring (competency match, rest compliance, overtime fairness, cost) + the offer→response workflow need a replacement store. Actual deployment runs today via the <Link href="/unit-manager/workforce-management/staffing-engine" className="text-emerald-700 hover:underline">Staffing Engine</Link> + <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">Team Assignments</Link>.</p>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Replacement options <span className="text-[10px] text-gray-400 font-normal">§17.1</span></h3>
          <div className="space-y-1">{OPTIONS.map(o => (<div key={o} className="text-[11px] text-gray-600 rounded border border-gray-100 px-2 py-1.5">{o}</div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Redeployment controls (releasing/receiving unit approval, duration, competency confirmation, cost-centre, audit) are next-phase.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Replacement &amp; Redeployment (UMW-WFM-005 §17). Candidate pool is real; the offer/redeployment workflow store is next-phase. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
