import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadEnterpriseGovernance } from "@/lib/enterprise-governance-data";
import { card, tone, pctText, ScopeBanner } from "../_ui";

export const dynamic = "force-dynamic";

// Multi-Tenant Governance (EGV-003) — the organisations in scope and their posture.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function TenantsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadEnterpriseGovernance(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { enterpriseName, scopeMode, benchmark, kpis } = d;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Multi-Tenant Governance</h1>
          <p className="text-sm text-gray-500 mt-1">The {kpis.organisations} organisation{kpis.organisations !== 1 ? "s" : ""} governed under this enterprise, and their governance posture.</p>
        </div>
        <ScopeBanner mode={scopeMode} name={enterpriseName} />
      </div>

      {scopeMode === "single" && (
        <div className={`${card} border-dashed`}>
          <p className="text-sm text-gray-500">This view is scoped to your organisation. Cross-organisation, multi-tenant governance — benchmarking several organisations together — is a platform-administration capability, so an enterprise group appears here only under platform (super) administration.</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {benchmark.map((o) => (
          <div key={o.id} className={card}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 className="font-semibold text-gray-900 truncate">{o.name}</h3>
              <span className={`text-lg font-bold tabular-nums shrink-0 ${tone(o.compPct)}`}>{pctText(o.compPct)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Facilities</span><b className="tabular-nums text-gray-800">{o.facilities}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Users</span><b className="tabular-nums text-gray-800">{o.users}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Competency</span><b className={`tabular-nums ${tone(o.compPct)}`}>{pctText(o.compPct)}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Compliance</span><b className={`tabular-nums ${tone(o.auditPct)}`}>{pctText(o.auditPct)}</b></div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">Standards inheritance: every tenant inherits the shared master frameworks and may add local frameworks on top. Enterprise governance sets the standard; each organisation reports against it.</p>
    </div>
  );
}
