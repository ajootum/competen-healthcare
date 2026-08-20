import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPackages, PACKAGE_TYPES, PKG_TYPE_LABEL, ITEM_TYPE_LABEL } from "@/lib/studio/packages";
import { requireHqCapability } from "@/lib/hq/context";

// CST-110 — Competency Marketplace. The discovery catalogue over PUBLISHED competency packages (the
// output of the Package Manager, CST-109). Browse by category, preview contents, see the enterprise
// catalogue. Read-only over competency_packages — no new store. Licensing / one-click installation
// across tenants is the next-phase distribution layer (flagged honestly).

export const dynamic = "force-dynamic";

export default async function StudioMarketplacePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const pkg = await loadPackages(admin, profile?.hospital_id ?? null, true);
  const provisioned = pkg.provisioned;
  const published = provisioned ? pkg.packages.filter(p => p.status === "published") : [];
  const catByType = (t: string) => published.filter(p => p.package_type === t).length;
  const featured = [...published].sort((a, b) => b.itemCount - a.itemCount).slice(0, 6);
  const bundledItems = published.reduce((s, p) => s + p.itemCount, 0);

  const breakdown = (items: { item_type: string }[]) => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.item_type, (m.get(it.item_type) ?? 0) + 1);
    return [...m.entries()].map(([k, n]) => ({ label: ITEM_TYPE_LABEL[k] ?? k, n }));
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-110 · Marketplace</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Marketplace</h1>
          <p className="text-gray-500 text-sm mt-0.5">Discover and adopt published competency packages across the enterprise.</p>
        </div>
        <Link href="/super-admin/studio/packages" className="text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg px-3 py-2">Publisher console →</Link>
      </div>

      {!provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Run migration 130 (<code className="text-[11px]">competency_packages</code>) to enable the Marketplace.</div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Published packages", value: published.length, tone: "text-teal-600" },
              { label: "Bundled items", value: bundledItems, tone: "text-gray-900" },
              { label: "Categories", value: PACKAGE_TYPES.filter(t => catByType(t.key) > 0).length, tone: "text-gray-900" },
              { label: "In draft (not listed)", value: pkg.kpis.draft, tone: "text-gray-500" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Browse by category */}
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Browse by category</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            {PACKAGE_TYPES.map(t => (
              <div key={t.key} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className="text-lg font-bold text-gray-900">{catByType(t.key)}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">{t.label}</p>
              </div>
            ))}
          </div>

          {/* Catalogue */}
          {published.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <p className="text-sm text-gray-500 font-medium">No published packages yet</p>
              <p className="text-xs text-gray-500 mt-1">Build a package in the <Link href="/super-admin/studio/packages" className="text-teal-600 hover:underline">Package Manager</Link> and publish it — it will appear here for the enterprise to discover.</p>
            </div>
          ) : (
            <>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Catalogue</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-5">
                {featured.map(p => (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-100 p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">📦</span>
                      <p className="font-bold text-gray-900 text-sm truncate">{p.name}</p>
                    </div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{PKG_TYPE_LABEL[p.package_type]}</span>
                      <span className="text-[10px] text-gray-500">v{p.version}</span>
                    </div>
                    {p.description && <p className="text-[11px] text-gray-500 leading-relaxed mb-2 line-clamp-2">{p.description}</p>}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {breakdown(p.items).map(b => <span key={b.label} className="text-[10px] font-medium text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5">{b.n} {b.label}{b.n === 1 ? "" : "s"}</span>)}
                      {p.itemCount === 0 && <span className="text-[10px] text-gray-500">No items</span>}
                    </div>
                    <p className="text-[10px] text-gray-500">{p.itemCount} item{p.itemCount === 1 ? "" : "s"} · by {p.created_by_name ?? "—"}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">Internal enterprise catalogue.</span> Packages published in the Package Manager are discoverable here across the organisation. Cross-tenant licensing, entitlements and one-click installation are the next-phase distribution layer.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
