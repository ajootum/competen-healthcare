import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import DevTabs from "../DevTabs";
import { Kpi } from "../../_kit";

export const dynamic = "force-dynamic";

// Credentials & Expiry (UMW-WFM-007 §14) — monitors licence/certification currency over the
// Competency system (competency_decisions.expiry_date). Real. A legally-required expired or
// revoked credential blocks independent deployment (§14.4 / BR-WDR-004). Issuing-body
// verification + evidence upload need a credentialing store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const ROLE_LABEL: Record<string, string> = { charge: "Charge Nurse", nurse: "Registered Nurse", support: "Healthcare Assistant", float: "Float / Bank", doctor: "Doctor", therapist: "Therapist" };

export default async function CredentialsExpiry() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🎓</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Development &amp; Readiness · Credentials &amp; Expiry</h1><p className="text-sm text-gray-500">Licence, certification and authorisation currency.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <DevTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p></div></div>;

  const k = d.kpis;
  const rows = [...d.expiredStaff.map((s: any) => ({ ...s, bucket: "Expired" })), ...d.expiringStaff.map((s: any) => ({ ...s, bucket: "Expiring ≤30d" }))];
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Expired" value={k.credentialsExpired} tone={k.credentialsExpired ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} />
        <Kpi label="Expiring ≤30d" value={k.credentialsExpiring} tone={k.credentialsExpiring ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} />
        <Kpi label="Current" value={k.fullyDeployable + k.renewalDue - k.credentialsExpiring} tone="text-[var(--cmp-text-success)]" />
        <Kpi label="No record" value={k.noRecord} tone={k.noRecord ? "text-[var(--cmp-text-warning)]" : undefined} />
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Expiry watch <span className="text-[10px] text-gray-400 font-normal">expired + expiring staff</span></h3>
        {rows.length === 0 ? <p className="text-sm text-gray-400">No expired or expiring credentials. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Bucket</th><th className="py-2 font-medium">Deployment impact</th></tr></thead>
            <tbody>{rows.map((s: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{s.name}</td><td className="py-2 pr-3 text-gray-500">{ROLE_LABEL[s.role] ?? s.role}</td><td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${s.bucket === "Expired" ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>{s.bucket}</span></td><td className="py-2 text-gray-500">{s.bucket === "Expired" ? "Blocks independent deployment (BR-WDR-004)" : "Renew before expiry"}</td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Currency is from competency_decisions.expiry_date. Configurable expiry alerts (180/90/60/30/14/7d), issuing-body verification and evidence upload need a dedicated credentialing store → next-phase. A revoked/suspended credential can&apos;t be operationally overridden (BR-WDR-013).</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Credentials &amp; Expiry (UMW-WFM-007 §14) over competency_decisions. <Link href="/unit-manager/workforce-management/development" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
