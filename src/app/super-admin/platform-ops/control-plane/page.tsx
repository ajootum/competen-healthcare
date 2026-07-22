import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadControlPlane } from "@/lib/platform/control-plane";
import { loadRuntimeStatus } from "@/lib/platform/runtime";
import InfraStatusBar from "./InfraStatusBar";
import RecordDeployment from "./RecordDeployment";

export const dynamic = "force-dynamic";

// Platform Control Plane (POP-001 §1) — super-admin operational overview:
// environment/runtime, release, regions, feature flags, identity & provisioning,
// a live platform map, and a launcher into the granular control-plane sections.
// Live plat_* data; honest states where infra isn't recorded yet.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };

function Panel({ title, href, linkLabel, badge, children }: { title: string; href?: string; linkLabel?: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">{title}{badge && <span className="ml-2 text-[10px] font-medium text-gray-400">{badge}</span>}</h2>
        {href && <Link href={href} className="text-xs text-teal-700 hover:underline shrink-0">{linkLabel ?? "Manage"} →</Link>}
      </div>
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0 text-sm"><span className="text-gray-500">{label}</span><span className="text-gray-800 text-right font-medium">{value ?? <span className="text-gray-300">—</span>}</span></div>;
}

const SECTIONS = [
  { label: "Tenants", icon: "🏢", href: "/platform/control-plane/tenants" },
  { label: "Provisioning", icon: "🌱", href: "/platform/control-plane/provisioning" },
  { label: "Subscriptions", icon: "💳", href: "/platform/control-plane/subscriptions" },
  { label: "Billing", icon: "🧾", href: "/platform/control-plane/billing" },
  { label: "Products", icon: "⚙️", href: "/platform/control-plane/products" },
  { label: "Feature Flags", icon: "🎚️", href: "/platform/control-plane/feature-flags" },
  { label: "Identity", icon: "🔐", href: "/platform/control-plane/identity" },
  { label: "Deployments", icon: "🚀", href: "/platform/control-plane/deployments" },
  { label: "Events", icon: "📻", href: "/platform/control-plane/events" },
  { label: "Audit", icon: "📜", href: "/platform/control-plane/audit" },
];

export default async function ControlPlaneConsole() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const [cp, runtime] = await Promise.all([loadControlPlane(admin), loadRuntimeStatus(admin)]);
  const { environment: env, release, map, regions, products, productsSummary, featureFlags, identity, events, eventsReady } = cp;

  const healthTone = cp.health === "Operational" ? "text-green-600" : "text-rose-600";
  const healthBg = cp.health === "Operational" ? "bg-green-50" : "bg-rose-50";

  const kpis = [
    { label: "Control Plane", value: cp.health, icon: cp.health === "Operational" ? "💚" : "🛑", iconBg: healthBg, tone: healthTone, sub: env.dbOk ? "database reachable" : "database unreachable" },
    { label: "Runtime", value: env.runtime, icon: "🧭", iconBg: "bg-violet-50", sub: `app v${env.appVersion}` },
    { label: "DB Latency", value: env.dbLatencyMs == null ? "—" : `${env.dbLatencyMs} ms`, icon: "⏱️", iconBg: "bg-sky-50", sub: "round-trip" },
    { label: "Regions", value: cp.regionsReady ? regions.length : "—", icon: "🌍", iconBg: "bg-teal-50", sub: cp.regionsReady ? `${regions.filter((r: any) => r.is_active).length} active` : "not recorded", muted: !cp.regionsReady },
    { label: "Feature Flags", value: featureFlags.ready ? featureFlags.total : "—", icon: "🎚️", iconBg: "bg-amber-50", sub: featureFlags.ready ? `${featureFlags.onByDefault} on by default` : "not ready", muted: !featureFlags.ready },
    { label: "Releases", value: release.recorded ? release.count : "—", icon: "🚀", iconBg: "bg-rose-50", sub: release.recorded ? `on ${release.channel}` : "none recorded", muted: !release.recorded },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Control Plane</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Platform Control Plane</h1>
        <p className="text-sm text-gray-500">Environment, infrastructure, releases and the platform map — the operational core.</p>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{k.label}</span>
              <span className={`w-7 h-7 rounded-lg ${k.iconBg} flex items-center justify-center text-sm shrink-0`}>{k.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums capitalize ${(k as any).muted ? "text-gray-400" : (k as any).tone ?? "text-gray-900"}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* POS-002 Infrastructure Status Bar — live from /api/runtime/* */}
      <InfraStatusBar initial={runtime} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Environment & runtime */}
        <Panel title="Environment & Runtime">
          <Row label="Runtime" value={<span className="capitalize">{env.runtime}</span>} />
          <Row label="App version" value={`v${env.appVersion}`} />
          <Row label="Region" value={env.vercelRegion} />
          <Row label="Database" value={<span className={env.dbOk ? "text-green-600" : "text-rose-600"}>{env.dbOk ? `reachable · ${env.dbLatencyMs} ms` : "unreachable"}</span>} />
          <Row label="Supabase host" value={<span className="font-mono text-[11px]">{env.supabaseHost}</span>} />
        </Panel>

        {/* Release & deployments */}
        <Panel title="Release & Deployments" href="/platform/control-plane/deployments" badge={release.recorded ? `${release.count} recorded` : undefined}>
          {!release.recorded ? (
            <div className="py-4 text-center">
              <p className="text-sm text-gray-500">Current build <span className="font-semibold text-gray-800">v{env.appVersion}</span> · <span className="capitalize">{release.channel}</span> channel.</p>
              <p className="text-[11px] text-gray-400 mt-2">Deployment history activates when releases are recorded to the pipeline.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {release.recent.map((d: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-800 font-medium tabular-nums">v{d.version}</span>
                  <span className="flex items-center gap-2"><span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">{d.channel}</span><span className="text-[10px] text-gray-400">{relTime(d.released_at ?? d.created_at)}</span></span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 pt-2 border-t border-gray-50 flex justify-end">
            <RecordDeployment version={env.appVersion} />
          </div>
        </Panel>

        {/* Feature flags & services */}
        <Panel title="Feature Flags & Services" href="/platform/control-plane/feature-flags">
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Flags", featureFlags.ready ? featureFlags.total : "—"], ["Overrides", featureFlags.ready ? featureFlags.assignments : "—"], ["Services", productsSummary.total]].map(([l, n]) => (
              <div key={l as string} className="rounded-lg border border-gray-100 py-2.5 text-center"><p className="text-xl font-bold text-gray-900 tabular-nums">{n as any}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {products.slice(0, 8).map((p: any) => (
              <div key={p.code} className="flex items-center justify-between text-xs">
                <span className="text-gray-600 truncate">{p.name}</span>
                <span className={`shrink-0 ${p.is_core ? "text-green-600" : "text-gray-400"}`}>{p.is_core ? "Core" : "Optional"}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Platform map */}
      <Panel title="Platform Map" badge="live counts">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { plane: "Platform / Landlord", accent: "#2563eb", rows: [["Tenants", map.tenants], ["Plans", map.plans], ["Products / services", map.products], ["Feature flags", map.featureFlags]] },
            { plane: "Tenant Organisations", accent: "#0d9488", rows: [["Organisations", map.organisations], ["Facilities", map.facilities], ["Users", map.users]] },
            { plane: "Workspaces", accent: "#7c3aed", rows: [["Total workspaces", map.workspaces], ["Identity providers", identity.idpConfigs], ["Org templates", identity.templates]] },
          ].map(col => (
            <div key={col.plane} className="rounded-lg border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: col.accent }} /><h3 className="text-sm font-semibold text-gray-800">{col.plane}</h3></div>
              {col.rows.map(([l, n]) => <Row key={l as string} label={l as string} value={n == null ? <span className="text-gray-300">—</span> : (n as number).toLocaleString()} />)}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Regions */}
        <Panel title="Regions & Residency" badge={cp.regionsReady ? `${regions.length}` : undefined}>
          {!cp.regionsReady || regions.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">{cp.regionsReady ? "No regions configured." : "Region registry not available."}</p> : (
            <div className="space-y-2">
              {regions.map((r: any) => (
                <div key={r.code} className="flex items-center justify-between text-sm">
                  <div><span className="text-gray-800 font-medium">{r.name}</span> <span className="text-[10px] text-gray-400 font-mono">{r.code}</span><p className="text-[10px] text-gray-400">{r.hosting_provider ?? "—"}{r.residency_policy ? ` · ${r.residency_policy}` : ""}</p></div>
                  <span className={`text-[10px] shrink-0 ${r.is_active ? "text-green-600" : "text-gray-400"}`}>{r.is_active ? "active" : "inactive"}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Platform events */}
        <Panel title="Platform Events" href="/platform/control-plane/events" badge={cp.events24h != null ? `${cp.events24h} in 24h` : undefined}>
          {!eventsReady || events.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">{eventsReady ? "No platform events recorded." : "Event stream not available."}</p> : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {events.slice(0, 10).map((e: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 min-w-0"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${e.severity === "critical" ? "bg-rose-500" : e.severity === "warning" ? "bg-amber-500" : "bg-gray-300"}`} /><span className="text-gray-700 truncate">{e.event_type}</span></span>
                  <span className="text-[10px] text-gray-400 shrink-0">{relTime(e.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Identity & provisioning */}
        <Panel title="Identity & Provisioning">
          <Row label="Identity providers" value={identity.idpConfigs == null ? null : `${identity.idpConfigs} active`} />
          <Row label="Provisioning templates" value={identity.templates == null ? null : identity.templates} />
          <Row label="Data residency" value={cp.regionsReady ? `${regions.length} regions` : null} />
          <div className="flex gap-2 mt-3">
            <Link href="/platform/control-plane/identity" className="flex-1 text-center text-xs font-medium border border-gray-200 rounded-lg py-1.5 text-gray-600 hover:bg-gray-50">Identity →</Link>
            <Link href="/platform/control-plane/provisioning" className="flex-1 text-center text-xs font-medium border border-gray-200 rounded-lg py-1.5 text-gray-600 hover:bg-gray-50">Provisioning →</Link>
          </div>
        </Panel>
      </div>

      {/* Control-plane sections launcher */}
      <Panel title="Control Plane Sections">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {SECTIONS.map(s => (
            <Link key={s.href} href={s.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 py-3 px-2 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
              <span className="text-lg">{s.icon}</span><span className="text-[11px] font-semibold text-gray-700">{s.label}</span>
            </Link>
          ))}
        </div>
      </Panel>

      <p className="text-[11px] text-gray-400 pb-4">The Control Plane console surfaces live platform state — environment, database reachability, releases, regions, feature flags, identity and provisioning — and a map of the platform, tenant and workspace planes with live counts. Deep infrastructure telemetry and deployment history show honest states until recorded. The granular management surfaces live under the platform control-plane sections above.</p>
    </div>
  );
}
