import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRosterExceptionsView } from "@/lib/operations/roster-governance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";
import { RaiseButtons, ExceptionRegister } from "./RosterExcActions";

export const dynamic = "force-dynamic";

// Exceptions & Resolutions (UMW-WFM-004 §14) — real over op_roster_exceptions (migration 082).
// Detection is live over the Constraint Engine; raising persists a stateful exception that can be
// reviewed → resolved / overridden (with reason, §14.7) / rejected. A controlled override never
// silently changes the rule.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

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
    loadRosterExceptionsView(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
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

  const critical = d.openPersisted.filter((e: any) => e.severity === "critical").length;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Open (register)" value={d.openPersisted.length} tone={d.openPersisted.length ? "text-gray-900" : "text-emerald-600"} />
        <Kpi label="Critical" value={critical} tone={critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Detected (unraised)" value={d.derived.length} tone={d.derived.length ? "text-amber-600" : undefined} />
        <Kpi label="Total logged" value={d.persisted.length} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Detected — raise to register <span className="text-[10px] text-gray-400 font-normal">live constraint results</span></h3>
          <RaiseButtons rosterId={d.rosterId} derived={d.derived} />
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Exception register <span className="text-[10px] text-gray-400 font-normal">stateful lifecycle</span></h3>
          <ExceptionRegister rows={d.openPersisted} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent overrides <span className="text-[10px] text-gray-400 font-normal">from solver + register</span></h3>
          {d.recentOverrides.length === 0 ? <p className="text-sm text-gray-400">No overrides recorded.</p> : <div className="space-y-1.5">{d.recentOverrides.map((o: any, i: number) => (<div key={i} className="text-xs rounded-lg border border-gray-100 p-2"><p className="text-gray-800 font-medium">{o.staff} · {o.unit}</p><p className="text-[11px] text-gray-500 truncate">{o.reason}</p></div>))}</div>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Resolution options <span className="text-[10px] text-gray-400 font-normal">§14.6</span></h3>
          <div className="grid grid-cols-2 gap-1.5 text-[11px] text-gray-600">{["Reassign staff", "Add / remove staff", "Change role", "Replace supervisor", "Cross-unit cover", "Request overtime", "Request agency cover", "Approve acting", "Revise demand", "Controlled exception", "Escalate to Nursing Admin", "Return to Scheduling Engine"].map(o => (<div key={o} className="rounded border border-gray-100 px-2 py-1">{o}</div>))}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Exceptions &amp; Resolutions (UMW-WFM-004 §14) is real over op_roster_exceptions — live Constraint Engine detection, raise → review → resolve / override (reason required, §14.7) / reject lifecycle. Approval-routed exceptions connect to <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">Exceptions &amp; Approvals</Link>. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
