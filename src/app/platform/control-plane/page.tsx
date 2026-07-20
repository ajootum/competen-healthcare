import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadTenantRegistry } from "@/lib/platform/tenant-registry";

export const dynamic = "force-dynamic";

// Landlord Control Plane — Overview (LCP-001).
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function ControlPlaneOverview() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const reg = await loadTenantRegistry(caller.admin);

  const surfaces = [
    { icon: "🏛️", label: "Tenant Registry", href: "/platform/control-plane/tenants", sub: "Master catalogue of every tenant", ready: true },
    { icon: "⚡", label: "Provisioning", href: "/platform/control-plane/provisioning", sub: "One-click tenant creation from templates", ready: true },
    { icon: "🎫", label: "Subscriptions", href: "/platform/control-plane/subscriptions", sub: "Plans, entitlements, tenant subscriptions", ready: true },
    { icon: "🚩", label: "Feature Flags", href: "/platform/control-plane/feature-flags", sub: "Enable modules per tenant / plan / country", ready: true },
    { icon: "📜", label: "Audit Centre", href: "/platform/control-plane/audit", sub: "Landlord-plane action trail", ready: true },
    { icon: "🧩", label: "Products", href: "/platform/control-plane/products", sub: "Platform products & modules", ready: true },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Landlord Control Plane</h1>
        <p className="text-sm text-gray-500 mt-1">The platform-operator surface above every tenant · {caller.fullName ?? "Operator"}{caller.bridgedFromSuperAdmin ? " (super-admin, bridged)" : ""}</p>
      </div>

      {!reg.ready && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h3 className="font-semibold text-amber-800 text-sm">⚠ Control-plane schema not yet applied</h3>
          <p className="text-sm text-amber-700 mt-1">The tenant &amp; control-plane tables come from migrations <code className="font-mono text-xs bg-amber-100 px-1 rounded">040</code>, <code className="font-mono text-xs bg-amber-100 px-1 rounded">041</code>, <code className="font-mono text-xs bg-amber-100 px-1 rounded">042</code>. Apply them in the Supabase SQL editor (in order); these surfaces populate automatically once they land. Nothing here is fabricated in the meantime.</p>
        </div>
      )}

      {reg.ready && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{reg.total}</div><div className="text-xs text-gray-500 mt-1">Tenants in registry</div></div>
          {reg.statusBars.slice(0, 3).map(s => (
            <div key={s.code} className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{s.count}</div><div className="text-xs text-gray-500 mt-1">{s.label}</div></div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {surfaces.map(s => (
          <Link key={s.href} href={s.href} className={`${card} hover:border-violet-300 transition-colors block`}>
            <div className="flex items-center gap-2 mb-1"><span className="text-lg">{s.icon}</span><span className="font-semibold text-gray-900 text-sm">{s.label}</span></div>
            <p className="text-xs text-gray-500">{s.sub}</p>
          </Link>
        ))}
      </div>

      <p className="text-[11px] text-gray-400">The control plane governs tenants from above; the <Link href="/platform-admin" className="text-violet-600 hover:underline">Platform Operations</Link> workspace (PSA-001) operates it. Deployments, billing, regions, standards and identity are scaffolded and land in Phases 2–3.</p>
    </div>
  );
}
