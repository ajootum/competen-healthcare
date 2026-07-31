import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavigationDesigner from "./NavigationDesigner";

export const dynamic = "force-dynamic";

// Navigation & Experience Designer (NCP-009) — the no-code menu composer over governed NAVIGATION_SECTION objects
// authored in the Configuration Studio. Role-aware menu tree + landing + quick actions, items linked to real
// MODULE/PAGE/DASHBOARD objects. Persists onto object.definition (migration 094) and wires linked objects into
// dependencies. The runtime navigation resolver, breadcrumb/search services and personalisation are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function NavigationBuilder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { data: navs, error } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name, description, status, definition")
    .eq("object_type", "NAVIGATION_SECTION").order("updated_at", { ascending: false }).limit(500);
  const { data: targets } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name").in("object_type", ["MODULE", "PAGE", "DASHBOARD"]).order("object_type").order("display_name").limit(1000);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const listN = (navs ?? []) as any[];
  const composed = listN.filter(n => (n.definition?.items?.length ?? 0) > 0).length;
  const totalItems = listN.reduce((s, n) => s + (n.definition?.items?.length ?? 0) + (n.definition?.items ?? []).reduce((a: number, it: any) => a + (it.children?.length ?? 0), 0), 0);

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Navigation &amp; Experience Designer</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🧭</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Navigation &amp; Experience Designer <span className="text-gray-300 font-medium text-lg">(NCP-009)</span></h1>
          <p className="text-sm text-gray-500">Compose role-aware menu trees whose items link to real modules, pages and dashboards, then preview per role.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 092 (registry) + 094 (object definition), then author a Navigation Section in the <Link href="/super-admin/platform-ops/studio" className="underline">Configuration Studio</Link>.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Navigation Sections" value={listN.length} sub="governed in the registry" />
        <Stat label="Composed" value={composed} tone="text-[var(--cmp-text-success)]" sub={`of ${listN.length} with items`} />
        <Stat label="Menu Items" value={totalItems} sub="across all sections" />
      </div>
      <NavigationDesigner navs={listN} targets={(targets ?? []) as any[]} />
      <p className="text-[11px] text-gray-400">Menu tree + landing + quick actions persist onto the object (linked modules/pages/dashboards become NAV_TARGET dependencies). The runtime navigation resolver (&lt;300ms), breadcrumb + search-navigation services, personalisation and responsive rendering (NCP-009 §3/§7/§8) are next-phase.</p>
    </div>
  );
}
