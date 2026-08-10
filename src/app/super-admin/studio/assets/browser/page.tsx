import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { listAssets, assetFacets, assetOrgOptions, assetsHaveOrgDimension, type AssetRow } from "@/lib/assets/service";
import { assetIndexStatus, overlayLinkStatus } from "@/lib/assets/registry";
import AssetBrowser from "./AssetBrowser";
import { requireHqCapability } from "@/lib/hq/context";

// CAP-001 — Asset Browser (Phase 3). The Repository Administration Console: browse, filter and search the
// governed cap_assets index, refresh it from the 12 source tables, and drill through to each asset's home.
// Reads the index built by registry.ts; empty until the first refresh (a CTA is shown until then).

export const dynamic = "force-dynamic";

export default async function AssetBrowserPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  let facets: { byType: Record<string, number>; byStatus: Record<string, number>; total: number } = { byType: {}, byStatus: {}, total: 0 };
  let first: { rows: AssetRow[]; total: number; page: number; pageSize: number } = { rows: [], total: 0, page: 1, pageSize: 25 };
  let status: { total: number; byType: Record<string, number>; lastIndexedAt: string | null; types: number } = { total: 0, byType: {}, lastIndexedAt: null, types: 12 };
  let overlays: Record<string, { linked: number; total: number }> = {};
  let orgOptions: { id: string; name: string }[] = [];
  let orgDim = false;
  try {
    [facets, first, status, overlays, orgOptions, orgDim] = await Promise.all([
      assetFacets(admin, { isSuper: true }),
      listAssets(admin, { isSuper: true, page: 1 }),
      assetIndexStatus(admin),
      overlayLinkStatus(admin),
      assetOrgOptions(admin),
      assetsHaveOrgDimension(admin),
    ]);
  } catch {
    // cap_assets not migrated yet — render the empty state with the refresh CTA.
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CAP-001 · Asset Repository</p>
          <h1 className="text-xl font-bold text-gray-900">Asset Browser</h1>
          <p className="text-gray-400 text-sm mt-0.5">Every competency asset, governed once and reused everywhere — one index over all 12 source types.</p>
        </div>
        <Link href="/super-admin/studio/assets" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Repository</Link>
      </div>

      <AssetBrowser initialRows={first.rows} initialTotal={first.total} initialFacets={facets} initialStatus={status} initialOverlays={overlays} orgOptions={orgDim ? orgOptions : []} />

      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-4">
        <p className="text-[11px] text-teal-900">
          <span className="font-bold">One governed header, many surfaces.</span> The browser reads <code className="text-[10px]">cap_assets</code> — an additive index that references the 12 source tables via <code className="text-[10px]">(object_type, object_id)</code>, without moving data or changing any consumer. Status and version are normalised snapshots; the source table stays authoritative. Write-back, binary storage and cross-tenant inheritance are the next-phase re-platform.
        </p>
      </div>
    </div>
  );
}
