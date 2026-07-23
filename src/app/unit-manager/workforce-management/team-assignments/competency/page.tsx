import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTaCompetency } from "@/lib/operations/team-assignments";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import TeamGovTabs from "../TeamGovTabs";

export const dynamic = "force-dynamic";

// Competency Matching (TAG-001 §7) — assignment-level competency fit over
// op_patient_assignments.competency_validated. Match rate, match-by-ward and the gap queue
// are real; competency authoring, currency/expiry and the eligible-staff finder are owned by
// the Competency Engine (CME-001, §1.3 boundary) → cross-linked, not duplicated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const ST: Record<string, string> = { Validated: "bg-emerald-50 text-emerald-700", "Supervision required": "bg-sky-50 text-sky-700", "At risk": "bg-amber-50 text-amber-700", Critical: "bg-rose-50 text-rose-700", "—": "bg-gray-100 text-gray-500" };
const GAP_SEV: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-amber-50 text-amber-700", Watch: "bg-sky-50 text-sky-700" };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function CompetencyMatching() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadTaCompetency(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧩</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Team Assignments · Competency Matching</h1><p className="text-sm text-gray-500">Validate that every assignment has the right competency and scope-of-practice fit.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <TeamGovTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p><p className="text-sm text-amber-800 mt-1">Competency matching activates once operational assignments are running.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Match rate" value={k.matchRate != null ? `${k.matchRate}%` : "—"} sub="Validated ÷ requiring" tone={k.matchRate != null && k.matchRate >= 90 ? "text-emerald-600" : k.matchRate != null && k.matchRate >= 75 ? "text-amber-600" : "text-rose-600"} />
        <Kpi label="Critical gaps" value={k.criticalGaps} sub="Gap on high-acuity" tone={k.criticalGaps ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Competency gaps" value={k.gaps} sub="Validated = false" tone={k.gaps ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Unknown" value={k.unknown} sub="No validation record" tone={k.unknown ? "text-amber-600" : undefined} />
        <Kpi label="Requiring match" value={k.requiring} sub="Active assignments" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Match matrix by ward */}
        <div className={`${card} p-5 xl:col-span-3`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Match by unit <span className="text-[10px] text-gray-400 font-normal">validated / supervised / gap / unknown</span></h3>
          {d.byWard.length === 0 ? <p className="text-sm text-gray-400">No active assignments requiring competency match yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium text-right">Assignments</th><th className="py-2 pr-3 font-medium text-right">Validated</th><th className="py-2 pr-3 font-medium text-right">Gap</th><th className="py-2 pr-3 font-medium text-right">Unknown</th><th className="py-2 pr-3 font-medium text-right">Match</th><th className="py-2 font-medium">Status</th></tr></thead>
              <tbody>{d.byWard.map((w: any) => (<tr key={w.ward} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{w.ward}</td><td className="py-2 pr-3 text-right text-gray-600">{w.total}</td><td className="py-2 pr-3 text-right text-emerald-600 font-semibold">{w.validated}</td><td className={`py-2 pr-3 text-right ${w.gap ? "text-rose-600 font-semibold" : "text-gray-400"}`}>{w.gap || "—"}</td><td className={`py-2 pr-3 text-right ${w.unknown ? "text-amber-600" : "text-gray-400"}`}>{w.unknown || "—"}</td><td className="py-2 pr-3 text-right font-semibold">{w.pct != null ? `${w.pct}%` : "—"}</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[w.status]}`}>{w.status}</span></td></tr>))}</tbody>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">“Unknown” (no validation record) is treated as at-risk. Requirement sets resolved from the effective rule/template are next-phase — this uses the assignment-level validation flag.</p>
        </div>

        {/* Matching hierarchy + CME cross-link */}
        <div className="space-y-4 xl:col-span-2">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Matching hierarchy <span className="text-[10px] text-gray-400 font-normal">TAG §7.1</span></h3>
            <ol className="space-y-1 text-[11px] text-gray-600 list-decimal list-inside">
              <li>Role eligibility &amp; scope</li>
              <li>Mandatory credential currency</li>
              <li>Unit / clinical competencies</li>
              <li>Evidence currency window</li>
              <li>Supervision availability</li>
              <li>Restrictions / return-to-work</li>
              <li>Team complement</li>
            </ol>
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Currency &amp; evidence</h3>
            <p className="text-[11px] text-gray-500">Competency authoring, evidence, expiry/currency and the eligible-staff finder are owned by the Competency Engine (§1.3 boundary).</p>
            <div className="mt-2.5 space-y-1.5">
              <Link href="/unit-manager/scheduling-engine/competency-matching" className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-emerald-200 hover:bg-emerald-50/30"><span className="text-xs text-gray-700">Competency Matching Engine</span><span className="text-gray-300">↗</span></Link>
              <Link href="/unit-manager/competency-validations" className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-emerald-200 hover:bg-emerald-50/30"><span className="text-xs text-gray-700">Competency Validations</span><span className="text-gray-300">↗</span></Link>
            </div>
          </div>
        </div>
      </div>

      {/* Gap queue */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Competency gap queue <span className="text-[10px] text-gray-400 font-normal">critical first · {d.gapQueue.length}</span></h3>
        {d.gapQueue.length === 0 ? <p className="text-sm text-gray-400">No competency gaps — every active assignment is validated. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Patient</th><th className="py-2 pr-3 font-medium">Assigned worker</th><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Acuity</th><th className="py-2 pr-3 font-medium">Kind</th><th className="py-2 font-medium">Severity</th></tr></thead>
            <tbody>{d.gapQueue.map((g: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{g.patient}</td><td className="py-2 pr-3 text-gray-600">{g.staff}</td><td className="py-2 pr-3 text-gray-600">{g.ward}</td><td className={`py-2 pr-3 capitalize ${["critical", "high"].includes(g.acuity) ? "text-rose-600" : "text-gray-500"}`}>{g.acuity}</td><td className="py-2 pr-3"><span className="text-[10px] text-gray-500">{g.kind === "gap" ? "Validation failed" : "No record"}</span>{g.reason && <span className="block text-[10px] text-amber-600">override: {g.reason}</span>}</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${GAP_SEV[g.severity]}`}>{g.severity}</span></td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Resolve by reassigning to a validated worker, adding an authorised supervisor, or requesting urgent validation — action wiring runs through Supervisor allocation + the Competency Engine (next-phase inline).</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Competency Matching (TAG-001 §7) evaluates assignment-level competency fit over op_patient_assignments.competency_validated, tenant-scoped. The competency match matrix (required-competency columns), evidence drawer and eligible-staff finder consume the <Link href="/unit-manager/scheduling-engine/competency-matching" className="text-emerald-700 hover:underline">Competency Engine</Link> which owns currency/expiry authoring (§1.3). <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
