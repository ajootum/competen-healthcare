import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ReportDashboardBuilder from "./ReportDashboardBuilder";
import { Stat } from "../_kit";

export const dynamic = "force-dynamic";

// Report & Dashboard Builder (NCP-006) — the visual composer over governed DASHBOARD + REPORT objects authored
// in the Configuration Studio. Dashboards are 12-col grids of metric-bound visualisation tiles; reports are
// ordered section stacks. Persists onto object.definition (migration 094) and wires bound metrics into
// dependencies. Runtime rendering, export (PDF/DOCX/XLSX/CSV), scheduling and AI narrative are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ReportsBuilder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { data: objects, error } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name, description, status, definition")
    .in("object_type", ["DASHBOARD", "REPORT"]).order("object_type").order("updated_at", { ascending: false }).limit(500);
  const { data: metrics } = await admin.from("configuration_registry_objects")
    .select("object_key, display_name").eq("object_type", "METRIC").order("display_name").limit(500);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const list = (objects ?? []) as any[];
  const dashboards = list.filter(o => o.object_type === "DASHBOARD");
  const reports = list.filter(o => o.object_type === "REPORT");
  const composed = list.filter(o => o.object_type === "DASHBOARD" ? (o.definition?.tiles?.length ?? 0) > 0 : (o.definition?.sections?.length ?? 0) > 0).length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Report &amp; Dashboard Builder</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">📊</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Report &amp; Dashboard Builder <span className="text-gray-300 font-medium text-lg">(NCP-006)</span></h1>
          <p className="text-sm text-gray-500">Compose governed dashboards from metric-bound visualisation tiles, and reports from ordered sections.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 092 (registry) + 094 (object definition), then author a Dashboard or Report in the <Link href="/super-admin/platform-ops/studio" className="underline">Configuration Studio</Link>.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Dashboards" value={dashboards.length} sub="governed in the registry" />
        <Stat label="Reports" value={reports.length} sub="governed in the registry" />
        <Stat label="Composed" value={composed} tone="text-[var(--cmp-text-success)]" sub={`of ${list.length} with blocks`} />
      </div>
      <ReportDashboardBuilder objects={list} metrics={(metrics ?? []) as any[]} />
      <p className="text-[11px] text-gray-400">Tiles/sections + bound metrics persist onto the object (bound metrics become METRIC_REF dependencies). The runtime rendering, drill-through, export service (PDF/DOCX/XLSX/CSV), scheduler and AI narrative engine (NCP-006 §4/§9) are next-phase.</p>
    </div>
  );
}
