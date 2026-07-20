import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadProduct } from "@/lib/platform/phase3";
import ProductToggle from "./ProductToggle";

export const dynamic = "force-dynamic";

// Product Management (PRD-001).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function ProductPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const { ready, products } = await loadProduct(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Product Management</h1>
        <p className="text-sm text-gray-500 mt-1">The platform&apos;s products &amp; modules — default enablement and per-tenant gating via feature flags.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">042–043</code> to load the product catalogue.</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {products.map((p: any) => (
            <div key={p.code} className={card}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-gray-900 text-sm">{p.name}</span>
                {p.is_core && <span className="text-[10px] bg-violet-100 text-violet-700 rounded-full px-2 py-0.5">core</span>}
                <span className="ml-auto"><ProductToggle code={p.code} defaultOn={p.default_on} /></span>
              </div>
              <p className="text-[11px] font-mono text-gray-400">{p.code}</p>
              {p.description && <p className="text-xs text-gray-500 mt-1">{p.description}</p>}
              <p className="text-[11px] text-gray-400 mt-2">{p.flag_assignments} scoped flag assignment{p.flag_assignments !== 1 ? "s" : ""}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400">Toggle a product&apos;s default; scope it to specific tenants/plans in <Link href="/platform/control-plane/feature-flags" className="text-violet-600 hover:underline">Feature Flags</Link>. Marketplace listing &amp; licensing is a later phase.</p>
    </div>
  );
}
