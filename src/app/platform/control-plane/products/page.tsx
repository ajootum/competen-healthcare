import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";

export const dynamic = "force-dynamic";

// Product Management Centre (LCP-001 §22).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function ProductsPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");

  let products: any[] = []; let ready = false;
  try {
    const { data } = await caller.admin.from("plat_products").select("code, name, description, is_core, default_on").order("sort");
    products = data ?? []; ready = products.length > 0;
  } catch { /* pre-migration */ }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <p className="text-sm text-gray-500 mt-1">The platform&apos;s products &amp; modules. Enablement per tenant rides feature-flag assignments.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">040–042</code> to load the product catalogue.</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {products.map(p => (
            <div key={p.code} className={card}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-gray-900 text-sm">{p.name}</span>
                {p.is_core && <span className="text-[10px] bg-violet-100 text-violet-700 rounded-full px-2 py-0.5">core</span>}
                <span className={`ml-auto text-[10px] rounded-full px-2 py-0.5 ${p.default_on ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{p.default_on ? "on" : "off"} by default</span>
              </div>
              <p className="text-[11px] font-mono text-gray-400">{p.code}</p>
              {p.description && <p className="text-xs text-gray-500 mt-1">{p.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
