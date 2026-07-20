import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadTenantRegistry } from "@/lib/platform/tenant-registry";

export const dynamic = "force-dynamic";

// Global Tenant Registry (LCP-001 §1).
const card = "bg-white rounded-xl border border-gray-200 p-5";
const statusCls: Record<string, string> = {
  active: "bg-green-100 text-green-700", trial: "bg-blue-100 text-blue-700", prospect: "bg-indigo-100 text-indigo-700",
  suspended: "bg-amber-100 text-amber-700", archived: "bg-gray-100 text-gray-500", deleted: "bg-red-100 text-red-600",
};

export default async function TenantRegistryPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const reg = await loadTenantRegistry(caller.admin);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenant Registry</h1>
          <p className="text-sm text-gray-500 mt-1">The master catalogue of every tenant on the platform.</p>
        </div>
        <Link href="/platform/control-plane/provisioning" className="shrink-0 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-4 py-2">＋ Provision tenant</Link>
      </div>

      {!reg.ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">040–042</code> to activate the registry. It reads the real <code className="font-mono text-xs">tenants</code> table, not the organisations relabelling.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{reg.total}</div><div className="text-xs text-gray-500 mt-1">Tenants</div></div>
            {reg.statusBars.filter(s => s.count > 0).slice(0, 3).map(s => (
              <div key={s.code} className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{s.count}</div><div className="text-xs text-gray-500 mt-1">{s.label}</div></div>
            ))}
          </div>

          <div className={card}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Tenant</th><th className="pr-3">Type</th><th className="pr-3">Status</th><th className="pr-3">Plan</th><th className="pr-3">Country</th><th className="pr-3 text-right">Orgs</th><th className="pr-3 text-right">Facilities</th><th className="pr-3 text-right">Users</th></tr></thead>
                <tbody>
                  {reg.tenants.length === 0 && <tr><td colSpan={8} className="py-3 text-gray-400">No tenants yet. Provision one to get started.</td></tr>}
                  {reg.tenants.map(t => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-3"><div className="font-medium text-gray-800">{t.name}</div>{t.slug && <div className="text-[11px] text-gray-400 font-mono">{t.slug}</div>}</td>
                      <td className="pr-3 text-gray-500">{t.tenant_type.replace(/_/g, " ")}</td>
                      <td className="pr-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${statusCls[t.status] ?? "bg-gray-100 text-gray-500"}`}>{t.status}</span></td>
                      <td className="pr-3 text-gray-500">{t.plan ?? "—"}</td>
                      <td className="pr-3 text-gray-500">{t.primary_country ?? "—"}</td>
                      <td className="pr-3 text-right tabular-nums text-gray-600">{t.organisations}</td>
                      <td className="pr-3 text-right tabular-nums text-gray-600">{t.facilities}</td>
                      <td className="pr-3 text-right tabular-nums text-gray-600">{t.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-400">Existing organisations were lifted to one tenant each by migration 041. Lifecycle transitions (suspend / archive) and multi-org consolidation land in Phase 2.</p>
        </>
      )}
    </div>
  );
}
