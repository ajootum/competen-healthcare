import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadIntegrationMapper } from "@/lib/config/integration-mapper";
import { Stat } from "../_kit";

export const dynamic = "force-dynamic";

// Data Source & Integration Mapper (NCP-010) — the supported connector catalogue, the data sources referenced
// by registry objects, and the data-source binding COVERAGE (bound vs unbound configurable objects — the gap).
// Grounded in the WCE-002 registry; the visual mapping designer / transformation engine / live connectors /
// scheduler / monitoring are honest next-phase. Super-admin gated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";

const TYPE_LABEL: Record<string, string> = { MODULE: "Module", WIDGET: "Widget", PAGE: "Page", DASHBOARD: "Dashboard", REPORT: "Report", METRIC: "Metric" };
const NEXT_PHASE = ["Visual source→target mapping designer", "Transformation engine (type conversion, lookups, code translation, masking)", "Live connectors + secure credential vault", "FHIR/HL7 schema mapping", "Scheduler + change-data capture", "Monitoring, reconciliation & dead-letter retry"];

export default async function IntegrationMapper() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d: any = await loadIntegrationMapper(admin);

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Data Source & Integration Mapper</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🔗</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Data Source &amp; Integration Mapper <span className="text-gray-300 font-medium text-lg">(NCP-010)</span></h1>
          <p className="text-sm text-gray-500">Connect, map and govern the data sources that power every configurable object — internal services, hospital systems and third-party platforms.</p>
        </div>
      </div>
    </>
  );

  if (!d.provisioned) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Registry not provisioned</p><p className="text-sm text-amber-800 mt-1">Binding coverage is computed from the Configuration Registry. Apply migration 092 and run <Link href="/super-admin/platform-ops/registry" className="underline">Sync from catalogue</Link>.</p></div></div>;

  const s = d.stats;
  return (
    <div className="space-y-5 max-w-6xl">
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Registered Data Sources" value={s.sources} sub="referenced by objects" />
        <Stat label="Connector Types" value={s.connectorTypes} sub="supported (§5)" />
        <Stat label="Binding Coverage" value={`${s.coverage}%`} tone={s.coverage >= 80 ? "text-[var(--cmp-text-success)]" : s.coverage >= 40 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"} sub={`${s.bound}/${s.configurable} configurable objects bound`} />
        <Stat label="Unbound Objects" value={s.unbound} tone={s.unbound ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} sub={s.unbound ? "need a data source" : "all bound"} />
      </div>

      {/* Connector catalogue */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-1">Connector Catalogue</h2>
        <p className="text-[11px] text-gray-400 mb-4">The connector families a mapping can bind to (§5). Live connector provisioning + credential vault is next-phase.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {d.connectors.map((g: any) => (
            <div key={g.group} className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5 mb-2"><span>{g.icon}</span>{g.group}</p>
              <div className="flex flex-wrap gap-1">{g.items.map((it: string) => <span key={it} className="text-[10px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 text-gray-600">{it}</span>)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sources in use + binding gap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Data Sources In Use</h2>
          {d.sources.length ? (
            <div className="space-y-1.5">{d.sources.map((src: any) => <div key={src.key} className="flex items-center justify-between gap-2 text-[11px]"><code className="text-gray-700 font-mono truncate">{src.key}</code><span className="text-gray-400 shrink-0">{src.n} object{src.n === 1 ? "" : "s"}</span></div>)}</div>
          ) : <p className="text-xs text-gray-400 py-6 text-center">No objects reference a data source yet — bind them below to power live data.</p>}
        </div>
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Binding Gap</h2>
          <p className="text-[11px] text-gray-400 mb-3">Configurable objects with no data source — bind these so the runtime can render live data.</p>
          {d.gap.length ? (
            <>
              <div className="flex flex-wrap gap-2 mb-3">{d.gap.map((g: any) => <span key={g.type} className="text-[11px] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] border border-[var(--cmp-color-warning)] rounded-full px-2 py-0.5">{TYPE_LABEL[g.type] ?? g.type}: {g.n}</span>)}</div>
              <div className="space-y-1 max-h-56 overflow-y-auto">{d.unboundList.map((o: any) => <div key={o.key} className="flex items-center gap-2 text-[11px]"><span className="text-[9px] font-semibold rounded px-1.5 py-0.5 bg-gray-100 text-gray-500 shrink-0">{TYPE_LABEL[o.type] ?? o.type}</span><span className="text-gray-600 truncate">{o.label}</span></div>)}</div>
            </>
          ) : <p className="text-xs text-[var(--cmp-text-success)] py-6 text-center">✓ Every configurable object is bound to a data source.</p>}
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-2">Roadmap — next-phase capabilities (§4/§7/§8)</h2>
        <div className="flex flex-wrap gap-1.5">{NEXT_PHASE.map(n => <span key={n} className="text-[11px] bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1 text-gray-500">{n}</span>)}</div>
      </div>
    </div>
  );
}
