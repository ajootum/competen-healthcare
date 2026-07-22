import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTenantDirectory } from "@/lib/platform/tenants";
import TenantDirectory from "./TenantDirectory";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function TenantOperations() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { rows, summary, plans } = await loadTenantDirectory(admin);

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Tenant Operations</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Tenant Operations</h1>
        <p className="text-sm text-gray-500">Manage tenants, provisioning, configuration and lifecycle.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Tenants", n: summary.total, tone: "text-gray-900" },
          { label: "Active", n: summary.active, tone: "text-green-600" },
          { label: "Trial", n: summary.trial, tone: "text-amber-600" },
          { label: "Suspended", n: summary.suspended, tone: summary.suspended ? "text-rose-600" : "text-gray-300" },
          { label: "Archived", n: summary.archived, tone: "text-gray-400" },
          { label: "Unplanned", n: summary.unplanned, tone: summary.unplanned ? "text-orange-600" : "text-gray-300" },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <TenantDirectory rows={rows} plans={plans} />
    </div>
  );
}
