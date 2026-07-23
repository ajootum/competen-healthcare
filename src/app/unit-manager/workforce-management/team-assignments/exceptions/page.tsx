import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTaExceptions } from "@/lib/operations/team-assignments";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import TeamGovTabs from "../TeamGovTabs";

export const dynamic = "force-dynamic";

// Assignment Exceptions (TAG-001 §5) — evaluates the exception catalogue (EX-001..015) into a
// governance work queue over live op_* data, each row carrying its rule evidence
// (explainability). Real detection; lifecycle/SLA/owner/override need an exception store →
// honest next-phase (every derived exception is state "Open").
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-amber-50 text-amber-700", Medium: "bg-sky-50 text-sky-700", Low: "bg-gray-100 text-gray-500" };
const DOT: Record<string, string> = { Critical: "bg-rose-500", High: "bg-amber-500", Medium: "bg-sky-500", Low: "bg-gray-400" };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function AssignmentExceptions() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadTaExceptions(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧩</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Team Assignments · Assignment Exceptions</h1><p className="text-sm text-gray-500">Detect, prioritise and act on unsafe or non-compliant assignment conditions.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <TeamGovTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift / operational data</p><p className="text-sm text-amber-800 mt-1">Exception evaluation activates once operational shifts with assignments are running.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Open exceptions" value={k.open} sub="In current scope" tone={k.open ? "text-gray-900" : "text-emerald-600"} />
        <Kpi label="Critical" value={k.critical} sub="Hard breach" tone={k.critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="High" value={k.high} sub="Priority action" tone={k.high ? "text-amber-600" : undefined} />
        <Kpi label="Other" value={k.medium} sub="Medium / low" />
        <Kpi label="Families" value={k.families} sub="Distinct types" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Work queue */}
        <div className={`${card} p-5 xl:col-span-3`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Exception work queue <span className="text-[10px] text-gray-400 font-normal">critical first · {d.rows.length} open</span></h3>
          {d.rows.length === 0 ? <p className="text-sm text-gray-400">No exceptions — assignments are within policy. 🎉</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">ID</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Scope</th><th className="py-2 pr-3 font-medium">Detail</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 font-medium">Recommended action</th></tr></thead>
              <tbody>{d.rows.map((r: any, i: number) => (<tr key={i} className="border-b border-gray-50 align-top"><td className="py-2 pr-3 text-gray-400 font-mono text-[10px] whitespace-nowrap">{r.code}</td><td className="py-2 pr-3"><span className="flex items-center gap-1.5 text-gray-800 font-medium">{r.icon}{r.title}</span><span className="text-[10px] text-gray-400">{r.evidence}</span></td><td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{r.scope}</td><td className="py-2 pr-3 text-gray-600">{r.detail}</td><td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${DOT[r.severity]}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[r.severity]}`}>{r.severity}</span></span></td><td className="py-2 text-gray-500">{r.recommended}</td></tr>))}</tbody>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Detection is live over op_shift_staff / op_patient_assignments / op_patients / op_staffing_standards. Acknowledge → assign owner → resolve/override/escalate lifecycle, SLA timers and reason-captured overrides need a dedicated exception store (next-phase); all rows here are state <span className="font-medium">Open</span>.</p>
        </div>

        {/* By family */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">By family</h3>
            {d.byFamily.length === 0 ? <p className="text-sm text-gray-400">None.</p> : <div className="space-y-2">{d.byFamily.map((f: any) => (<div key={f.family} className="flex items-center justify-between text-xs"><span className="text-gray-600">{f.family}</span><span className="font-semibold text-gray-800">{f.count}</span></div>))}</div>}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Resolve via</h3>
            <div className="space-y-1.5">
              {[["Workload Oversight", "/unit-manager/workforce-management/team-assignments/workload"], ["Competency Matching", "/unit-manager/workforce-management/team-assignments/competency"], ["Staffing Engine", "/unit-manager/workforce-management/staffing-engine"]].map(([l, h]) => (<Link key={l} href={h} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-emerald-200 hover:bg-emerald-50/30"><span className="text-xs text-gray-700">{l}</span><span className="text-gray-300">›</span></Link>))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Assignment Exceptions (TAG-001 §5) evaluates the exception catalogue against live op_* data — insufficient coverage (EX-001), unassigned patients (EX-003), multiple primary assignments (EX-004), competency gaps (EX-005), workload imbalance (EX-009), high-acuity mismatch (EX-011) and ratio breach (EX-012). Each row shows its rule evidence. The full exception lifecycle (acknowledge / assign / resolve / override with reason+expiry / escalate) and SLA tracking are next-phase (need an exception store). <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
