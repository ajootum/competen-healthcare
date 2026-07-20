import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadIdentity } from "@/lib/platform/phase3";
import IdentityForm from "./IdentityForm";

export const dynamic = "force-dynamic";

// Identity & Federation (LCP-001 §19).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function IdentityPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const { ready, configs, tenants } = await loadIdentity(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Identity &amp; Federation</h1>
        <p className="text-sm text-gray-500 mt-1">Per-tenant SSO / SAML / OIDC configuration, MFA and SCIM policy.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migration <code className="font-mono text-xs">044</code> to activate identity configuration.</div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5 items-start">
          <IdentityForm tenants={tenants} />
          <div className={`${card} lg:col-span-2`}>
            <h3 className="font-semibold text-gray-900 mb-3">Configured tenants <span className="text-gray-400 font-normal">· {configs.length}</span></h3>
            {configs.length === 0 && <p className="text-sm text-gray-400">No SSO configured yet. Configure a tenant on the left.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Tenant</th><th className="pr-3">Protocol</th><th className="pr-3">Provider</th><th className="pr-3">MFA</th><th className="pr-3">SCIM</th><th className="pr-3">State</th></tr></thead>
                <tbody>
                  {configs.map((c: any) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-gray-800">{c.tenant_name}</td>
                      <td className="pr-3 text-gray-500 uppercase">{c.protocol}</td>
                      <td className="pr-3 text-gray-500">{c.provider ?? "—"}</td>
                      <td className="pr-3">{c.mfa_required ? "✓" : "—"}</td>
                      <td className="pr-3">{c.scim_enabled ? "✓" : "—"}</td>
                      <td className="pr-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${c.is_active ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{c.is_active ? "active" : "configured"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] text-gray-400">Configuration is stored here; end-to-end enforcement (validating assertions at sign-in) activates when the auth provider is wired to the identity broker — a hosting-level integration.</p>
    </div>
  );
}
