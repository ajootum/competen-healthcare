import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCatalogue } from "@/lib/config/catalogue";
import CatalogueBrowser from "./CatalogueBrowser";
import { StatWide as Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Module & Widget Configuration Catalogue (WCE-005) — the browsable reference of catalogue records. Composes
// the WCE-002 registry with the code-defined widget contracts; surfaces the completeness score (§46) and the
// widget library (§12–13). Deeper per-object property/override/test-requirement tables are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (p: number) => (p >= 85 ? "text-[var(--cmp-text-success)]" : p >= 70 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");

export default async function ModuleWidgetCatalogue() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const d = await loadCatalogue(admin);
  const s = d.stats;

  const header = (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-400"><Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Module &amp; Widget Catalogue</span></div>
      <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Module &amp; Widget Catalogue <span className="text-sm font-medium text-gray-400">WCE-005</span></h1>
      <p className="text-sm text-gray-500">The detailed catalogue of every configurable module and widget — configuration contracts, data sources, safety class and completeness. Registered into WCE-002, exposed via WCE-003.</p>
    </div>
  );

  return (
    <div data-wide className="space-y-4">
      {header}

      {!s.registryProvisioned && (
        <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-sm text-amber-800"><span className="font-semibold">Registry not provisioned.</span> The widget contracts below are code-defined and browsable now; run <code className="font-mono text-[12px] bg-[var(--cmp-surface-warning)] px-1 rounded">migration 092</code> and sync the <Link href="/super-admin/platform-ops/registry" className="underline">registry</Link> to register them (WCE-002 integration).</div>
      )}

      {/* Catalogue dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Catalogue Records" value={s.catalogueRecords} />
        <Stat label="Widgets Catalogued" value={s.widgetsCatalogued} />
        <Stat label="Widgets Registered" value={`${s.widgetsRegistered}/${s.widgetsCatalogued}`} tone={s.widgetsRegistered === s.widgetsCatalogued ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Stat label="Modules" value={s.modules} />
        <Stat label="Avg Completeness" value={`${s.avgCompleteness}%`} tone={pctTone(s.avgCompleteness)} />
        <Stat label="Below Threshold" value={s.belowThreshold} tone={s.belowThreshold ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} />
      </div>

      {/* Widget library browser */}
      <CatalogueBrowser widgets={d.widgets} categories={d.categories} />

      {/* Module completeness (§46) */}
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Module Catalogue Completeness <span className="text-[10px] text-gray-400 font-normal">lowest first</span></h2>
        {d.modules.length === 0 ? <p className="text-sm text-gray-400 py-4">No modules registered yet — sync the registry.</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">{d.modules.slice(0, 20).map((m: any) => (
            <div key={m.key} className="flex items-center gap-2 text-xs"><span className="text-gray-700 truncate flex-1" title={m.key}>{m.name}</span><div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0"><div className="h-full rounded-full" style={{ width: `${m.completeness}%`, background: m.completeness >= 85 ? "#10b981" : m.completeness >= 70 ? "#f59e0b" : "#ef4444" }} /></div><b className={`tabular-nums w-9 text-right ${pctTone(m.completeness)}`}>{m.completeness}%</b></div>
          ))}</div>
        )}
        <p className="text-[10px] text-gray-400 mt-3">Completeness (§46) = identity + ownership + placement + configurability + safety + data-source elements defined. Data-source binding is a registry next-phase item, so module scores are expected below 100% until sources are registered.</p>
      </div>

      {/* Honest next-phase */}
      <div className={`${card} border-dashed p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Roadmap — next-phase catalogue capabilities</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[
            ["Per-object property tables (§45)", "catalogue_configuration_properties / override_rules / thresholds as data, not code."],
            ["Form & field catalogue (§7)", "Form/field records with validation, conditional logic and evidence rules."],
            ["Metric & data-source catalogue (§45)", "Registered metrics with definitions + authoritative data-source contracts."],
            ["Test-requirement records (§45)", "Per-object required tests feeding WCE-004 governance gates."],
            ["Completeness gate on publish (§46)", "Block publishing objects below the completeness threshold."],
            ["Shared-object reuse graph (§5)", "Which workspaces reference each shared widget, without duplication."],
          ].map(([t, x]) => <div key={t}><p className="text-xs font-semibold text-gray-600">{t}</p><p className="text-[10px] text-gray-400">{x}</p></div>)}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">WCE-005 MVP: the code-defined catalogue of the platform&apos;s {s.widgetsCatalogued} real widget primitives with their configuration contracts (category, layout constraints, data source, filters, thresholds, display modes, actions, safety class — §12) plus the module catalogue, with a completeness score (§46) per object. The widget records register into the WCE-002 registry (a registry sync adds them under the shared widget library) and are exposed through WCE-003. Like the workspace catalogue, contracts are code-defined so they never drift from the running components. The per-object property / metric / data-source / test-requirement tables (§45) are honest next-phase. Super-admin gated.</p>
    </div>
  );
}
