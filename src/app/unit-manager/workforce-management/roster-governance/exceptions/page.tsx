import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadConstraintEngine } from "@/lib/operations/constraint-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Exceptions & Resolutions (UMW-WFM-004 §14) — one register for all roster-related governance
// exceptions. Detection is real over the Constraint Engine (coverage/supervisor/competency/
// working-time/fairness) mapped to the exception catalogue. The full lifecycle (assign →
// review → resolve/override/escalate with reason+mitigation+expiry) needs a roster_exception
// store → honest next-phase; every detected exception here is state "Detected/Open".
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-amber-50 text-amber-700", Medium: "bg-sky-50 text-sky-700" };
const DOT: Record<string, string> = { Critical: "bg-rose-500", High: "bg-amber-500", Medium: "bg-sky-500" };
// Map constraint rules → exception catalogue (§14.2) + recommended resolution (§14.6)
const MAP: Record<string, { category: string; resolution: string }> = {
  "Minimum staffing ratios": { category: "Coverage", resolution: "Add staff / request cross-unit cover" },
  "Mandatory Shift Supervisor coverage": { category: "Supervisor", resolution: "Assign eligible supervisor or acting cover" },
  "Mandatory competencies": { category: "Competency", resolution: "Reassign to validated staff or add supervision" },
  "Maximum weekly hours (48h / 4 shifts)": { category: "Working time", resolution: "Redistribute shifts / approve overtime" },
  "Minimum rest between shifts": { category: "Working time", resolution: "Space assignments to restore rest" },
  "Rotation & workload fairness": { category: "Fairness", resolution: "Rebalance shift distribution" },
};

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function ExceptionsResolutions() {
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
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Exceptions &amp; Resolutions</h1><p className="text-sm text-gray-500">One register for every roster governance exception and its resolution.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  const k = d.kpis;
  const register = d.rules.filter((r: any) => r.count > 0).map((r: any) => ({ ...r, ...(MAP[r.rule] ?? { category: "Other", resolution: "Review" }), sev: r.severity }));

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Open exceptions" value={register.reduce((n: number, r: any) => n + r.count, 0)} tone={register.length ? "text-gray-900" : "text-emerald-600"} />
        <Kpi label="Critical (blocking)" value={k.critical} tone={k.critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Override requests" value={k.overrideRequests} tone={k.overrideRequests ? "text-orange-600" : undefined} />
        <Kpi label="Categories" value={new Set(register.map((r: any) => r.category)).size} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Exception register <span className="text-[10px] text-gray-400 font-normal">detected this cycle</span></h3>
        {register.length === 0 ? <p className="text-sm text-gray-400">No exceptions detected — the roster passes all governance checks. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Rule violated</th><th className="py-2 pr-3 font-medium text-right">Count</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Recommended resolution</th></tr></thead>
            <tbody>{register.map((r: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.category}</td><td className="py-2 pr-3 text-gray-600">{r.rule}</td><td className="py-2 pr-3 text-right font-semibold text-gray-800">{r.count}</td><td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${DOT[r.sev] ?? "bg-gray-400"}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[r.sev] ?? "bg-gray-100 text-gray-500"}`}>{r.sev}</span></span></td><td className="py-2 pr-3"><span className="text-[10px] text-gray-500">Detected</span></td><td className="py-2 text-gray-500">{r.resolution}</td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Detection is live over the Constraint Engine. Assign → review → resolve / accept-with-mitigation / override / escalate lifecycle + SLA aging need a roster_exception store (§14.5). A controlled override (§14.7) must record reason, risk assessment, mitigation, expiry, approving role and rule-acknowledgement — never silently changing the rule.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent overrides</h3>
          {d.recentOverrides.length === 0 ? <p className="text-sm text-gray-400">No overrides recorded.</p> : <div className="space-y-1.5">{d.recentOverrides.map((o: any, i: number) => (<div key={i} className="text-xs rounded-lg border border-gray-100 p-2"><p className="text-gray-800 font-medium">{o.staff} · {o.unit}</p><p className="text-[11px] text-gray-500 truncate">{o.reason}</p></div>))}</div>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Resolution options <span className="text-[10px] text-gray-400 font-normal">§14.6</span></h3>
          <div className="grid grid-cols-2 gap-1.5 text-[11px] text-gray-600">{["Reassign staff", "Add / remove staff", "Change role", "Replace supervisor", "Cross-unit cover", "Request overtime", "Request agency cover", "Approve acting", "Revise demand", "Controlled exception", "Escalate to Nursing Admin", "Return to Scheduling Engine"].map(o => (<div key={o} className="rounded border border-gray-100 px-2 py-1">{o}</div>))}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Exceptions &amp; Resolutions (UMW-WFM-004 §14) maps live Constraint Engine results to the exception catalogue. The stateful register (owner, due date, mitigation, evidence, closure) and override workflow are next-phase. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
