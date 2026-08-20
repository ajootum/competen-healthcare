import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDependencyGraph } from "@/lib/config/dependency-graph";
import DependencyExplorer from "./DependencyExplorer";
import { Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Dependency Graph Service (NCP-000) — the configuration dependency graph over the WCE-002 registry:
// impact analysis (transitive dependents = blast radius), circular-dependency detection (a publish blocker)
// and broken-reference detection. Powers the pipeline's "Dependency Analysis" stage. Super-admin gated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";

const impactTone = (n: number) => (n >= 10 ? "bg-[var(--cmp-color-error)] text-white" : n >= 3 ? "bg-[var(--cmp-color-warning)] text-white" : "bg-[var(--cmp-color-success)] text-emerald-950");

export default async function DependencyGraphPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const g: any = await loadDependencyGraph(admin);

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Dependency Manager</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🕸️</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dependency Manager <span className="text-gray-500 font-medium text-lg">(NCP-017)</span></h1>
          <p className="text-sm text-gray-500">Trace configuration dependencies, analyse change impact (blast radius) and validate the graph — circular, broken and orphaned references — as the deployment guard for safe publishing.</p>
        </div>
      </div>
    </>
  );

  if (!g.provisioned) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Registry not provisioned</p><p className="text-sm text-amber-800 mt-1">The dependency graph is built from the Configuration Registry. Apply migration 092 and run <Link href="/super-admin/platform-ops/registry" className="underline">Sync from catalogue</Link> to populate it.</p></div></div>;

  const s = g.stats;
  return (
    <div className="space-y-5 max-w-6xl">
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat label="Objects" value={s.nodes} sub="in the graph" />
        <Stat label="Dependency Edges" value={s.edges} sub="containment + explicit" />
        <Stat label="Circular Dependencies" value={s.cycles} tone={s.cycles ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} sub={s.cycles ? "publish blocker" : "none — acyclic"} />
        <Stat label="Broken References" value={s.broken} tone={s.broken ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} sub={s.broken ? "unresolved deps/parents" : "all resolved"} />
        <Stat label="Orphaned" value={s.orphans} tone={s.orphans ? "text-[var(--cmp-text-information)]" : "text-[var(--cmp-text-success)]"} sub={s.orphans ? "isolated objects" : "none isolated"} />
        <Stat label="Max Blast Radius" value={s.maxImpact} sub="most-depended-on" />
      </div>

      {s.cycles > 0 && (
        <div className="bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] rounded-xl p-4">
          <p className="font-semibold text-rose-900 text-sm">⚠ {s.cycles} circular dependency chain{s.cycles === 1 ? "" : "s"} — resolve before publishing</p>
          <div className="mt-2 space-y-1">{g.cycles.map((c: string[], i: number) => <p key={i} className="text-[11px] text-[var(--cmp-text-error)] font-mono">{c.join(" → ")}</p>)}</div>
        </div>
      )}

      {s.broken > 0 && (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4">
          <p className="font-semibold text-amber-900 text-sm">{s.broken} broken reference{s.broken === 1 ? "" : "s"} — an object points to a {`{parent/dependency}`} that is not in the registry</p>
          <div className="mt-2 space-y-1">{g.broken.map((b: any, i: number) => <p key={i} className="text-[11px] text-amber-800 font-mono">{b.from} <span className="text-amber-400">─{b.kind}→</span> {b.to} <span className="text-amber-500">(missing)</span></p>)}</div>
        </div>
      )}

      {g.orphans.length > 0 && (
        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-1">Orphaned Objects <span className="text-gray-500 font-normal">— {g.orphans.length}</span></p>
          <p className="text-[10px] text-gray-500 mb-3">Depend on nothing and nothing depends on them — wire them into a page/dashboard/menu, or retire.</p>
          <div className="flex flex-wrap gap-1.5">{g.orphans.map((o: any) => <span key={o.key} className="text-[11px] bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] text-[var(--cmp-text-information)] rounded px-2 py-0.5">{o.label} <span className="text-sky-400 text-[9px]">{o.type.replace(/_/g, " ")}</span></span>)}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-4 lg:col-span-1`}>
          <p className="font-semibold text-gray-900 text-sm mb-1">Highest Blast Radius</p>
          <p className="text-[10px] text-gray-500 mb-3">Objects whose change affects the most others — review these carefully before editing.</p>
          {g.topImpact.length ? (
            <div className="space-y-2">
              {g.topImpact.map((o: any) => (
                <div key={o.key} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{o.label}</p><p className="text-[10px] text-gray-500">{o.type.replace(/_/g, " ")}</p></div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded tabular-nums ${impactTone(o.impact)}`}>{o.impact}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-500 py-6 text-center">No dependency edges yet.</p>}
        </div>
        <div className="lg:col-span-2">
          <p className="font-semibold text-gray-900 text-sm mb-2">Impact Explorer</p>
          <DependencyExplorer nodes={g.nodes} dependsOn={g.dependsOn} dependents={g.dependents} />
        </div>
      </div>
    </div>
  );
}
