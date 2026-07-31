import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PageComposer from "./PageComposer";
import { Stat } from "../_kit";

export const dynamic = "force-dynamic";

// Page & Layout Composer (NCP-001) — the layout designer on top of the governed PAGE objects authored in the
// Configuration Studio. Compose a page on a 12-column grid from WCE-005 widgets + structural components, with
// a WYSIWYG canvas; persists onto object.definition (migration 094). Free-form positioning, responsive
// breakpoint overrides, theme references and the runtime layout renderer are honest next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

const COMPONENTS = [
  { value: "component.heading", label: "▸ Heading" }, { value: "component.kpi_strip", label: "▸ KPI Strip" },
  { value: "component.action_bar", label: "▸ Action Bar" }, { value: "component.nav_zone", label: "▸ Navigation Zone" },
  { value: "component.footer", label: "▸ Footer" }, { value: "component.spacer", label: "▸ Spacer" },
];

export default async function PageComposerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const [{ data: pages, error }, { data: widgetObjs }] = await Promise.all([
    admin.from("configuration_registry_objects").select("object_key, display_name, description, status, definition").eq("object_type", "PAGE").order("updated_at", { ascending: false }).limit(500),
    admin.from("configuration_registry_objects").select("object_key, display_name").eq("object_type", "WIDGET").order("display_name").limit(300),
  ]);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const list = (pages ?? []) as any[];
  const palette = [...((widgetObjs ?? []) as any[]).map(w => ({ value: w.object_key, label: w.display_name })), ...COMPONENTS];
  const withLayout = list.filter(p => (p.definition?.rows?.length ?? 0) > 0).length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Page & Layout Composer</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🧱</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Page &amp; Layout Composer <span className="text-gray-300 font-medium text-lg">(NCP-001)</span></h1>
          <p className="text-sm text-gray-500">Compose each governed page on a 12-column grid — rows of proportional columns holding widgets or structural components.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 092 (registry) + 094 (object definition), then author a Page in the <Link href="/super-admin/platform-ops/studio" className="underline">Configuration Studio</Link>.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Page Objects" value={list.length} sub="governed in the registry" />
        <Stat label="With Layout" value={withLayout} tone="text-[var(--cmp-text-success)]" sub="rows composed" />
        <Stat label="Widget Palette" value={palette.length} sub="widgets + components" />
      </div>
      <PageComposer pages={list} palette={palette} />
      <p className="text-[11px] text-gray-400">The grid layout persists onto the page object and referenced widgets wire into its dependencies. Free-form positioning, per-breakpoint responsive overrides, theme references and the runtime layout renderer (NCP-001 §8/§13) are next-phase.</p>
    </div>
  );
}
