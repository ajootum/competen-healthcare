import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPlatformAdmin } from "@/lib/platform-admin-data";

export const dynamic = "force-dynamic";

// Tenant Management (PSA-002) — the platform's organisations (tenants).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function TenantsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadPlatformAdmin(admin);
  const { summary, tenants } = d;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenant Management</h1>
          <p className="text-sm text-gray-500 mt-1">{summary.tenants} tenant{summary.tenants !== 1 ? "s" : ""} · {summary.activeTenants} active · {summary.facilities} facilities · {summary.users} users.</p>
        </div>
        <Link href="/super-admin/organisations" className="shrink-0 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg px-4 py-2">Provision / manage →</Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.tenants}</div><div className="text-xs text-gray-500 mt-1">Tenants</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{summary.activeTenants}</div><div className="text-xs text-gray-500 mt-1">Active</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${summary.inactiveTenants ? "text-amber-600" : "text-gray-900"}`}>{summary.inactiveTenants}</div><div className="text-xs text-gray-500 mt-1">Suspended / inactive</div></div>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Tenant</th><th className="pr-3">Status</th><th className="pr-3">Type</th><th className="pr-3">Country</th><th className="pr-3 text-right">Facilities</th><th className="pr-3 text-right">Users</th><th className="pr-3">Created</th></tr></thead>
            <tbody>
              {tenants.length === 0 && <tr><td colSpan={7} className="py-3 text-gray-400">No tenants found.</td></tr>}
              {tenants.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-gray-800">{t.name ?? "Unnamed"}</td>
                  <td className="pr-3">{t.active ? <span className="text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5">Active</span> : <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">Inactive</span>}</td>
                  <td className="pr-3 text-gray-500">{t.type ?? "—"}</td>
                  <td className="pr-3 text-gray-500">{t.country ?? "—"}</td>
                  <td className="pr-3 text-right tabular-nums text-gray-600">{t.facilities}</td>
                  <td className="pr-3 text-right tabular-nums text-gray-600">{t.users}</td>
                  <td className="pr-3 text-gray-400 text-xs tabular-nums">{t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Tenant lifecycle actions — create, suspend, restore, archive — are performed in <Link href="/super-admin/organisations" className="text-rose-600 hover:underline">Organisations</Link>; facilities in <Link href="/super-admin/hospitals" className="text-rose-600 hover:underline">All Facilities</Link>.</p>
    </div>
  );
}
