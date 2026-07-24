import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AnalyticsTabs from "../AnalyticsTabs";

export const dynamic = "force-dynamic";

// Metric Dictionary (UMW-WFM-008 §8) — the metric catalogue: stable key, definition, formula and
// critical rule for every workforce KPI. Real reference (single metric definition reused across
// dashboards + reports, §3.1). Owner/version/lineage editing needs a metric-registry store.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
// §8 metric catalogue
const METRICS = [
  { key: "WF-COV-001", name: "Demand Coverage %", formula: "productive_covered_hours / required_hours × 100", rule: "Required hours > 0; final/provisional status shown.", live: true },
  { key: "WF-FILL-001", name: "Roster Fill Rate %", formula: "filled_roster_slots / required_roster_slots × 100", rule: "Use latest published roster version as-of cutoff.", live: true },
  { key: "WF-ATT-001", name: "Attendance Rate %", formula: "confirmed_attended_hours / expected_rostered_hours × 100", rule: "Exclude approved leave from denominator only if tenant policy specifies.", live: true },
  { key: "WF-ABS-001", name: "Absence Rate %", formula: "absence_hours / scheduled_work_hours × 100", rule: "Category mapping must be governed.", live: true },
  { key: "WF-PUN-001", name: "Punctuality Rate %", formula: "on_time_shift_starts / confirmed_shift_starts × 100", rule: "Grace period comes from policy profile.", live: true },
  { key: "WF-RDY-001", name: "Role Readiness %", formula: "workers_ready_for_role / workers_required_or_assigned × 100", rule: "Readiness evaluated at effective time.", live: true },
  { key: "WF-CMP-001", name: "Competency Compliance %", formula: "valid_required_competencies / required_competencies × 100", rule: "Conditional and expired counted separately.", live: true },
  { key: "WF-OT-001", name: "Overtime Rate %", formula: "overtime_paid_hours / total_paid_hours × 100", rule: "Provisional until payroll reconciliation.", live: true },
  { key: "WF-UTL-001", name: "Productive Utilisation %", formula: "productive_deployed_hours / available_paid_hours × 100", rule: "Define exclusions for education, leave and non-productive duty.", live: false },
  { key: "WF-VAC-001", name: "Vacancy Rate %", formula: "vacant_funded_FTE / approved_funded_FTE × 100", rule: "Effective-date establishment snapshot.", live: true },
  { key: "WF-EXC-001", name: "Exception SLA Compliance %", formula: "cases_resolved_within_SLA / resolved_cases × 100", rule: "Pause rules and severity-specific SLA applied.", live: true },
  { key: "WF-RST-001", name: "Roster Stability Index", formula: "1 − weighted_post_publication_changes / published_assignments", rule: "Weights configured by change type and notice period.", live: false },
  { key: "WF-RED-001", name: "Redeployment Rate", formula: "redeployed_worker_shifts / attended_worker_shifts × 100", rule: "Count one worker-shift once; retain move details separately.", live: false },
  { key: "WF-DQ-001", name: "Data Completeness %", formula: "required_fact_fields_present / required_fact_fields_expected × 100", rule: "Reported per source and impacted metric.", live: true },
];

export default async function MetricDictionary() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const departments = await loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper);
  const liveCount = METRICS.filter(m => m.live).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📈</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics · Metric Dictionary</h1><p className="text-sm text-gray-500">Definitions, formulas and calculation rules for every workforce KPI.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AnalyticsTabs />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Registered metrics</p><p className="text-2xl font-bold text-gray-900 mt-1">{METRICS.length}</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Computed live</p><p className="text-2xl font-bold text-emerald-600 mt-1">{liveCount}</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Awaiting source store</p><p className="text-2xl font-bold text-amber-600 mt-1">{METRICS.length - liveCount}</p></div>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Metric catalogue <span className="text-[10px] text-gray-400 font-normal">§8 · single definition reused across dashboards + reports</span></h3>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Key</th><th className="py-2 pr-3 font-medium">Name</th><th className="py-2 pr-3 font-medium">Formula</th><th className="py-2 pr-3 font-medium">Critical rule</th><th className="py-2 font-medium">Status</th></tr></thead>
          <tbody>{METRICS.map(m => (<tr key={m.key} className="border-b border-gray-50 align-top"><td className="py-2 pr-3 font-mono text-[10px] text-gray-500 whitespace-nowrap">{m.key}</td><td className="py-2 pr-3 text-gray-800 font-medium">{m.name}</td><td className="py-2 pr-3 text-gray-600 font-mono text-[10px]">{m.formula}</td><td className="py-2 pr-3 text-gray-500">{m.rule}</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${m.live ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>{m.live ? "Live" : "Next phase"}</span></td></tr>))}</tbody>
        </table></div>
        <p className="text-[10px] text-gray-400 mt-2">Every KPI carries a stable metric key + version (§8). Times stored UTC, rendered in tenant timezone; half-open periods [start, end); late facts trigger recompute + a &ldquo;revised&rdquo; status (§8.1). Metric owner/steward, version history and lineage editing need a metric-registry store → next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Metric Dictionary (UMW-WFM-008 §8). The live metrics power the analytics workspaces; the rest need their source store (utilisation hours, roster-change history, redeployment records). <Link href="/unit-manager/workforce-management/analytics" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
