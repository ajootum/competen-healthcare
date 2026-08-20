import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDependencyGraph } from "@/lib/config/dependency-graph";
import PackageBuilder from "./PackageBuilder";
import { Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Template, Package & Marketplace Manager (NCP-011) — the capstone. Bundles governed configuration objects
// (produced by the other NCP builders) into versioned, installable packages, with a dependency resolver that
// reuses the WCE-002 dependency graph to guarantee each bundle is self-contained before publish. Persists to
// configuration_packages (migration 095). The installation engine, upgrade/rollback, licensing and marketplace
// portal are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PackagesBuilder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const { data: packages, error } = await admin.from("configuration_packages")
    .select("package_key, package_name, description, category, version, license, pricing_model, visibility, members, status")
    .order("updated_at", { ascending: false }).limit(500);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));

  const graph: any = await loadDependencyGraph(admin);
  const objects = graph.provisioned ? graph.nodes.map((n: any) => ({ object_key: n.key, object_type: n.type, display_name: n.label })) : [];
  const dependsOn = graph.provisioned ? graph.dependsOn : {};
  const listP = (packages ?? []) as any[];
  const published = listP.filter(p => p.status === "published").length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Template, Package &amp; Marketplace Manager</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">📦</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Template, Package &amp; Marketplace Manager <span className="text-gray-500 font-medium text-lg">(NCP-011)</span></h1>
          <p className="text-sm text-gray-500">Bundle governed configuration objects into versioned packages — the resolver guarantees each bundle is dependency-complete before publish.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 095 (configuration packages), then create a package here.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Packages" value={listP.length} sub="in the registry" />
        <Stat label="Published" value={published} tone="text-[var(--cmp-text-success)]" sub="on the marketplace" />
        <Stat label="Bundleable Objects" value={objects.length} sub="governed in the registry" />
      </div>
      {!graph.provisioned && <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4 text-sm text-amber-800">The configuration registry (migration 092) is not provisioned, so there are no objects to bundle yet.</div>}
      <PackageBuilder packages={listP} objects={objects} dependsOn={dependsOn} />
      <p className="text-[11px] text-gray-500">Packages + computed manifests persist to the package registry; publish is gated on dependency-completeness (reusing the WCE-002 dependency graph). The installation engine (transactional deploy, backup, health check), upgrade/rollback, licensing enforcement and the public/enterprise marketplace portal with ratings + analytics (NCP-011 §4/§7/§8) are next-phase.</p>
    </div>
  );
}
