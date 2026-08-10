import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOrgDirectory } from "@/lib/enterprise/organisations";
import OrgDirectory from "./OrgDirectory";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Organisations module (ENT-001 §1) — directory + KPIs. The registry of every
// tenant organisation. Create/edit/lifecycle run through /api/enterprise/organisations.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function OrganisationsModule() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.executive.enterprise.view");

  const { rows, summary, networks } = await loadOrgDirectory(admin);

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span><span className="text-gray-600">Organisations</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Organisations</h1>
          <p className="text-sm text-gray-500">Manage all tenant organisations, their profiles, subscriptions and status.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Organisations", n: summary.total, tone: "text-gray-900" },
          { label: "Active", n: summary.active, tone: "text-[var(--cmp-text-success)]" },
          { label: "Onboarding", n: summary.onboarding, tone: "text-[var(--cmp-text-warning)]" },
          { label: "Suspended", n: summary.suspended, tone: "text-[var(--cmp-text-error)]" },
          { label: "Countries", n: summary.countries, tone: "text-indigo-600" },
          { label: "No admin", n: summary.noAdmin, tone: summary.noAdmin ? "text-[var(--cmp-text-critical)]" : "text-gray-300" },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <OrgDirectory rows={rows} networks={networks} />
    </div>
  );
}
