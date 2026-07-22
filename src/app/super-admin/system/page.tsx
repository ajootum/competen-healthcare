import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadSystemPlatform } from "@/lib/super-admin/system";

export const dynamic = "force-dynamic";

// System & Security Platform (SYS-001) — module 1: the System Health Dashboard,
// the platform's operational command centre and landing page. Real telemetry
// only (SYS-002 AC-02): timed DB/table probes, live auth directory, real
// alerts, events and jobs. Uptime history, security scoring, CPU/memory and
// threat feeds are honest "—" until their telemetry exists.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const ACCENT: Record<number, string> = { 1: "bg-blue-100 text-blue-700", 2: "bg-violet-100 text-violet-700", 3: "bg-rose-100 text-rose-700", 4: "bg-teal-100 text-teal-700", 5: "bg-green-100 text-green-700", 6: "bg-indigo-100 text-indigo-700" };
const SVC_TONE: Record<string, string> = { operational: "bg-green-50 text-green-700", slow: "bg-amber-50 text-amber-700", degraded: "bg-rose-50 text-rose-700" };
const W_TONE: Record<string, string> = { ok: "bg-green-50 text-green-700", warn: "bg-amber-50 text-amber-700", down: "bg-rose-50 text-rose-700", na: "bg-gray-100 text-gray-400" };

export default async function SystemSecurityPlatform() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadSystemPlatform(admin);
  const k = d.kpis;

  const ribbon = [
    { label: "Platform Health", value: k.platformHealth == null ? "—" : `${k.platformHealth}%`, icon: "💚", tone: k.platformHealth != null && k.platformHealth >= 90 ? "text-green-600" : k.platformHealth == null ? "text-gray-400" : "text-amber-600" },
    { label: "Security Score", value: k.securityScore == null ? "—" : `${k.securityScore}/100`, icon: "🛡️", tone: "text-gray-400" },
    { label: "Active Users (24h)", value: dash(k.activeUsers24h), icon: "👤", tone: "text-gray-900" },
    { label: "System Uptime", value: k.uptime == null ? "—" : `${k.uptime}%`, icon: "🕓", tone: "text-gray-400" },
    { label: "Open Incidents", value: dash(k.openIncidents), icon: "🚨", tone: (k.openIncidents ?? 0) > 0 ? "text-rose-600" : "text-gray-900" },
    { label: "Critical Alerts", value: dash(k.criticalAlerts), icon: "⚠️", tone: (k.criticalAlerts ?? 0) > 0 ? "text-rose-600" : "text-gray-900" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">System &amp; Security Platform</h1>
          <p className="text-sm text-gray-500">Secure, resilient and high-performing platform operations across all environments and tenants.</p>
        </div>
        <span className="text-xs text-gray-400 tabular-nums">Updated {new Date(d.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {/* Executive KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {ribbon.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className="text-sm shrink-0">{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Six module panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {d.modules.map((mod: any) => (
          <Link key={mod.n} href={mod.href} className={`${card} p-5 hover:border-teal-300 hover:shadow-sm transition-all block`}>
            <div className="flex items-start gap-2.5 mb-3">
              <span className={`w-7 h-7 rounded-lg ${ACCENT[mod.n]} flex items-center justify-center text-sm font-bold shrink-0`}>{mod.n}</span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-900 leading-tight">{mod.name}</h2>
                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{mod.desc}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {mod.kpis.map((kk: any) => (
                <div key={kk.label} className="rounded-lg border border-gray-100 py-2 px-1 text-center">
                  <p className="text-sm font-bold text-gray-900 tabular-nums leading-none truncate">{kk.value}</p>
                  <p className="text-[8px] text-gray-500 mt-1 leading-tight">{kk.label}</p>
                </div>
              ))}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live system status (monitoring probes) */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Live System Status</h2>
            <span className="text-[10px] text-gray-400">{d.avgProbeMs != null ? `${d.avgProbeMs}ms avg probe` : ""}</span>
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
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Timed liveness probes against the live database — real round-trips, not synthetic uptime.</p>
        </div>

        {/* Runtime widgets */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Runtime</h2>
            <span className="text-[10px] text-gray-400">{d.runtime.environment.runtimeEnv ?? ""}</span>
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
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">“na” = capability not provisioned or history not surfaced — never fabricated.</p>
        </div>

        {/* Alerts & incidents */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Alerts &amp; Incidents</h2>
            <Link href="/super-admin/platform-ops/monitoring" className="text-xs text-teal-700 hover:underline">Monitoring →</Link>
          </div>
          {d.alerts.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">✅ No open alerts.</p> : (
            <div className="space-y-2">
              {d.alerts.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${["critical", "high", "emergency"].includes(String(a.severity ?? "").toLowerCase()) ? "bg-rose-500" : "bg-amber-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-800 leading-tight truncate">{a.summary ?? a.note ?? a.title ?? "Alert"}</p>
                    <p className="text-[9px] text-gray-400">{a.kind ?? a.escalation_type ?? a.category ?? ""} · {relTime(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Identity snapshot */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Identity Snapshot</h2>
            <Link href="/super-admin/users" className="text-xs text-teal-700 hover:underline">IAM →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[["Auth identities", d.auth.total], ["Active (7d)", d.auth.active7d], ["Suspended", d.auth.banned], ["SSO configs", d.identity.idpActive]].map(([l, n]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2.5 text-center"><p className="text-lg font-bold text-gray-900 tabular-nums">{dash(n)}</p><p className="text-[9px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400">Live from the Supabase Auth directory (real sign-in and ban state) — MFA enforcement and session inventory land with the IAM module.</p>
        </div>

        {/* Recent events */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Recent Platform Events <span className="text-[10px] text-gray-400">{dash(d.securityEvents24h)} security-relevant in 24h</span></h2>
            <Link href="/super-admin/audit" className="text-xs text-teal-700 hover:underline">Full audit →</Link>
          </div>
          {!d.eventsReady || d.events.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No events recorded.</p> : (
            <div className="divide-y divide-gray-50">
              {d.events.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  <span className="text-xs text-gray-700 flex-1 truncate">{e.entity_name || (e.action ?? e.event_type ?? "").replace(/_/g, " ")}</span>
                  <span className="text-[10px] text-gray-400 capitalize shrink-0">{(e.action ?? e.event_type ?? "").replace(/_/g, " ")}</span>
                  <span className="text-[10px] text-gray-400 shrink-0 w-16 text-right">{relTime(e.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The System Health Dashboard is module 1 of the System &amp; Security Platform. Everything shown is real telemetry (SYS-002 AC-02): timed database and table probes, the live Supabase Auth directory, actual alerts, events and job runs. Security scoring, uptime history, MFA enforcement, threat feeds, backup surfacing and RPO/RTO monitoring show honest “—” until their telemetry exists — modules 2–6 wire them phase by phase.</p>
    </div>
  );
}
