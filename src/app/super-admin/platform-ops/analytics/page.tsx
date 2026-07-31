import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadConfigAnalytics } from "@/lib/config/analytics";

export const dynamic = "force-dynamic";

// Configuration Analytics & Optimisation Centre (NCP-013) — continuous analytics over the config estate: health
// scoring, inventory/adoption, unused assets, dependency hotspots, change churn, activity trend, approval cycle
// time and explainable optimisation recommendations. Computed from existing stores (no new store). Predictive
// forecasting, cross-tenant benchmarking and model-based recommendations (§6/§7) are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const healthTone = (n: number) => n >= 80 ? "text-[var(--cmp-text-success)]" : n >= 50 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]";
function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}
function Bars({ rows, tone = "bg-indigo-400" }: { rows: [string, number][]; tone?: string }) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return <div className="space-y-1">{rows.map(([k, n]) => (
    <div key={k} className="flex items-center gap-2 text-[11px]"><span className="w-32 truncate text-gray-500 shrink-0">{k}</span><div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${(n / max) * 100}%` }} /></div><span className="w-8 text-right tabular-nums text-gray-600">{n}</span></div>
  ))}</div>;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const a: any = await loadConfigAnalytics(admin);

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Analytics &amp; Optimisation</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">📉</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics &amp; Optimisation <span className="text-gray-300 font-medium text-lg">(NCP-013)</span></h1>
          <p className="text-sm text-gray-500">Continuous health, adoption and optimisation intelligence across the configuration estate.</p>
        </div>
      </div>
    </>
  );

  if (!a.provisioned) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">The configuration registry (migration 092) is not set up yet — there is nothing to analyse.</p></div></div>;

  const sevTone: Record<string, string> = { high: "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]", medium: "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]", low: "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)]" };
  const sevDot: Record<string, string> = { high: "bg-[var(--cmp-color-error)]", medium: "bg-[var(--cmp-color-warning)]", low: "bg-[var(--cmp-color-success)]" };
  const maxSpark = Math.max(1, ...a.activity.series);
  const momentum = a.activity.last7 - a.activity.prev7;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Configuration Health" value={`${a.health.overall}`} tone={healthTone(a.health.overall)} sub="weighted, 0–100" />
        <Stat label="Objects" value={a.inventory.total} sub={`${a.inventory.studioAuthored} studio-authored`} />
        <Stat label="Definition Rate" value={`${a.inventory.definitionRate}%`} tone={a.inventory.definitionRate >= 80 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} sub={`${a.inventory.defined}/${a.inventory.authorable} authorable`} />
        <Stat label="Avg Cycle Time" value={a.cycleTime.provisioned ? `${a.cycleTime.avgDays}d` : "—"} sub={a.cycleTime.provisioned ? `${a.cycleTime.settled} settled CRs` : "no governance data"} />
      </div>

      {/* Recommendations — the optimisation core */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-1">Optimisation Recommendations</h2>
        <p className="text-[11px] text-gray-400 mb-3">Rule-based and explainable — each derived from the live dependency graph, registry and governance state.</p>
        <div className="space-y-2">
          {a.recommendations.map((r: any, i: number) => (
            <Link key={i} href={r.href} className={`flex items-start gap-2.5 rounded-lg border p-3 ${sevTone[r.severity]} hover:brightness-[0.98] transition`}>
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sevDot[r.severity]}`} />
              <div><p className="text-xs font-semibold text-gray-800">{r.title}</p><p className="text-[11px] text-gray-500">{r.why}</p></div>
              <span className="ml-auto text-gray-300 text-xs">→</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Health distribution + worst */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Health Distribution</h2>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 flex h-4 rounded overflow-hidden bg-gray-100">
              <div className="bg-[var(--cmp-color-success)] h-full" style={{ width: `${(a.health.dist.healthy / a.inventory.total) * 100}%` }} />
              <div className="bg-[var(--cmp-color-warning)] h-full" style={{ width: `${(a.health.dist.watch / a.inventory.total) * 100}%` }} />
              <div className="bg-[var(--cmp-color-error)] h-full" style={{ width: `${(a.health.dist.atRisk / a.inventory.total) * 100}%` }} />
            </div>
          </div>
          <div className="flex gap-4 text-[11px] mb-3"><span className="text-[var(--cmp-text-success)]">● {a.health.dist.healthy} healthy</span><span className="text-[var(--cmp-text-warning)]">● {a.health.dist.watch} watch</span><span className="text-[var(--cmp-text-error)]">● {a.health.dist.atRisk} at-risk</span></div>
          {a.health.worst.length > 0 && <>
            <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Lowest scoring</p>
            <div className="space-y-1">{a.health.worst.map((w: any) => (
              <div key={w.key} className="flex items-center gap-2 text-[11px]"><span className={`w-8 font-bold tabular-nums ${healthTone(w.score)}`}>{w.score}</span><span className="text-gray-700 truncate flex-1">{w.name}</span><span className="text-gray-400 truncate max-w-[10rem]">{w.reasons.join(", ")}</span></div>
            ))}</div>
          </>}
        </div>

        {/* Inventory */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Inventory by Type</h2>
          <Bars rows={a.inventory.byType} />
          <p className="text-[11px] font-semibold text-gray-500 mt-4 mb-1.5">By status</p>
          <Bars rows={a.inventory.byStatus} tone="bg-[var(--cmp-color-information)]" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hotspots */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Dependency Hotspots</h2>
          <p className="text-[11px] text-gray-400 mb-3">Highest blast radius — most downstream objects affected if changed.</p>
          {a.hotspots.length === 0 ? <p className="text-[11px] text-gray-400">No dependency edges yet.</p> : (
            <div className="space-y-1">{a.hotspots.map((h: any) => (
              <Link key={h.key} href="/super-admin/platform-ops/dependencies" className="flex items-center gap-2 text-[11px] hover:bg-gray-50 rounded px-1 py-0.5"><span className="w-8 text-right font-bold tabular-nums text-indigo-600">{h.impact}</span><span className="text-gray-700 truncate flex-1">{h.label}</span><span className="text-[9px] text-gray-400 font-mono">{h.type}</span></Link>
            ))}</div>
          )}
        </div>

        {/* Churn */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Most-Changed Objects</h2>
          <p className="text-[11px] text-gray-400 mb-3">Version churn — objects with the most snapshots.</p>
          {a.churn.length === 0 ? <p className="text-[11px] text-gray-400">No version history yet.</p> : (
            <div className="space-y-1">{a.churn.map((cn: any) => (
              <Link key={cn.key} href="/super-admin/platform-ops/versions" className="flex items-center gap-2 text-[11px] hover:bg-gray-50 rounded px-1 py-0.5"><span className="w-8 text-right font-bold tabular-nums text-[var(--cmp-text-warning)]">{cn.versions}</span><span className="text-gray-700 truncate flex-1">{cn.name}</span></Link>
            ))}</div>
          )}
        </div>
      </div>

      {/* Activity + unused */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Change Activity <span className="text-gray-300 font-normal">· 14 days</span></h2>
          <p className="text-[11px] text-gray-400 mb-3">{a.activity.last7} changes in the last 7 days · <span className={momentum >= 0 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}>{momentum >= 0 ? "▲" : "▼"} {Math.abs(momentum)}</span> vs prior 7</p>
          <div className="flex items-end gap-1 h-16 mb-3">{a.activity.series.map((n: number, i: number) => <div key={i} className="flex-1 bg-indigo-300 rounded-t" style={{ height: `${Math.max(4, (n / maxSpark) * 100)}%` }} title={`${n}`} />)}</div>
          {a.activity.byAction.length > 0 && <div className="flex flex-wrap gap-1.5">{a.activity.byAction.slice(0, 6).map(([act, n]: [string, number]) => <span key={act} className="text-[10px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 text-gray-600">{act} · {n}</span>)}</div>}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Unused Assets</h2>
          <p className="text-[11px] text-gray-400 mb-3">Draft objects nothing depends on — candidates to publish or retire.</p>
          {a.unused.length === 0 ? <p className="text-[11px] text-gray-400">None — every draft is referenced or in flight.</p> : (
            <div className="space-y-1">{a.unused.map((u: any) => (
              <div key={u.key} className="flex items-center gap-2 text-[11px]"><span className="text-[9px] px-1 py-px rounded bg-gray-100 text-gray-500">{u.type}</span><span className="text-gray-700 truncate flex-1">{u.name}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Health scoring, hotspots, churn and recommendations are computed live from the registry, dependency graph, version snapshots and governance. Predictive forecasting, cross-tenant benchmarking and model-based (vs rule-based) recommendations (NCP-013 §6/§7) are next-phase.</p>
    </div>
  );
}
