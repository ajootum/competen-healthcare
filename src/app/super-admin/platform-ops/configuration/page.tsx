import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { WORKSPACE_CATALOG } from "@/lib/config/workspace-catalog";
import { loadConfigOverrides } from "@/lib/config/workspace-config";
import WorkspaceDesigner from "./WorkspaceDesigner";

export const dynamic = "force-dynamic";

// Workspace Configuration Engine (WCE-001) — the no-code Designer. Enable/disable,
// rename and re-order sections & modules per scope (Platform → Hospital → …), with
// draft/published separation, version history and rollback. The configurable-object
// catalogue is code-defined; the DB carries sparse overrides. Runtime enforcement
// is live for wired workspaces (Unit Manager); it rolls out to the rest per phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default async function WorkspaceConfiguration() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { provisioned, rows } = await loadConfigOverrides(admin);
  const [versionsRes, auditRes, hospitalsRes] = await Promise.all([
    admin.from("workspace_config_versions").select("id, scope_type, scope_ref, label, note, status, published_by_name, created_at").order("created_at", { ascending: false }).limit(40),
    admin.from("workspace_config_audit").select("action, scope_type, scope_ref, config_path, actor_name, created_at").order("created_at", { ascending: false }).limit(15),
    admin.from("hospitals").select("id, name").order("name").limit(200),
  ]);
  const versions = versionsRes.data ?? [];
  const audit = auditRes.data ?? [];
  const hospitals = hospitalsRes.data ?? [];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Workspace Configuration Engine</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Workspace Configuration Engine</h1>
        <p className="text-sm text-gray-500">No-code configuration of every workspace, section and module — with hierarchical inheritance, versioning, publish and rollback.</p>
      </div>

      {!provisioned && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Not provisioned.</span> Run <code className="font-mono text-[12px] bg-amber-100 px-1 rounded">migration 076-workspace-config-engine.sql</code> to enable editing. The catalogue below is shown read-only until then.
        </div>
      )}

      <WorkspaceDesigner catalog={WORKSPACE_CATALOG} rows={rows} versions={versions} hospitals={hospitals} provisioned={provisioned} />

      {/* Change audit */}
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Configuration Change Log</h2>
        {audit.length === 0 ? <p className="text-sm text-gray-400">No configuration changes recorded yet.</p> : (
          <div className="space-y-1.5">
            {audit.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded font-semibold ${a.action === "publish" ? "bg-green-50 text-green-700" : a.action === "rollback" ? "bg-amber-50 text-amber-700" : a.action === "reset" ? "bg-gray-100 text-gray-500" : "bg-blue-50 text-blue-700"}`}>{a.action}</span>
                <span className="text-gray-700">{a.config_path ?? `${a.scope_type} scope`}</span>
                <span className="text-gray-400">· {a.scope_type}{a.scope_ref && a.scope_type !== "platform" ? `:${String(a.scope_ref).slice(0, 8)}` : ""}</span>
                <span className="ml-auto text-gray-400">{a.actor_name ?? "—"} · {relTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Honest next-phase capabilities */}
      <div className={`${card} border-dashed p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Roadmap — next-phase capabilities</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[
            ["Drag-and-drop layout editor", "Reorder is stored as an order override; the visual DnD canvas is next."],
            ["Form & field builder", "workspace_forms / workspace_fields tables + a field designer."],
            ["Widget & theme configuration", "Per-scope widget selection and theme tokens."],
            ["Workflow rules engine", "Conditional show/require rules per module."],
            ["Full metadata-driven rendering", "Every workspace renders from the engine (live now for Unit Manager; rolling out per workspace)."],
            ["Unit / user preference scopes", "Resolver + API already support them; Designer UI surfaces Platform & Hospital today."],
          ].map(([t, s]) => (
            <div key={t}><p className="text-xs font-semibold text-gray-600">{t}</p><p className="text-[10px] text-gray-400">{s}</p></div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">WCE-001 delivers the engine core: a code-defined configurable-object catalogue + sparse DB overrides resolved along the Platform→Tenant→Hospital→Unit→Role→User hierarchy, with draft/published separation, version snapshots, one-click rollback and a full change audit — all behind a super-admin-gated, service-role API. Runtime enforcement is live for the Unit Manager sidebar; other workspaces are catalogued and their config is stored &amp; versioned now, with enforcement rolling out per workspace rather than fabricated as complete.</p>
    </div>
  );
}
