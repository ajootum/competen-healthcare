import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadSecurityAudit } from "@/lib/super-admin/sys-audit";
import LogExplorer from "./LogExplorer";

export const dynamic = "force-dynamic";

// Security Intelligence & Audit (SYS-001.6) — the final module of the System &
// Security Platform. A trusted, searchable record of security activity: event
// KPIs, category analytics, top identities, the critical/high stream, a log
// explorer and rule-derived AI insights. Built on the real immutable trails;
// retention config and tamper-evidence show honest states (SYS-002 AC-02).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const CAT_COLOR: Record<string, string> = { Authentication: "bg-blue-500", Authorization: "bg-violet-500", "Admin Actions": "bg-amber-500", "Data Access": "bg-rose-500", System: "bg-gray-400" };

export default async function SecurityIntelligenceAudit() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadSecurityAudit(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Total Audit Events", value: dash(k.totalEvents), icon: "🗒️", iconBg: "bg-blue-50" },
    { label: "Events (24h)", value: dash(k.events24h), icon: "📊", iconBg: "bg-teal-50" },
    { label: "Events (7d)", value: dash(k.events7d), icon: "📈", iconBg: "bg-violet-50" },
    { label: "High-Risk (24h)", value: dash(k.highRisk24), icon: "⚠️", iconBg: "bg-rose-50", tone: (k.highRisk24 ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Landlord Events", value: dash(k.landlordEvents), icon: "🛰️", iconBg: "bg-sky-50" },
    { label: "AI Requests Logged", value: dash(k.aiEvents), icon: "🤖", iconBg: "bg-indigo-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/system" className="hover:text-teal-700">System &amp; Security</Link><span>/</span><span className="text-gray-600">Security Intelligence &amp; Audit</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Security Intelligence &amp; Audit</h1>
        <p className="text-sm text-gray-500">A trusted, searchable and attributable record of security-relevant activity.</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Event categories */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Event Categories <span className="text-[10px] text-gray-400">recent</span></h2>
          {d.categories.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No events.</p> : (
            <div className="space-y-2.5">
              {d.categories.map((c: any) => (
                <div key={c.label}>
                  <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{c.label}</span><span className="tabular-nums text-gray-500">{fmt(c.n)} · {c.pct}%</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${CAT_COLOR[c.label] ?? "bg-gray-400"}`} style={{ width: `${c.pct}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top identities by activity */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Top Identities by Activity</h2>
          {d.topActors.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No attributed activity.</p> : (
            <div className="space-y-2">
              {d.topActors.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0">{(a.name ?? "?").slice(0, 1).toUpperCase()}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{a.name}</span>
                  <span className="text-xs font-bold text-gray-900 tabular-nums shrink-0">{fmt(a.n)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Privileged-access concentration is worth periodic review.</p>
        </div>

        {/* Critical / high-risk stream */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">High-Risk Event Stream</h2>
          {d.highRisk.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">✅ No high-risk events.</p> : (
            <div className="divide-y divide-gray-50">
              {d.highRisk.map((e: any, i: number) => (
                <div key={i} className="flex items-start gap-2 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-800 leading-tight capitalize truncate">{(e.action ?? "").replace(/_/g, " ")}{e.entity ? ` · ${e.entity}` : ""}</p><p className="text-[9px] text-gray-400">{e.actor ?? "system"} · {relTime(e.at)}</p></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Log explorer (real client-side filter) */}
      <LogExplorer events={d.explorer} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AI security insights */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Security Insights <span className="text-[10px] text-gray-400">rule-derived from live events</span></h2>
          <div className="space-y-2">
            {d.insights.map((s: string, i: number) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5">
                <span className="text-base shrink-0">💡</span>
                <span className="text-sm text-gray-700">{s}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Derived from real event counts and clearly distinguished from verified facts. Behavioural anomaly detection and AI-generated summaries linked to source events are a later phase.</p>
        </div>

        {/* Audit integrity & retention */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Integrity &amp; Retention</h2>
          <div className="space-y-1.5">
            {d.integrity.map((it: any) => (
              <div key={it.label} className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-700 shrink-0">{it.label}</span>
                <span className={`text-[10px] font-medium text-right ${it.on === true ? "text-green-600" : it.on === false ? "text-rose-500" : "text-gray-400"}`}>{it.value}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Landlord severity: {fmt(d.severity.info)} info · {fmt(d.severity.warning)} warning · {fmt(d.severity.critical)} critical.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Security Intelligence &amp; Audit completes the System &amp; Security Platform. It reads the real immutable trails — the app-wide audit log, the landlord-plane trail (actor, IP, reason) and system telemetry — into event KPIs, category analytics, top-identity activity, a high-risk stream, an instant log explorer and rule-derived insights. Tamper-evident hash-chaining, configurable retention by event class, packaged evidence export and behavioural anomaly detection are shown as honest gaps rather than fabricated, per SYS-002 AC-02.</p>
    </div>
  );
}
