import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRegistry, OBJECT_TYPE_LABEL } from "@/lib/config/registry";
import RegistryExplorer from "./RegistryExplorer";
import { StatWide as Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Platform Configuration Registry (WCE-002) — the authoritative catalogue of every configurable platform
// object. Registry dashboard (§19.1) + object explorer / search / detail (§19.2–19.4) over the real objects
// synced from the in-code WORKSPACE_CATALOG. The deeper capabilities (schema editor, dependency graph,
// lifecycle workflow, versioned property tables) are honest next-phase. Super-admin gated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default async function ConfigurationRegistry() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const reg = await loadRegistry(admin);

  const header = (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-400"><Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Configuration Registry</span></div>
      <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Platform Configuration Registry <span className="text-sm font-medium text-gray-400">WCE-002</span></h1>
      <p className="text-sm text-gray-500">The authoritative catalogue of every configurable platform object — keys, hierarchy, configurability, safety class, override policy and dependencies. Feeds WCE-001 / WCE-003.</p>
    </div>
  );

  if (!reg.provisioned) return (
    <div data-wide className="space-y-4">{header}
      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-sm text-amber-800"><span className="font-semibold">Not provisioned.</span> Run <code className="font-mono text-[12px] bg-[var(--cmp-surface-warning)] px-1 rounded">migration 092-config-registry.sql</code> to create the registry, then use “Sync from catalogue”.</div>
    </div>
  );

  const s = reg.stats;

  return (
    <div data-wide className="space-y-4">
      {header}

      {/* Registry dashboard (§19.1) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Stat label="Total Objects" value={s.total} />
        <Stat label="Active" value={s.active} tone="text-[var(--cmp-text-success)]" />
        <Stat label="Draft / Review" value={s.draft} tone={s.draft ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Deprecated" value={s.deprecated} tone={s.deprecated ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} />
        <Stat label="Retired" value={s.retired} tone="text-gray-400" />
        <Stat label="Workspaces" value={s.workspaces} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Hierarchy counts */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Registered Hierarchy</h2>
          <div className="space-y-2">
            {[["Workspaces", s.workspaces], ["Navigation sections", s.sections], ["Modules", s.modules]].map(([l, n]) => (
              <div key={l as string} className="flex items-center justify-between text-sm"><span className="text-gray-600">{l}</span><b className="tabular-nums text-gray-900">{n as number}</b></div>
            ))}
          </div>
          <h3 className="text-xs font-bold text-gray-500 mt-4 mb-2 uppercase">By type</h3>
          <div className="space-y-1">{s.byType.map((t: any) => <div key={t.type} className="flex items-center justify-between text-xs"><span className="text-gray-600">{OBJECT_TYPE_LABEL[t.type] ?? t.type}</span><b className="tabular-nums text-gray-700">{t.n}</b></div>)}</div>
        </div>

        {/* Governance quality (§19.1) */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Registry Health</h2>
          <div className="space-y-2 text-sm">
            <Flag label="Missing configuration owner" n={s.missingOwners} />
            <Flag label="Configurable objects missing a data source" n={s.missingDataSource} />
            <Flag label="Unresolved dependencies" n={s.unresolvedDeps} />
            <Flag label="Orphaned (parent not registered)" n={s.orphaned} />
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Data-source binding is next-phase — modules will reference a registered DATA_SOURCE object (§16). Until then the “missing data source” flag is expected.</p>
        </div>

        {/* Recent changes */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Recent Registry Changes</h2>
          {reg.auditRecent.length === 0 ? <p className="text-sm text-gray-400 py-4">No registry changes yet — run a sync to populate.</p> : (
            <div className="space-y-1.5">{reg.auditRecent.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs"><span className="px-1.5 py-0.5 rounded font-semibold bg-teal-50 text-teal-700">{a.action}</span><span className="text-gray-600 truncate flex-1">{a.object_key ?? "registry"}</span><span className="text-gray-400 shrink-0">{a.actor_name ?? "—"} · {relTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Object explorer + search + detail (§19.2–19.4) */}
      <RegistryExplorer objects={reg.objects} />

      {/* Honest next-phase */}
      <div className={`${card} border-dashed p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Roadmap — next-phase capabilities</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[
            ["Property & schema editor (§12, §19.6)", "Per-object configurable properties with data types, validation and version compare."],
            ["Dependency graph (§19.5)", "Visual parent-child + service/data/permission dependency & downstream-impact map."],
            ["Lifecycle & approvals (§20, §26.2)", "Draft → review → approved → published workflow with separation-of-duties."],
            ["Data-source registration (§16)", "DATA_SOURCE objects; widgets bound only to registered sources."],
            ["Conflict detection (§18)", "Blocking-error / warning classification before publish."],
            ["Impact analysis (§29)", "Tenants / templates / APIs affected before a registry change."],
          ].map(([t, d]) => <div key={t}><p className="text-xs font-semibold text-gray-600">{t}</p><p className="text-[10px] text-gray-400">{d}</p></div>)}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">WCE-002 MVP: a data-backed registry (configuration_registry_objects + immutable audit, migration 092) seeded from the real in-code WORKSPACE_CATALOG via an idempotent “sync from catalogue” — so every workspace, section and module carries a permanent object key, configurability class, safety classification, override policy and dependency set, browsable and searchable here. It is the authoritative catalogue WCE-001 resolves against; the schema/property editor, dependency graph, lifecycle workflow, data-source binding, conflict detection and impact analysis are honest next-phase rather than fabricated. Super-admin gated; every write audited.</p>
    </div>
  );
}

function Flag({ label, n }: { label: string; n: number }) {
  return <div className="flex items-center justify-between"><span className="text-gray-600 text-xs">{label}</span><span className={`text-sm font-bold tabular-nums ${n ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"}`}>{n}</span></div>;
}
