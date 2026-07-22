import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMonitoring } from "@/lib/platform/monitoring";
import { loadJobs } from "@/lib/platform/jobs";
import MonitoringHeader from "./MonitoringHeader";
import JobsPanel from "./JobsPanel";

export const dynamic = "force-dynamic";

// Monitoring & Operations (POP-001 §6) — live health probes, active alerts,
// event stream and operational jobs. Live data; telemetry the platform does not
// collect (CPU/memory, uptime history, backups) shows honest "not connected".
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };

const STATUS_DOT: Record<string, string> = { operational: "bg-green-500", slow: "bg-amber-500", degraded: "bg-orange-500", down: "bg-rose-500" };
const STATUS_TEXT: Record<string, string> = { operational: "text-green-600", slow: "text-amber-600", degraded: "text-orange-600", down: "text-rose-600" };
const TIER_STYLE: Record<string, { bar: string; chip: string }> = {
  critical: { bar: "bg-rose-500", chip: "bg-rose-50 text-rose-700" },
  high: { bar: "bg-orange-500", chip: "bg-orange-50 text-orange-700" },
  medium: { bar: "bg-amber-500", chip: "bg-amber-50 text-amber-700" },
  low: { bar: "bg-gray-300", chip: "bg-gray-100 text-gray-600" },
};

function Panel({ title, badge, href, linkLabel, children }: { title: string; badge?: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
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

export default async function MonitoringOperations() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const [m, jobs] = await Promise.all([loadMonitoring(admin), loadJobs(admin)]);
  const { kpis, services, servicesSummary, alerts, alertsSummary, events, eventsReady } = m;

  const healthTone = kpis.health === "Healthy" ? "text-green-600" : kpis.health === "Attention" ? "text-amber-600" : "text-rose-600";
  const healthBg = kpis.health === "Healthy" ? "bg-green-50" : kpis.health === "Attention" ? "bg-amber-50" : "bg-rose-50";
  const healthIcon = kpis.health === "Healthy" ? "💚" : kpis.health === "Attention" ? "⚠️" : "🛑";

  const kpiCards = [
    { label: "Overall Health", value: kpis.health, icon: healthIcon, iconBg: healthBg, sub: `${servicesSummary.operational}/${servicesSummary.total} subsystems responding`, tone: healthTone },
    { label: "Open Alerts", value: kpis.openAlerts == null ? "—" : kpis.openAlerts, icon: "🚨", iconBg: "bg-rose-50", sub: kpis.criticalAlerts ? `${kpis.criticalAlerts} critical` : "none critical", tone: kpis.openAlerts ? "text-rose-600" : undefined },
    { label: "Events (24h)", value: kpis.events24h == null ? "—" : kpis.events24h, icon: "📜", iconBg: "bg-sky-50", sub: "audit-log entries" },
    { label: "Avg Probe Latency", value: kpis.avgLatencyMs == null ? "—" : `${kpis.avgLatencyMs} ms`, icon: "⏱️", iconBg: "bg-violet-50", sub: "db round-trip" },
    { label: "Resource Telemetry", value: "—", icon: "📊", iconBg: "bg-teal-50", sub: "Not connected", muted: true },
    { label: "Backups", value: "—", icon: "💾", iconBg: "bg-gray-50", sub: "Not connected", muted: true },
  ];

  return (
    <div data-wide className="space-y-4">
      <MonitoringHeader generatedAt={m.generatedAt} />

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Service health */}
        <Panel title="Subsystem Health" badge={`${servicesSummary.operational}/${servicesSummary.total} up`}>
          <div className="space-y-1.5">
            {services.map(s => (
              <div key={s.key} className="flex items-center justify-between text-sm py-1">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s.status] ?? "bg-gray-300"}`} />
                  <span className="text-gray-700 truncate">{s.label}</span>
                  {s.core && <span className="text-[9px] text-gray-400 border border-gray-200 rounded px-1 shrink-0">core</span>}
                </span>
                <span className={`text-xs shrink-0 tabular-nums ${STATUS_TEXT[s.status] ?? "text-gray-500"}`}>
                  {s.status === "down" ? "down" : `${s.latencyMs} ms`}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Live reachability + round-trip latency per subsystem. Deep telemetry (CPU, memory, error rates) activates with the monitoring agent.</p>
        </Panel>

        {/* Active alerts */}
        <Panel title="Active Alerts" badge={alertsSummary.ready ? `${alertsSummary.total} open` : undefined} href="/supervisor/clinical-safety" linkLabel="Safety board">
          {!alertsSummary.ready ? <p className="text-sm text-gray-400 py-6 text-center">Alert sources unavailable.</p>
            : alerts.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">✅ No active alerts.</p> : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {alerts.slice(0, 12).map((a: any, i: number) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className={`w-1 self-stretch rounded-full ${TIER_STYLE[a.tier].bar}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{a.title}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{a.source} · {a.meta}</p>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${TIER_STYLE[a.tier].chip}`}>{a.tier}</span>
                      <span className="text-[10px] text-gray-400 mt-0.5">{relTime(a.at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          {alertsSummary.ready && alerts.length > 0 && (
            <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">{alertsSummary.escalations} escalation{alertsSummary.escalations === 1 ? "" : "s"} · {alertsSummary.safety} safety alert{alertsSummary.safety === 1 ? "" : "s"} across tenants.</p>
          )}
        </Panel>

        {/* Event stream */}
        <Panel title="Event Stream" href="/super-admin/audit" linkLabel="Audit log">
          {!eventsReady || events.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{eventsReady ? "No recorded events yet." : "Event log unavailable."}</p> : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto">
              {events.map((e: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="text-sm mt-0.5">{e.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate"><span className="capitalize">{e.action}</span>{e.subject && <span className="text-gray-500"> · {e.subject}</span>}</p>
                    <p className="text-[10px] text-gray-400 truncate">{e.plane}{e.actor ? ` · ${e.actor}` : ""}</p>
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{relTime(e.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* POS-001F Operational jobs — live registry + on-demand runs */}
      <JobsPanel initial={jobs} />

      <p className="text-[11px] text-gray-400 pb-4">Monitoring reflects live platform state — subsystem reachability and latency are probed on each load, alerts stream from tenant clinical-safety and escalation sources, and the event feed reads the platform + tenant audit logs. Infrastructure telemetry (CPU, memory, uptime history) and backup/job run history show honest “not connected” states until the monitoring agent and job runner are wired in.</p>
    </div>
  );
}
