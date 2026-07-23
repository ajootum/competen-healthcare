import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadReplacement, ROLE_LABEL } from "@/lib/operations/attendance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";
import ReplacementActions from "./ReplacementActions";

export const dynamic = "force-dynamic";

// Replacement & Redeployment (UMW-WFM-005 §17) — the operational response to attendance gaps.
// The eligible candidate pool + the request workflow (raise → offer → fill/cancel) are real over
// op_replacement_requests (migration 083). Ranked candidate scoring (competency/rest/cost) and
// the full redeployment approval chain are next-phase. Deployment also runs via Staffing Engine.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

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
    loadReplacement(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
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

  const gaps = d.gaps.length;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Gaps to fill" value={gaps} tone={gaps ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Open requests" value={d.open.length} tone={d.open.length ? "text-amber-600" : undefined} />
        <Kpi label="Filled today" value={d.filledToday} tone="text-emerald-600" />
        <Kpi label="Candidate pool" value={d.kpis.replacements} tone="text-violet-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Replacement requests &amp; gaps <span className="text-[10px] text-gray-400 font-normal">raise · fill · cancel</span></h3>
          <ReplacementActions gaps={d.gaps} open={d.open} pool={d.pool} />
          <p className="text-[10px] text-gray-400 mt-2">A no-show triggers a staffing-impact assessment + replacement workflow (BR-ATT-007). A candidate must meet competency, credential and working-hour rules (BR-ATT-005). Ranked candidate scoring + the full redeployment approval chain are next-phase; deployment also runs via the <Link href="/unit-manager/workforce-management/staffing-engine" className="text-emerald-700 hover:underline">Staffing Engine</Link>.</p>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Candidate pool <span className="text-[10px] text-gray-400 font-normal">off-shift clinical</span></h3>
          {(d.pool ?? []).length === 0 ? <p className="text-sm text-gray-400">No off-shift clinical staff available.</p> : <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">{d.pool.map((p: any, i: number) => (<div key={i} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 px-2.5 py-1.5"><span className="text-gray-700 font-medium">{p.full_name ?? "Staff"}</span><span className="text-[10px] text-gray-400">{ROLE_LABEL[p.role] ?? p.role}</span></div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Replacement &amp; Redeployment (UMW-WFM-005 §17). Candidate pool + request workflow are real over op_replacement_requests; ranked scoring + redeployment approval chain are next-phase. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
