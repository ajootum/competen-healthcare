import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDependencyGraph } from "@/lib/config/dependency-graph";
import DependencyExplorer from "./DependencyExplorer";

export const dynamic = "force-dynamic";

// Dependency Graph Service (NCP-000) — the configuration dependency graph over the WCE-002 registry:
// impact analysis (transitive dependents = blast radius), circular-dependency detection (a publish blocker)
// and broken-reference detection. Powers the pipeline's "Dependency Analysis" stage. Super-admin gated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}
const impactTone = (n: number) => (n >= 10 ? "bg-rose-500 text-white" : n >= 3 ? "bg-amber-400 text-white" : "bg-emerald-400 text-emerald-950");

export default async function DependencyGraphPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const g: any = await loadDependencyGraph(admin);

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Dependency Graph</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🕸️</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dependency Graph Service</h1>
          <p className="text-sm text-gray-500">Trace configuration dependencies, analyse change impact (blast radius) and detect circular or broken references across the registry — the publishing pipeline&apos;s Dependency Analysis stage.</p>
        </div>
      </div>
    </>
  );

  if (!g.provisioned) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Registry not provisioned</p><p className="text-sm text-amber-800 mt-1">The dependency graph is built from the Configuration Registry. Apply migration 092 and run <Link href="/super-admin/platform-ops/registry" className="underline">Sync from catalogue</Link> to populate it.</p></div></div>;

  const s = g.stats;
  return (
    <div className="space-y-5 max-w-6xl">
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Objects" value={s.nodes} sub="in the graph" />
        <Stat label="Dependency Edges" value={s.edges} sub="containment + explicit" />
        <Stat label="Circular Dependencies" value={s.cycles} tone={s.cycles ? "text-rose-600" : "text-emerald-600"} sub={s.cycles ? "publish blocker" : "none — acyclic"} />
        <Stat label="Broken References" value={s.broken} tone={s.broken ? "text-amber-600" : "text-emerald-600"} sub={s.broken ? "unresolved deps/parents" : "all resolved"} />
        <Stat label="Max Blast Radius" value={s.maxImpact} sub="most-depended-on object" />
      </div>

      {s.cycles > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
          <p className="font-semibold text-rose-900 text-sm">⚠ {s.cycles} circular dependency chain{s.cycles === 1 ? "" : "s"} — resolve before publishing</p>
          <div className="mt-2 space-y-1">{g.cycles.map((c: string[], i: number) => <p key={i} className="text-[11px] text-rose-700 font-mono">{c.join(" → ")}</p>)}</div>
        </div>
      )}

      {s.broken > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="font-semibold text-amber-900 text-sm">{s.broken} broken reference{s.broken === 1 ? "" : "s"} — an object points to a {`{parent/dependency}`} that is not in the registry</p>
          <div className="mt-2 space-y-1">{g.broken.map((b: any, i: number) => <p key={i} className="text-[11px] text-amber-800 font-mono">{b.from} <span className="text-amber-400">─{b.kind}→</span> {b.to} <span className="text-amber-500">(missing)</span></p>)}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-4 lg:col-span-1`}>
          <p className="font-semibold text-gray-900 text-sm mb-1">Highest Blast Radius</p>
          <p className="text-[10px] text-gray-400 mb-3">Objects whose change affects the most others — review these carefully before editing.</p>
          {g.topImpact.length ? (
            <div className="space-y-2">
              {g.topImpact.map((o: any) => (
                <div key={o.key} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{o.label}</p><p className="text-[10px] text-gray-400">{o.type.replace(/_/g, " ")}</p></div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded tabular-nums ${impactTone(o.impact)}`}>{o.impact}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 py-6 text-center">No dependency edges yet.</p>}
        </div>
        <div className="lg:col-span-2">
          <p className="font-semibold text-gray-900 text-sm mb-2">Impact Explorer</p>
          <DependencyExplorer nodes={g.nodes} dependsOn={g.dependsOn} dependents={g.dependents} />
        </div>
      </div>
    </div>
  );
}
