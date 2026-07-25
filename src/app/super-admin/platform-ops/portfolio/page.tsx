import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadPortfolioAdmin } from "@/lib/platform/portfolio-admin";
import PortfolioConsole from "./PortfolioConsole";

// PCS-PORT-001 — Product Portfolio & Suite Configuration console. No-code management of the packaging hierarchy
// (Portfolio → Suite → Product → Workspace) + the tenant licensing matrix that gates workspace access at runtime
// (composed into resolveEntitlements). Super-admin gated.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ProductPortfolioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const data = await loadPortfolioAdmin(admin);

  return (
    <div className="max-w-[1400px] space-y-4">
      <div>
        <p className="text-[11px] font-semibold text-teal-600 uppercase tracking-wide">Platform Ops · PCS-PORT-001</p>
        <h1 className="text-2xl font-bold text-gray-900">Product Portfolio &amp; Suite Configuration</h1>
        <p className="text-sm text-gray-500 mt-0.5">Package products into commercial suites, map them to workspaces, and license products per tenant — all no-code. Licensing composes with role entitlement at runtime (Licensed → Entitled → Personalized → Authorized).</p>
      </div>
      <PortfolioConsole data={data} />
    </div>
  );
}
