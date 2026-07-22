import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadInfrastructure } from "@/lib/super-admin/sys-infra";
import JobRunner from "../../ai/_components/JobRunner";

export const dynamic = "force-dynamic";

// Infrastructure & Services (SYS-001.4) — environments, deployments and shared
// services. Real runtime facts (timed DB probe, region, version, release,
// liveness probes, job runner, region ledger); cluster/container/CPU telemetry
// isn't provisioned and shows honest "not provisioned" states (SYS-002 AC-02).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const SVC_TONE: Record<string, string> = { operational: "bg-green-50 text-green-700", slow: "bg-amber-50 text-amber-700", degraded: "bg-rose-50 text-rose-700" };
const W_TONE: Record<string, string> = { ok: "bg-green-50 text-green-700", warn: "bg-amber-50 text-amber-700", down: "bg-rose-50 text-rose-700", na: "bg-gray-100 text-gray-400" };
const JOB_TONE: Record<string, string> = { running: "bg-blue-50 text-blue-700", success: "bg-green-50 text-green-700", failed: "bg-rose-50 text-rose-700" };

export default async function InfrastructureServices() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadInfrastructure(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Services", value: `${k.servicesOperational}/${k.services}`, icon: "🖥️", iconBg: "bg-blue-50", tone: k.servicesOperational === k.services ? "text-green-600" : "text-amber-600" },
    { label: "Active Regions", value: dash(k.regions), icon: "🌍", iconBg: "bg-teal-50" },
    { label: "Deployments", value: dash(k.deployments), icon: "🚀", iconBg: "bg-violet-50" },
    { label: "Automations", value: dash(k.jobs), icon: "⚙️", iconBg: "bg-sky-50" },
    { label: "DB Latency", value: k.dbLatencyMs != null ? `${k.dbLatencyMs}ms` : "—", icon: "⚡", iconBg: "bg-green-50", tone: k.dbLatencyMs != null && k.dbLatencyMs < 400 ? "text-green-600" : "text-amber-600" },
    { label: "Version", value: d.runtime.version ?? "—", icon: "🏷️", iconBg: "bg-gray-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/system" className="hover:text-teal-700">System &amp; Security</Link><span>/</span><span className="text-gray-600">Infrastructure &amp; Services</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Infrastructure &amp; Services</h1>
        <p className="text-sm text-gray-500">Environments, deployments and the shared services that power Competen.</p>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Real on-demand automations */}
      <JobRunner jobs={d.jobs.list} title="Run Automation / Maintenance Job" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Shared services */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Shared Services</h2>
            <span className="text-[10px] text-gray-400">{d.avgProbeMs != null ? `${d.avgProbeMs}ms avg` : ""}</span>
          </div>
          <div className="space-y-1.5">
            {d.services.map((s: any) => (
              <div key={s.key ?? s.label} className="flex items-center justify-between">
                <span className="text-xs text-gray-700">{s.label ?? s.name}</span>
                <span className="flex items-center gap-2">
                  {s.latencyMs != null && <span className="text-[10px] text-gray-400 tabular-nums">{s.latencyMs}ms</span>}
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${SVC_TONE[s.status] ?? "bg-gray-100 text-gray-500"}`}>{s.status}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Timed liveness probes against the live database.</p>
        </div>

        {/* Runtime & environment */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Runtime</h2>
            <span className="text-[10px] text-gray-400">{d.runtime.runtimeEnv ?? ""}</span>
          </div>
          <div className="space-y-1.5">
            {d.runtime.widgets.map((w: any) => (
              <div key={w.key} className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-700 shrink-0">{w.label}</span>
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-gray-500 truncate">{w.value}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${W_TONE[w.status] ?? "bg-gray-100 text-gray-500"}`}>{w.status}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Deployment ledger */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Deployments</h2>
            <Link href="/super-admin/platform-ops/control-plane" className="text-xs text-teal-700 hover:underline">Control plane →</Link>
          </div>
          {d.deployments.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No releases logged yet.</p> : (
            <div className="divide-y divide-gray-50">
              {d.deployments.map((dep: any, i: number) => (
                <div key={i} className="flex items-center gap-2 py-2">
                  <span className="text-xs font-mono text-gray-800 shrink-0">{dep.version}</span>
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 shrink-0">{dep.channel}</span>
                  <span className="text-[10px] text-gray-400 flex-1 truncate">{dep.notes ?? dep.status}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{relTime(dep.released_at ?? dep.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Release ledger from plat_deployments; logging a release is a landlord-plane action.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Automation registry */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Automation Registry</h2>
            <Link href="/super-admin/platform-ops/monitoring" className="text-xs text-teal-700 hover:underline">Monitoring →</Link>
          </div>
          {!d.jobs.summary.ready ? <p className="text-sm text-gray-400 py-4 text-center">Job runner not ready — run migration 054.</p> : (
            <div className="divide-y divide-gray-50">
              {d.jobs.list.map((j: any) => (
                <div key={j.key} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 leading-tight">{j.name}</p>
                    <p className="text-[10px] text-gray-400 leading-tight">{j.category} · <span className="font-mono">{j.schedule}</span>{j.runnable ? "" : " · external"}</p>
                  </div>
                  {j.last ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${JOB_TONE[j.last.status] ?? "bg-gray-100 text-gray-500"}`}>{j.last.status}</span> : <span className="text-[10px] text-gray-400 shrink-0">no runs</span>}
                  <span className="text-[10px] text-gray-400 w-14 text-right shrink-0">{relTime(j.last?.started_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Regions + not provisioned */}
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Regions <span className="text-[10px] text-gray-400">{d.activeRegions} active</span></h2>
            {d.regions.length === 0 ? <p className="text-xs text-gray-400">No regions configured.</p> : (
              <div className="flex flex-wrap gap-1.5">
                {d.regions.map((r: any) => (
                  <span key={r.code} className={`text-[10px] font-medium px-2 py-0.5 rounded border ${r.is_active ? "border-teal-200 bg-teal-50 text-teal-700" : "border-gray-200 bg-gray-50 text-gray-400"}`}>{r.code.toUpperCase()} · {r.name}</span>
                ))}
              </div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Not Provisioned</h2>
            <div className="space-y-1.5">
              {d.notProvisioned.map((l: string) => (
                <div key={l} className="flex items-center justify-between text-xs"><span className="text-gray-500">{l}</span><span className="text-[10px] font-medium text-gray-400">n/a</span></div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">This deployment runs serverless on Vercel + managed Postgres — no self-managed clusters, containers or cache runtime to surface.</p>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Infrastructure &amp; Services shows the real environment: timed database and service probes, the runtime facts (region, version, release), the release ledger, the region catalogue and the automation registry — with on-demand job execution. Clusters, containers, load balancers and CPU/memory utilisation are honest “not provisioned” states because this deployment is serverless (Vercel) over managed Postgres, not a self-hosted cluster (SYS-002 AC-02).</p>
    </div>
  );
}
