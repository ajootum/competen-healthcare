import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import DevTabs from "../DevTabs";

export const dynamic = "force-dynamic";

// Workforce Readiness (UMW-WFM-007 §10) — person-level readiness register derived from
// competency currency. Real over competency_decisions. The full readiness profile (learning,
// orientation, supervision, development plan per staff) needs those stores → cross-linked.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const ROLE_LABEL: Record<string, string> = { charge: "Charge Nurse", nurse: "Registered Nurse", support: "Healthcare Assistant", float: "Float / Bank", doctor: "Doctor", therapist: "Therapist" };

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function WorkforceReadiness() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceReadiness(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🎓</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Development &amp; Readiness · Workforce Readiness</h1><p className="text-sm text-gray-500">Person-level readiness — who is deployable, who needs supervision.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <DevTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Fully deployable" value={k.fullyDeployable} tone="text-emerald-600" />
        <Kpi label="Renewal due" value={k.renewalDue} tone={k.renewalDue ? "text-amber-600" : undefined} />
        <Kpi label="Requiring supervision" value={k.requiringSupervision} tone={k.requiringSupervision ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="No record" value={k.noRecord} tone={k.noRecord ? "text-amber-600" : undefined} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Readiness register <span className="text-[10px] text-gray-400 font-normal">{d.register.length} staff · competency currency</span></h3>
        {d.register.length === 0 ? <p className="text-sm text-gray-400">No staff with competency records yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Competency</th><th className="py-2 pr-3 font-medium">Readiness</th><th className="py-2 font-medium">Deployable</th></tr></thead>
            <tbody>{d.register.map((s: any) => (<tr key={s.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{s.name}</td><td className="py-2 pr-3 text-gray-500">{ROLE_LABEL[s.role] ?? s.role}</td><td className="py-2 pr-3 text-gray-500">{s.status}</td><td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${s.readiness.tone}`}>{s.readiness.label}</span></td><td className="py-2">{s.readiness.deployable ? <span className="text-emerald-600 font-semibold">● Yes</span> : <span className="text-amber-600">◐ Supervised / validate</span>}</td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Readiness derived from competency currency (§10.2). A staff member is not fully deployable unless all mandatory role/unit requirements are current (BR-WDR-001); the full multi-dimensional profile (learning, orientation, supervision, development plan) needs those stores. Competency authoring is in <Link href="/unit-manager/competency-validations" className="text-emerald-700 hover:underline">Competency Validations</Link>.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Readiness (UMW-WFM-007 §10) over competency_decisions. <Link href="/unit-manager/workforce-management/development" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
