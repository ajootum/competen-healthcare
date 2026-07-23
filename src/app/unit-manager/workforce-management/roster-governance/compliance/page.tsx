import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadConstraintEngine } from "@/lib/operations/constraint-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Compliance & Constraints (UMW-WFM-004 §11) — the rules applied to the roster and where
// assignments violate or approach limits. Reuses the Scheduling Engine's Constraint Engine
// (WSE-001C) over the same roster store: per-rule pass/warning/block, per-unit compliance,
// top violated rules and recent overrides. Real. Full rule-family editor is next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const ST: Record<string, string> = { Pass: "bg-emerald-50 text-emerald-700", Warning: "bg-amber-50 text-amber-700", Override: "bg-orange-50 text-orange-700", Blocked: "bg-rose-50 text-rose-700" };
const SEV: Record<string, string> = { Pass: "text-gray-400", Medium: "text-sky-600", High: "text-amber-600", Critical: "text-rose-600" };
// Rule classification (§11.3)
const CLASS: Record<string, string> = { "Minimum staffing ratios": "Hard", "Mandatory Shift Supervisor coverage": "Hard", "Mandatory competencies": "Hard", "Maximum weekly hours (48h / 4 shifts)": "Soft", "Minimum rest between shifts": "Soft", "Rotation & workload fairness": "Advisory" };

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function ComplianceConstraints() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadConstraintEngine(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Compliance &amp; Constraints</h1><p className="text-sm text-gray-500">Every rule applied to the roster, and where assignments violate or approach a limit.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Compliance score" value={`${k.complianceScore}%`} tone={k.complianceScore >= 95 ? "text-emerald-600" : k.complianceScore >= 80 ? "text-amber-600" : "text-rose-600"} />
        <Kpi label="Critical (blocking)" value={k.critical} tone={k.critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Warnings" value={k.warnings} tone={k.warnings ? "text-amber-600" : undefined} />
        <Kpi label="Blocked posts" value={k.blocked} tone={k.blocked ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Override requests" value={k.overrideRequests} tone={k.overrideRequests ? "text-orange-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Rule results */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Constraint results <span className="text-[10px] text-gray-400 font-normal">by rule</span></h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Rule</th><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Class</th><th className="py-2 pr-3 font-medium text-right">Violations</th><th className="py-2 font-medium">Status</th></tr></thead>
            <tbody>{d.rules.map((r: any) => (<tr key={r.rule} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.rule}</td><td className="py-2 pr-3 text-gray-500">{r.category}</td><td className="py-2 pr-3"><span className={`text-[10px] ${CLASS[r.rule] === "Hard" ? "text-rose-600" : CLASS[r.rule] === "Soft" ? "text-amber-600" : "text-gray-400"}`}>{CLASS[r.rule] ?? "—"}</span></td><td className={`py-2 pr-3 text-right font-semibold ${SEV[r.count > 0 ? r.severity : "Pass"]}`}>{r.count || "—"}</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[r.status]}`}>{r.status}</span></td></tr>))}</tbody>
          </table></div>
          <p className="text-[10px] text-gray-400 mt-2">Hard rules cannot be violated without executive-level override; soft rules may be overridden with justification; advisory rules warn only (§11.3). Every manual roster change triggers revalidation of affected records (BR-008).</p>
        </div>

        {/* By unit + overrides */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Compliance by unit</h3>
            {d.byUnit.length === 0 ? <p className="text-sm text-gray-400">No units.</p> : <div className="space-y-2">{d.byUnit.map((u: any) => (<div key={u.unit} className="flex items-center gap-2 text-xs"><span className="text-gray-600 w-24 truncate">{u.unit}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${u.pct >= 95 ? "bg-emerald-500" : u.pct >= 80 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${u.pct}%` }} /></div><span className="text-gray-600 w-8 text-right font-medium">{u.pct}%</span></div>))}</div>}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Recent overrides</h3>
            {d.recentOverrides.length === 0 ? <p className="text-sm text-gray-400">No overrides recorded.</p> : <div className="space-y-1.5">{d.recentOverrides.map((o: any, i: number) => (<div key={i} className="text-xs rounded-lg border border-gray-100 p-2"><p className="text-gray-800 font-medium">{o.staff} · {o.unit}</p><p className="text-[11px] text-gray-500 truncate">{o.reason}</p></div>))}</div>}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Compliance &amp; Constraints (UMW-WFM-004 §11) runs the Constraint Engine (WSE-001C) over the current roster — minimum staffing, supervisor coverage, competencies, working-time (48h / 4 shifts, rest) and fairness. The schema-driven rule editor with versioning + effective dating is next-phase; rules trace to a versioned rule set (BR-016). <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
