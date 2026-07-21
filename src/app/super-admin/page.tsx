import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMissionControl } from "@/lib/super-admin/mission-control";
import MissionControlHeader from "./_mc/MissionControlHeader";
import EnterpriseExplorer from "./_mc/EnterpriseExplorer";
import Sparkline from "./_mc/Sparkline";

export const dynamic = "force-dynamic";

// Competen Mission Control (MC-001) — the executive operational command centre.
// Read-heavy, action-enabled. Every figure is live platform data; capabilities
// the platform does not yet hold are shown as honest "activates when provisioned"
// states rather than fabricated metrics, and every action links to a real surface.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();

const relTime = (iso?: string | null) => {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

function KpiCard({ icon, iconBg, label, value, sub, muted, spark, sparkColor, tone }: {
  icon: string; iconBg: string; label: string; value: string; sub: string; muted?: boolean; spark?: number[]; sparkColor?: string; tone?: string;
}) {
  return (
    <div className={`${card} p-4 flex flex-col`}>
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold text-gray-500">{label}</span>
        <span className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center text-sm shrink-0`}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold mt-1.5 tabular-nums ${muted ? "text-gray-400" : tone ?? "text-gray-900"}`}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{sub}</p>
      <div className="mt-2 -mb-1">
        {muted ? <div className="h-7 flex items-center"><span className="text-[9px] text-gray-300">Not yet provisioned</span></div> : <Sparkline data={spark ?? []} color={sparkColor ?? "#14b8a6"} />}
      </div>
    </div>
  );
}

function Panel({ title, href, linkLabel, children, className = "" }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`${card} p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">{title}</h2>
        {href && <Link href={href} className="text-xs text-teal-700 hover:underline shrink-0">{linkLabel ?? "View all"} →</Link>}
      </div>
      {children}
    </div>
  );
}

const TONE_TEXT: Record<string, string> = { amber: "text-amber-600", orange: "text-orange-600", rose: "text-rose-600", red: "text-red-600", violet: "text-violet-600", teal: "text-teal-600", indigo: "text-indigo-600" };

export default async function MissionControl() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const mc = await loadMissionControl(admin);
  const { kpis, spark, ops, explorer, unassignedFacilities, missionStatus, activity, activityReady, workspaces, totalUsers, onboarding, health, changedToday, systemAlerts, timeline, counts } = mc;

  const kpiCards = [
    { icon: "💚", iconBg: "bg-green-50", label: "Platform Health", value: kpis.platformHealth.status, sub: kpis.platformHealth.note, tone: "text-green-600", spark: [] as number[], sparkColor: "#16a34a" },
    { icon: "🛡️", iconBg: "bg-red-50", label: "Critical Alerts", value: fmt(kpis.criticalAlerts), sub: kpis.criticalAlerts ? "Needs attention" : "All clear", tone: kpis.criticalAlerts ? "text-red-600" : "text-gray-900", spark: [] as number[], sparkColor: "#ef4444" },
    { icon: "🏛️", iconBg: "bg-violet-50", label: "Enterprise Tenants", value: fmt(kpis.tenants), sub: `${counts.countries} countr${counts.countries === 1 ? "y" : "ies"}`, spark: spark.tenants, sparkColor: "#8b5cf6" },
    { icon: "👥", iconBg: "bg-blue-50", label: "Active Users", value: fmt(kpis.activeUsers), sub: "across all tenants", spark: spark.users, sparkColor: "#3b82f6" },
    { icon: "🧠", iconBg: "bg-purple-50", label: "AI Operations", value: "Standby", sub: "No serving layer provisioned", muted: true },
    { icon: "📋", iconBg: "bg-amber-50", label: "Pending Approvals", value: kpis.pendingApprovals == null ? "—" : fmt(kpis.pendingApprovals), sub: kpis.pendingApprovals == null ? "Governance module not active" : "governance change requests", tone: "text-amber-600", spark: spark.approvals, sparkColor: "#f59e0b", muted: kpis.pendingApprovals == null },
    { icon: "🚀", iconBg: "bg-sky-50", label: "Deployments Today", value: "—", sub: "No deploy ledger provisioned", muted: true },
    { icon: "🗄️", iconBg: "bg-teal-50", label: "Background Jobs", value: "Standby", sub: "No worker queue provisioned", muted: true },
  ];

  const healthy = health.services.filter(s => s.monitored && s.status === "healthy").length;
  const monitored = health.services.filter(s => s.monitored).length;

  const quickActions = [
    { label: "Create Organisation", icon: "🏛️", href: "/super-admin/organisations" },
    { label: "Add Facility", icon: "🏥", href: "/super-admin/hospitals" },
    { label: "Import Users", icon: "📥", href: "/super-admin/import" },
    { label: "Publish Assessment", icon: "📋", href: "/super-admin/content" },
    { label: "Build CPU", icon: "🧩", href: "/super-admin/studio" },
    { label: "Knowledge Graph", icon: "🕸️", href: "/super-admin/knowledge-graph" },
    { label: "Audit Log", icon: "🗒️", href: "/super-admin/audit" },
    { label: "Platform Settings", icon: "⚙️", href: "/super-admin/settings" },
  ];

  const alertTone: Record<string, string> = { critical: "bg-red-50 text-red-700 border-red-100", warning: "bg-amber-50 text-amber-700 border-amber-100", info: "bg-blue-50 text-blue-700 border-blue-100" };

  return (
    <div data-wide className="space-y-4">
      <MissionControlHeader generatedAt={mc.generatedAt} />

      {/* 1) Executive KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map(k => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* 2) Operations ribbon */}
      <div className={`${card} px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm`}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Operations Region</span>
          <span className="text-[11px] font-semibold text-green-700 bg-green-50 rounded px-2 py-0.5">Production</span>
        </div>
        {[
          { l: "Platform Version", v: ops.version },
          { l: "Release Channel", v: ops.releaseChannel },
          { l: "Last Deployment", v: ops.lastDeployment ? relTime(ops.lastDeployment) : "Not tracked", muted: !ops.lastDeployment },
          { l: "Last Backup", v: ops.lastBackup ? relTime(ops.lastBackup) : "Not tracked", muted: !ops.lastBackup },
        ].map(x => (
          <div key={x.l} className="flex flex-col">
            <span className="text-[10px] text-gray-400">{x.l}</span>
            <span className={`text-sm font-semibold ${x.muted ? "text-gray-400" : "text-gray-800"}`}>{x.v}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 ml-auto">
          {[
            { l: "Database", ok: true }, { l: "Redis", ok: null }, { l: "Queue", ok: null }, { l: "Search", ok: null },
          ].map(s => (
            <span key={s.l} className="inline-flex items-center gap-1.5 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${s.ok === true ? "bg-green-500" : "bg-gray-300"}`} />
              <span className={s.ok === true ? "text-gray-600" : "text-gray-400"}>{s.l}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 3) Explorer · Mission Status · Activity · AI Ops */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <Panel title="Enterprise Explorer" href="/super-admin/organisations" linkLabel="Full structure">
          <EnterpriseExplorer orgs={explorer} unassigned={unassignedFacilities} />
        </Panel>

        <Panel title="Mission Status" href="/super-admin/command-centre" linkLabel="All issues">
          <div className="space-y-1">
            {missionStatus.map(m => (
              <Link key={m.key} href={m.href} className="flex items-center justify-between gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 group">
                <span className="text-sm text-gray-600 group-hover:text-gray-900">{m.label}</span>
                {m.n == null
                  ? <span className="text-[10px] text-gray-300 shrink-0">n/a</span>
                  : <span className={`text-sm font-bold tabular-nums shrink-0 ${m.n ? TONE_TEXT[m.tone] ?? "text-gray-900" : "text-gray-300"}`}>{m.n}</span>}
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Platform Activity" href="/super-admin/audit" linkLabel="View all">
          {!activityReady || activity.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">{activityReady ? "No recorded activity yet." : "Activity feed activates with the audit log."}</p>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto">
              {activity.slice(0, 10).map((a, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="text-sm mt-0.5">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{a.title}</p>
                    {a.detail && <p className="text-[10px] text-gray-400 truncate capitalize">{a.detail}</p>}
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{relTime(a.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="AI Operations Centre" href="/super-admin/assistant" linkLabel="AI tools">
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Running", 0], ["Queued", 0], ["Models", 0]].map(([l, n]) => (
              <div key={l as string} className="text-center rounded-lg border border-gray-100 py-2.5">
                <p className="text-xl font-bold text-gray-300 tabular-nums">{n as number}</p>
                <p className="text-[10px] text-gray-400">{l}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-purple-50/50 border border-purple-100 px-3 py-2.5">
            <p className="text-[11px] text-purple-800/80 leading-relaxed">Model status, inference metrics and queue monitoring activate once the AI serving layer is provisioned. No models are currently registered.</p>
          </div>
        </Panel>
      </div>

      {/* 4) Workspace Operations · Onboarding · Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Workspace Operations" href="/super-admin/users" linkLabel="All users" className="lg:col-span-1">
          <div className="space-y-2.5">
            {workspaces.map(w => {
              const pct = Math.round((w.users / totalUsers) * 100);
              return (
                <div key={w.role}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-2 text-gray-700"><span>{w.icon}</span>{w.name}</span>
                    <span className="tabular-nums text-gray-500">{fmt(w.users)} <span className="text-gray-300 text-xs">· {pct}%</span></span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                </div>
              );
            })}
            <p className="text-[10px] text-gray-400 pt-1">Active users per workspace role · platform v{ops.version}</p>
          </div>
        </Panel>

        <Panel title="Enterprise Onboarding Pipeline" href="/super-admin/organisations" linkLabel="View all" className="lg:col-span-1">
          <div className="flex items-center justify-between gap-1">
            {[
              { l: "Organisations", n: onboarding.orgsInProgress, s: "in progress", icon: "🏛️" },
              { l: "Facilities", n: onboarding.facilitiesPending, s: "pending setup", icon: "🏥" },
              { l: "Users", n: onboarding.usersImportedToday, s: "imported today", icon: "👤" },
              { l: "Admin Review", n: onboarding.adminReview, s: "in review", icon: "🔍" },
              { l: "Ready", n: onboarding.readyToLaunch, s: "to launch", icon: "🚀" },
            ].map((st, i, arr) => (
              <div key={st.l} className="flex-1 flex items-center gap-1">
                <div className="flex-1 text-center">
                  <div className="w-9 h-9 mx-auto rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-base">{st.icon}</div>
                  <p className="text-lg font-bold text-gray-900 tabular-nums mt-1">{st.n}</p>
                  <p className="text-[9px] text-gray-500 leading-tight">{st.l}</p>
                  <p className="text-[8px] text-gray-400 leading-tight">{st.s}</p>
                </div>
                {i < arr.length - 1 && <span className="text-gray-200 text-xs">→</span>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Platform Health Overview" href="/super-admin/command-centre" linkLabel="All services" className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0">
              <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="4" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#14b8a6" strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={`${(healthy / Math.max(monitored, 1)) * 97.4} 97.4`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-gray-900 tabular-nums">{healthy}/{monitored}</span>
                <span className="text-[9px] text-gray-400">healthy</span>
              </div>
            </div>
            <div className="flex-1 space-y-1.5">
              {health.services.map(s => {
                const dot = s.status === "healthy" ? "bg-green-500" : s.status === "degraded" ? "bg-amber-500" : "bg-gray-300";
                const txt = s.status === "healthy" ? "text-green-600 font-medium" : s.status === "degraded" ? "text-amber-600 font-medium" : "text-gray-400";
                const label = s.status === "healthy" ? "Healthy" : s.status === "degraded" ? "Degraded" : "Not monitored";
                return (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{s.name}
                    </span>
                    <span className={txt}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>
      </div>

      {/* 5) What's Changed · Timeline · System Alerts · Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <Panel title="What's Changed Today" href="/super-admin/audit" linkLabel="Change log">
          {changedToday.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No platform changes recorded today.</p>
          ) : (
            <div className="space-y-2">
              {changedToday.map(c => (
                <div key={c.label} className="flex items-center gap-2.5 text-sm">
                  <span className="text-base">{c.icon}</span>
                  <span className="flex-1 text-gray-600">{c.label}</span>
                  <span className="font-bold tabular-nums text-gray-900">{c.n}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Operations Timeline" href="/super-admin/audit" linkLabel="Full timeline">
          {timeline.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No platform milestones yet.</p>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto">
              {timeline.map((e, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="text-sm mt-0.5">{e.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{e.title}</p>
                    <p className="text-[10px] text-gray-400 truncate">{e.detail}</p>
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{relTime(e.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="System Alerts" href="/super-admin/command-centre" linkLabel="All alerts">
          {systemAlerts.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-2xl mb-1">✅</p>
              <p className="text-sm text-gray-400">No active alerts — all clear.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {systemAlerts.map((a, i) => (
                <div key={i} className={`rounded-lg border px-3 py-2 ${alertTone[a.level]}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold uppercase tracking-wide">{a.level}</span>
                    <span className="text-sm font-medium">{a.title}</span>
                  </div>
                  <p className="text-[11px] opacity-80 mt-0.5">{a.detail}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Quick Actions">
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map(a => (
              <Link key={a.label} href={a.href}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-100 py-3 hover:border-teal-300 hover:bg-teal-50/40 transition-colors text-center">
                <span className="text-lg">{a.icon}</span>
                <span className="text-[11px] font-medium text-gray-600 leading-tight">{a.label}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <p className="text-[11px] text-gray-400 pt-1 pb-4">
        Mission Control aggregates live data across the platform. Panels marked “not provisioned / not monitored” activate when their underlying module (AI serving, deploy pipeline, background workers, service-health probes) is connected — figures shown are real platform records only.
      </p>
    </div>
  );
}
