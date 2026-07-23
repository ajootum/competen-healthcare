import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadSoc } from "@/lib/super-admin/sys-soc";
import SocConsole from "./SocConsole";

export const dynamic = "force-dynamic";

// Security Operations Center (SYS-001.3) — detect, triage and respond. Real
// analytics from the security audit trail, live incidents (escalations + safety
// alerts), the cybersecurity risk register as the vulnerability view, a posture
// score from measurable facts, and controlled containment. Threat map, IDS, geo
// and CVE feeds show honest "not monitored" states (SYS-002 AC-02).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const postureTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 85 ? "text-green-600" : n >= 60 ? "text-amber-600" : "text-rose-600");
const SEV_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700", emergency: "bg-rose-50 text-rose-700", high: "bg-orange-50 text-orange-700", medium: "bg-amber-50 text-amber-700", low: "bg-gray-100 text-gray-600" };
const BAND_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-orange-50 text-orange-700", medium: "bg-amber-50 text-amber-700", low: "bg-green-50 text-green-700" };
const THREAT_TONE: Record<string, string> = { Low: "bg-green-50 text-green-700", Elevated: "bg-amber-50 text-amber-700", High: "bg-rose-50 text-rose-700", Unknown: "bg-gray-100 text-gray-500" };

export default async function SecurityOperationsCenter() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadSoc(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Security Posture", value: k.postureScore == null ? "—" : `${k.postureScore}/100`, icon: "🛡️", iconBg: "bg-violet-50", tone: postureTone(k.postureScore) },
    { label: "Open Incidents", value: dash(k.openIncidents), icon: "🚨", iconBg: "bg-rose-50", tone: (k.openIncidents ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Critical Incidents", value: dash(k.criticalIncidents), icon: "🔴", iconBg: "bg-rose-50", tone: (k.criticalIncidents ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Security Events (24h)", value: dash(k.securityEvents24h), icon: "📊", iconBg: "bg-blue-50" },
    { label: "Containment (24h)", value: dash(k.containment24h), icon: "⛔", iconBg: "bg-orange-50" },
    { label: "High Vulnerabilities", value: dash(k.highVulns), icon: "🐞", iconBg: "bg-amber-50", tone: (k.highVulns ?? 0) > 0 ? "text-amber-600" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/super-admin/system" className="hover:text-teal-700">System &amp; Security</Link><span>/</span><span className="text-gray-600">Security Operations Center</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Security Operations Center</h1>
          <p className="text-sm text-gray-500">Detect, triage, investigate and contain security threats across the platform.</p>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${THREAT_TONE[k.threatLevel] ?? "bg-gray-100 text-gray-500"}`}>Threat level: {k.threatLevel}</span>
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

      {/* Real containment console */}
      <SocConsole users={d.pickers.users} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active incidents */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Active Incidents</h2>
            <Link href="/super-admin/platform-ops/monitoring" className="text-xs text-teal-700 hover:underline">Monitoring →</Link>
          </div>
          {d.incidents.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">✅ No active security incidents.</p> : (
            <div className="divide-y divide-gray-50">
              {d.incidents.map((i: any) => (
                <div key={i.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 leading-tight truncate">{i.title}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{String(i.kind).replace(/_/g, " ")} · {relTime(i.at)}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 capitalize ${SEV_TONE[String(i.severity).toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>{i.severity}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Attack categories */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Event Categories <span className="text-[10px] text-gray-400">24h</span></h2>
          {d.categories.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No security events in 24h.</p> : (
            <div className="space-y-2">
              {d.categories.map((c: any) => (
                <div key={c.label}>
                  <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{c.label}</span><span className="tabular-nums text-gray-500">{c.n}</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-rose-400 rounded-full" style={{ width: `${(c.n / Math.max(1, ...d.categories.map((x: any) => x.n))) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Security event trend */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Security Event Trend <span className="text-[10px] text-gray-400">last 7 days · from audit trail</span></h2>
          <div className="flex items-end gap-2 h-28">
            {d.trend.map((t: any) => (
              <div key={t.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-rose-100 rounded-t relative" style={{ height: `${(t.n / d.trendMax) * 100}%`, minHeight: t.n > 0 ? "4px" : "0" }}>
                  <div className="absolute inset-x-0 -top-4 text-[9px] text-gray-500 text-center tabular-nums">{t.n || ""}</div>
                </div>
                <span className="text-[9px] text-gray-400">{t.day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Vulnerabilities (cybersecurity risk register) */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Vulnerabilities</h2>
            <Link href="/super-admin/governance/risk" className="text-xs text-teal-700 hover:underline">Risk register →</Link>
          </div>
          {!d.risksReady ? <p className="text-xs text-gray-400 py-4 text-center">Risk register not enabled (migration 060).</p> : d.vulnerabilities.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No open cybersecurity risks.</p> : (
            <div className="space-y-2">
              {d.vulnerabilities.map((v: any) => (
                <div key={v.id} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums ${BAND_TONE[v.band]}`}>{v.score}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{v.title}</span>
                  <span className="text-[9px] text-gray-400 capitalize shrink-0">{String(v.status).replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">Sourced from the cybersecurity-category risk register. CVE scanning &amp; patch status are a later phase.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent security events */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Recent Security Events</h2>
            <Link href="/super-admin/audit" className="text-xs text-teal-700 hover:underline">Full audit →</Link>
          </div>
          {d.recent.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No security events.</p> : (
            <div className="divide-y divide-gray-50">
              {d.recent.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 shrink-0">{e.category}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{e.entity || (e.action ?? "").replace(/_/g, " ")}{e.actor ? ` · ${e.actor}` : ""}</span>
                  <span className="text-[10px] text-gray-400 shrink-0 w-14 text-right">{relTime(e.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Not monitored (honest) */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Detection Coverage</h2>
          <div className="space-y-1.5 mb-3">
            {[["Audit-trail analytics", true], ["Incident correlation", true], ["Account containment", true], ["Posture scoring", true]].map(([l]: any) => (
              <div key={l} className="flex items-center justify-between text-xs"><span className="text-gray-600">{l}</span><span className="text-[10px] font-semibold text-green-600">live</span></div>
            ))}
          </div>
          <div className="space-y-1.5 pt-2 border-t border-gray-50">
            {d.notMonitored.map((l: string) => (
              <div key={l} className="flex items-center justify-between text-xs"><span className="text-gray-500">{l}</span><span className="text-[10px] font-medium text-gray-400">not monitored</span></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Login geography and MFA are handled by the auth provider; threat feeds and SIEM integration are a later phase — shown honestly rather than faked.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The SOC runs on real signals: the security-relevant slice of the immutable audit trail (classified into categories and trended), live incidents from escalations and safety alerts, the cybersecurity risk register as the exposure view, and a posture score computed only from measurable facts. Containment is a real, human-approved, reversible auth ban. Threat mapping, intrusion detection, geolocation and CVE feeds show honest “not monitored” states until those data sources exist (SYS-002 AC-02).</p>
    </div>
  );
}
