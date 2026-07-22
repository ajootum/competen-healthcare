import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkspaces } from "@/lib/platform/workspaces";
import WorkspaceDirectory from "./WorkspaceDirectory";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Workspace Management (POP-001 §3) — registry of every workspace across the
// portal, org-role and platform planes, with per-workspace management overrides.
export default async function WorkspaceManagement() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { groups, summary, needsMigration } = await loadWorkspaces(admin);

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Workspace Management</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Workspace Management</h1>
        <p className="text-sm text-gray-500">Layouts, menus, widgets, themes and permissions across every workspace plane.</p>
      </div>

      {needsMigration && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Read-only.</span> Showing the code-defined workspace catalogue. Run <code className="font-mono text-[12px] bg-amber-100 px-1 rounded">supabase/RUN-ME-053-workspace-management.sql</code> to enable editing (enable/disable, rename, theme, audience).
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Workspaces", n: summary.total, tone: "text-gray-900" },
          { label: "Enabled", n: summary.enabled, tone: "text-green-600" },
          { label: "Disabled", n: summary.disabled, tone: summary.disabled ? "text-rose-600" : "text-gray-300" },
          { label: "Customised", n: summary.customized, tone: summary.customized ? "text-violet-600" : "text-gray-300" },
          ...summary.planes.map(p => ({ label: p.label.replace(" Workspaces", "").replace("Platform (Landlord)", "Platform"), n: p.n, tone: "text-gray-700" })),
        ].slice(0, 6).map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <WorkspaceDirectory groups={groups} canEdit={!needsMigration} />

      <p className="text-[11px] text-gray-400 pb-4">The workspace catalogue — routes and default audiences — is defined in application code across three planes (role portals, organisation workspaces, platform/landlord workspaces), so it never drifts from the running app. This console stores management overrides (enabled state, name, icon, theme accent, audience). Layout, menu and widget composition is rendered by each workspace shell today; DB-driven composition and live enforcement of enabled/audience wire in incrementally.</p>
    </div>
  );
}
