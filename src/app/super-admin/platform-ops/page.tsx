import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPlatformOps } from "@/lib/super-admin/platform-ops";
import { loadPlatformOperations } from "@/lib/platform/operations";
import PlatformOpsHeader from "./_po/PlatformOpsHeader";
import MissionControlBoard from "./MissionControlBoard";

export const dynamic = "force-dynamic";

// Platform Operations — section overview (POP-001). The operational console:
// KPI ribbon, services registry, tenant + workspace summaries, activity,
// deployments and resource usage, plus the 6-module directory. Live data; infra
// telemetry the platform does not meter shows honest "not monitored" states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };
const SEG = ["#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444", "#6b7280", "#0ea5e9"];

function Donut({ segments, total, label }: { segments: { label: string; n: number }[]; total: number; label: string }) {
  const C = 2 * Math.PI * 15.5;
  // Precompute each segment's dash + cumulative offset (no mutation during render).
  const arcs: { dash: number; offset: number; color: string }[] = [];
  let acc = 0;
  segments.forEach((s, i) => { const dash = (total ? s.n / total : 0) * C; arcs.push({ dash, offset: acc, color: SEG[i % SEG.length] }); acc += dash; });
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-28 h-28 shrink-0">
        <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="4" />
          {arcs.map((a, i) => <circle key={i} cx="18" cy="18" r="15.5" fill="none" stroke={a.color} strokeWidth="4" strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={-a.offset} />)}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-bold text-gray-900 tabular-nums">{fmt(total)}</span><span className="text-[9px] text-gray-400">{label}</span></div>
      </div>
      <div className="flex-1 space-y-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-gray-600"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SEG[i % SEG.length] }} />{s.label}</span>
            <span className="tabular-nums text-gray-700">{s.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, href, linkLabel, children, badge }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode; badge?: string }) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">{title}{badge && <span className="ml-2 text-[10px] font-medium text-gray-400">{badge}</span>}</h2>
        {href && <Link href={href} className="text-xs text-teal-700 hover:underline shrink-0">{linkLabel ?? "View all"} →</Link>}
      </div>
      {children}
    </div>
  );
}

export default async function PlatformOperations() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const [po, ops] = await Promise.all([loadPlatformOps(admin), loadPlatformOperations(admin)]);
  const { kpis, services, servicesSummary, tenantSummary, workspaceSummary, licensing, activity, activityReady, version } = po;

  const healthTone = kpis.health === "Healthy" ? "text-green-600" : kpis.health === "Attention" ? "text-amber-600" : "text-red-600";
  const healthIcon = kpis.health === "Healthy" ? "💚" : kpis.health === "Attention" ? "⚠️" : "🛑";
  const healthBg = kpis.health === "Healthy" ? "bg-green-50" : kpis.health === "Attention" ? "bg-amber-50" : "bg-red-50";
  const kpiCards = [
    { label: "Overall Health", value: kpis.health, icon: healthIcon, iconBg: healthBg, sub: "core services responding", tone: healthTone },
    { label: "Tenants", value: fmt(kpis.tenants), icon: "🏢", iconBg: "bg-blue-50", sub: `on ${licensing.plans} plans` },
    { label: "Users", value: fmt(kpis.activeUsers), icon: "👥", iconBg: "bg-violet-50", sub: "registered across tenants" },
    { label: "API Requests (24h)", value: "—", icon: "🧩", iconBg: "bg-sky-50", sub: "Not metered", muted: true },
    { label: "AI Requests (24h)", value: "—", icon: "🧠", iconBg: "bg-purple-50", sub: "Not metered", muted: true },
    { label: "Storage Used", value: "—", icon: "🗄️", iconBg: "bg-teal-50", sub: "Not metered", muted: true },
    { label: "Open Alerts", value: kpis.openAlerts == null ? "—" : fmt(kpis.openAlerts), icon: "🛡️", iconBg: "bg-rose-50", sub: kpis.criticalAlerts ? `${kpis.criticalAlerts} critical` : "monitored", tone: kpis.openAlerts ? "text-rose-600" : undefined },
  ];

  const quickActions = [
    { label: "Create Tenant", desc: "Provision a new tenant", icon: "🏢", href: "/super-admin/platform-ops/tenants" },
    { label: "Provision Modules", desc: "Enable modules for tenant", icon: "🧩", href: "/super-admin/platform-ops/tenants" },
    { label: "Deploy Workspace", desc: "Deploy or update workspace", icon: "🖥️", href: "/super-admin/platform-ops/workspaces" },
    { label: "Feature Management", desc: "Enable or disable features", icon: "🎚️", href: "/platform/control-plane" },
    { label: "View Platform Map", desc: "Architecture map", icon: "🗺️", href: "/super-admin/platform-ops/control-plane" },
    { label: "Run Health Check", desc: "Test platform services", icon: "🩺", href: "/super-admin/platform-ops/monitoring" },
    { label: "View Logs", desc: "Access system logs", icon: "📜", href: "/super-admin/platform-ops/monitoring" },
    { label: "Backup Now", desc: "Trigger platform backup", icon: "💾", href: "/super-admin/platform-ops" },
  ];

  const modules = [
    { n: 1, label: "Platform Control Plane", desc: "Environment, infrastructure, deployment & map", icon: "🧭", href: "/super-admin/platform-ops/control-plane", live: true },
    { n: 2, label: "Tenant Operations", desc: "Tenants, provisioning, health & bulk ops", icon: "🏢", href: "/super-admin/platform-ops/tenants", live: true },
    { n: 3, label: "Workspace Management", desc: "Layouts, menus, widgets, themes, permissions", icon: "🖥️", href: "/super-admin/platform-ops/workspaces", live: true },
    { n: 4, label: "Platform Services", desc: "Core/AI/Assessment/Learning/Integration engines", icon: "⚙️", href: "/super-admin/platform-ops", live: false },
    { n: 5, label: "Licensing & Subscription", desc: "Plans, licences, quotas, billing, renewals", icon: "🧾", href: "/super-admin/platform-ops/licensing", live: true },
    { n: 6, label: "Monitoring & Operations", desc: "Health, alerts, logs, events, backups", icon: "📡", href: "/super-admin/platform-ops/monitoring", live: true },
    { n: 7, label: "Workspace Configuration Engine", desc: "No-code config of workspaces, sections & modules — inheritance, versioning & rollback", icon: "🎛️", href: "/super-admin/platform-ops/configuration", live: true },
  ];

  return (
    <div data-wide className="space-y-4">
      <PlatformOpsHeader generatedAt={po.generatedAt} />

      {/* POS-001 Mission Control — live widgets from /api/platform/operations */}
      <MissionControlBoard initial={ops} />

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {kpiCards.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{k.label}</span>
              <span className={`w-7 h-7 rounded-lg ${k.iconBg} flex items-center justify-center text-sm shrink-0`}>{k.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(k as any).muted ? "text-gray-400" : (k as any).tone ?? "text-gray-900"}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Services · Tenants · Workspaces */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Platform Services" href="/super-admin/platform-ops" linkLabel="All services" badge={`${servicesSummary.total} registered`}>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Services", servicesSummary.total], ["Core", servicesSummary.core], ["Optional", servicesSummary.optional]].map(([l, n]) => (
              <div key={l as string} className="rounded-lg border border-gray-100 py-2.5 text-center"><p className="text-xl font-bold text-gray-900 tabular-nums">{n as number}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {services.map(s => (
              <div key={s.code} className="flex items-center justify-between text-xs">
                <span className="text-gray-600 truncate">{s.name}</span>
                <span className={`inline-flex items-center gap-1 shrink-0 ${s.core ? "text-green-600" : "text-gray-400"}`}><span className={`w-1.5 h-1.5 rounded-full ${s.core ? "bg-green-500" : "bg-gray-300"}`} />{s.core ? "Core" : "Optional"}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-50">Live per-service health (CPU, latency, errors) activates with the monitoring agent.</p>
        </Panel>

        <Panel title="Tenant Summary" href="/super-admin/platform-ops/tenants" linkLabel="View all tenants">
          {tenantSummary.total === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No tenants registered.</p> : (
            <Donut segments={(tenantSummary.byPlan.length ? tenantSummary.byPlan : tenantSummary.byStatus).slice(0, 6)} total={tenantSummary.total} label="Total" />
          )}
        </Panel>

        <Panel title="Workspace Summary" href="/super-admin/platform-ops/workspaces" linkLabel="View all workspaces">
          {workspaceSummary.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No workspace users yet.</p> : (
            <div className="space-y-2">
              {workspaceSummary.slice(0, 7).map(w => (
                <div key={w.name}>
                  <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-700">{w.name}</span><span className="text-gray-500 tabular-nums">{fmt(w.users)} <span className="text-gray-300">· {w.pct}%</span></span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.min(w.pct, 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Activity · Deployments · Resource usage */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Platform Activity" href="/super-admin/audit" linkLabel="View all">
          {!activityReady || activity.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{activityReady ? "No recorded activity yet." : "Activity feed activates with the audit log."}</p> : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {activity.slice(0, 8).map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5"><span className="text-sm mt-0.5">{a.icon}</span>
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{a.title}</p>{a.detail && <p className="text-[10px] text-gray-400 truncate capitalize">{a.detail}</p>}</div>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{relTime(a.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Platform Deployments">
          <div className="py-6 text-center">
            <p className="text-2xl mb-1">🚀</p>
            <p className="text-sm text-gray-500">Current platform version <span className="font-semibold text-gray-800">v{version}</span> · release channel <span className="font-medium">Stable</span>.</p>
            <p className="text-[11px] text-gray-400 mt-2">Deployment history &amp; release status activate when the deploy pipeline is connected.</p>
          </div>
        </Panel>

        <Panel title="Top Resource Usage">
          <div className="py-6 text-center">
            <p className="text-2xl mb-1">📊</p>
            <p className="text-sm text-gray-500">CPU, memory, storage and compute metering are not yet connected.</p>
            <p className="text-[11px] text-gray-400 mt-2">Live resource telemetry activates with the monitoring agent (Module 6).</p>
          </div>
        </Panel>
      </div>

      {/* Quick actions */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
          {quickActions.map(a => (
            <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 py-3 px-2 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
              <span className="text-lg">{a.icon}</span><span className="text-[11px] font-semibold text-gray-700 leading-tight">{a.label}</span><span className="text-[9px] text-gray-400 leading-tight">{a.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Module directory */}
      <Panel title="Platform Operations — 6 modules">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {modules.map(m => {
            const Wrap: any = m.live ? Link : "div";
            return (
              <Wrap key={m.n} {...(m.live ? { href: m.href } : {})} className={`flex items-start gap-3 rounded-lg border border-gray-100 p-4 ${m.live ? "hover:border-teal-300 hover:bg-teal-50/30 transition-colors" : ""}`}>
                <span className="w-9 h-9 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-base shrink-0">{m.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="text-[10px] font-bold text-gray-400">{m.n}</span><span className="text-sm font-semibold text-gray-900">{m.label}</span>{!m.live && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium">Next phase</span>}</div>
                  <p className="text-[11px] text-gray-500 mt-0.5">{m.desc}</p>
                </div>
              </Wrap>
            );
          })}
        </div>
      </Panel>

      <p className="text-[11px] text-gray-400 pb-4">Platform Operations is the SaaS control room — tenants, plans, subscriptions, feature flags, workspaces and activity are live from the platform control-plane. Infrastructure telemetry (request rates, storage, per-service health, deployments, resource usage) shows honest “not monitored” states until the monitoring agent and deploy pipeline are connected. The six module workspaces land in the next phases.</p>
    </div>
  );
}
