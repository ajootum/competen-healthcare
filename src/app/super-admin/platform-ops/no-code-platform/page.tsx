import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRegistry } from "@/lib/config/registry";
import { loadGovernance } from "@/lib/config/governance";
import { loadCatalogue } from "@/lib/config/catalogue";

export const dynamic = "force-dynamic";

// No-Code Configuration Platform (NCP-000) — Platform Foundation & Architecture (Volume I). The umbrella
// surface for the metadata-driven no-code platform: it formalises the NCP-000 architecture and ties the
// already-built WCE-001..005 configuration services under it, mapping every core component + roadmap phase to
// its REAL implementation status (live → the WCE module, partial, or honest next-phase). KPIs are pulled live
// from the registry / governance / catalogue services. Super-admin gated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const ST: Record<string, { label: string; cls: string; dot: string }> = {
  live: { label: "Live", cls: "bg-emerald-50 text-emerald-700 border-emerald-100", dot: "bg-emerald-500" },
  partial: { label: "Partial", cls: "bg-amber-50 text-amber-700 border-amber-100", dot: "bg-amber-500" },
  next: { label: "Next-phase", cls: "bg-gray-50 text-gray-500 border-gray-100", dot: "bg-gray-300" },
};
function Badge({ s }: { s: string }) { const t = ST[s]; return <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 border ${t.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />{t.label}</span>; }
function Stat({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

// The 18 core platform components (§4) mapped to their real implementation.
const COMPONENTS: { name: string; status: string; via?: string; href?: string }[] = [
  { name: "Configuration Registry", status: "live", via: "WCE-002", href: "/super-admin/platform-ops/registry" },
  { name: "Metadata Repository", status: "live", via: "WCE-002 store", href: "/super-admin/platform-ops/registry" },
  { name: "Runtime Rendering Engine", status: "partial", via: "config overrides", href: "/super-admin/platform-ops/configuration" },
  { name: "Workspace Builder", status: "live", via: "WCE-001", href: "/super-admin/platform-ops/configuration" },
  { name: "Module Builder", status: "live", via: "WCE-005", href: "/super-admin/platform-ops/catalogue" },
  { name: "Dashboard Builder", status: "partial", via: "Workspaces", href: "/super-admin/platform-ops/workspaces" },
  { name: "Widget Builder", status: "live", via: "WCE-005", href: "/super-admin/platform-ops/catalogue" },
  { name: "Form Builder", status: "next" },
  { name: "Workflow Builder", status: "next" },
  { name: "Business Rules Engine", status: "next" },
  { name: "AI Configuration Studio", status: "partial", via: "AI Gateway", href: "/super-admin/platform-ops/ai-gateway" },
  { name: "Reporting Studio", status: "next" },
  { name: "Navigation Builder", status: "partial", via: "Workspaces", href: "/super-admin/platform-ops/workspaces" },
  { name: "Theme Designer", status: "partial", via: "Workspaces", href: "/super-admin/platform-ops/workspaces" },
  { name: "Publishing Pipeline", status: "live", via: "WCE-004", href: "/super-admin/platform-ops/governance" },
  { name: "Sandbox", status: "next" },
  { name: "Dependency Graph Service", status: "live", via: "NCP", href: "/super-admin/platform-ops/dependencies" },
  { name: "Marketplace", status: "next" },
  { name: "Configuration SDK", status: "next" },
  { name: "Version Control", status: "live", via: "WCE-004", href: "/super-admin/platform-ops/governance" },
  { name: "Audit & Security", status: "live", via: "WCE-004", href: "/super-admin/platform-ops/governance" },
];
// The detailed builder specs (NCP-001..011) — Phase 3 "Builders", each mapped to its build status.
const BUILDERS: { code: string; name: string; status: string; href?: string; via?: string }[] = [
  { code: "NCP-001", name: "Page & Layout Composer", status: "live", href: "/super-admin/platform-ops/pages" },
  { code: "NCP-002", name: "Widget Builder", status: "partial", via: "WCE-005", href: "/super-admin/platform-ops/catalogue" },
  { code: "NCP-003", name: "Form & Data-Capture Builder", status: "live", href: "/super-admin/platform-ops/forms" },
  { code: "NCP-004", name: "Workflow & Automation Builder", status: "live", href: "/super-admin/platform-ops/workflows" },
  { code: "NCP-005", name: "Metrics & Indicator Builder", status: "live", href: "/super-admin/platform-ops/metrics" },
  { code: "NCP-006", name: "Report & Dashboard Builder", status: "live", href: "/super-admin/platform-ops/reports" },
  { code: "NCP-007", name: "Rules & Decision Engine", status: "live", href: "/super-admin/platform-ops/rules" },
  { code: "NCP-008", name: "Role, Permission & Visibility Designer", status: "live", href: "/super-admin/platform-ops/permissions" },
  { code: "NCP-009", name: "Navigation & Experience Designer", status: "next" },
  { code: "NCP-010", name: "Data Source & Integration Mapper", status: "live", href: "/super-admin/platform-ops/integration-mapper" },
  { code: "NCP-011", name: "Template, Package & Marketplace Manager", status: "next" },
];
const META_OBJECTS = ["Workspace", "Module", "Dashboard", "Widget", "Form", "Workflow", "Business Rule", "AI Assistant", "Navigation Item", "Theme", "Report"];
const INHERITANCE = ["Platform", "Enterprise", "Hospital", "Department", "Unit", "User"];
const LIFECYCLE = ["Draft", "Review", "Approved", "Published", "Active", "Archived"];
const ROADMAP: { n: number; capability: string; outcome: string; status: string }[] = [
  { n: 1, capability: "Metadata Registry", outcome: "Foundation", status: "live" },
  { n: 2, capability: "Runtime Engine", outcome: "Dynamic UI", status: "partial" },
  { n: 3, capability: "Builders", outcome: "Visual configuration", status: "partial" },
  { n: 4, capability: "Governance", outcome: "Publishing & versioning", status: "live" },
  { n: 5, capability: "Marketplace", outcome: "Reusable packages", status: "next" },
  { n: 6, capability: "SDK", outcome: "Partner extensions", status: "next" },
];
const PRINCIPLES = ["Metadata-first", "Configuration over customization", "Runtime composition", "Tenant isolation", "API-first", "Event-driven", "Auditability", "Extensibility", "Backward compatibility"];
// §6 Runtime flow — the login→render resolution sequence.
const RUNTIME_FLOW = ["Resolve tenant", "Resolve role(s)", "Resolve feature flags", "Build navigation", "Resolve workspace", "Load dashboards", "Resolve widgets", "Bind data sources", "Apply permissions", "Render interface", "Subscribe to live updates"];
// §8 Configuration APIs — the canonical /config/* contract mapped to the real endpoint (or next-phase).
const APIS: { method: string; endpoint: string; purpose: string; status: string; via?: string }[] = [
  { method: "GET", endpoint: "/config/workspaces", purpose: "Retrieve workspace metadata", status: "partial", via: "/api/platform/workspace-config" },
  { method: "POST", endpoint: "/config/publish", purpose: "Publish configuration", status: "live", via: "/api/governance/config" },
  { method: "GET", endpoint: "/config/widgets", purpose: "Retrieve widget definitions", status: "partial", via: "/api/registry" },
  { method: "POST", endpoint: "/config/validate", purpose: "Validate package", status: "partial", via: "governance classify" },
  { method: "POST", endpoint: "/config/import", purpose: "Import package", status: "next" },
  { method: "GET", endpoint: "/config/dependencies", purpose: "Dependency graph", status: "live", via: "/api/config/dependencies" },
];
// §10 Publishing pipeline — 11 stages; Draft/Review/Approval/Publish are live via WCE-004.
const PIPELINE: { stage: string; status: string }[] = [
  { stage: "Draft", status: "live" }, { stage: "Validation", status: "partial" }, { stage: "Dependency Analysis", status: "live" },
  { stage: "Review", status: "live" }, { stage: "Approval", status: "live" }, { stage: "Package Build", status: "next" },
  { stage: "Sandbox Test", status: "next" }, { stage: "Publish", status: "live" }, { stage: "Cache Refresh", status: "partial" },
  { stage: "Runtime Event Broadcast", status: "next" }, { stage: "Monitoring", status: "partial" },
];
// §11 Performance targets (targets, not measured).
const PERF: [string, string][] = [["Dashboard load", "< 2 s"], ["Widget render", "< 500 ms"], ["Publish", "< 30 s"], ["Availability", "> 99.9%"], ["Rollback", "< 2 min"], ["Horizontal scaling", "Supported"]];

export default async function NoCodePlatform() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const [reg, gov, cat] = await Promise.all([
    loadRegistry(admin).catch(() => ({ provisioned: false })) as Promise<any>,
    loadGovernance(admin).catch(() => ({ provisioned: false })) as Promise<any>,
    loadCatalogue(admin).catch(() => ({ widgets: [] })) as Promise<any>,
  ]);
  const objectCount = reg?.provisioned ? (reg.objects?.length ?? 0) : null;
  const crCount = gov?.provisioned ? (gov.crs?.length ?? 0) : null;
  const widgets = cat?.widgets ?? [];
  const completeness = widgets.length ? Math.round(widgets.reduce((a: number, w: any) => a + (w.completeness ?? 0), 0) / widgets.length) : null;
  const liveCount = COMPONENTS.filter(c => c.status === "live").length;
  const partialCount = COMPONENTS.filter(c => c.status === "partial").length;

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span><span className="text-gray-700 font-medium">No-Code Configuration Platform</span>
      </div>

      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🧩</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">No-Code Configuration Platform <span className="text-gray-300 font-medium text-lg">(NCP-000)</span></h1>
          <p className="text-sm text-gray-500">Metadata-driven platform to configure workspaces, modules, widgets, forms, workflows, AI, reports, navigation, themes and rules — without changing application code. Volume I · Platform Foundation &amp; Architecture.</p>
        </div>
      </div>

      {/* Live KPIs from the configuration services */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Configurable Objects" value={objectCount ?? "—"} sub={objectCount == null ? "registry next-phase" : "in the registry (WCE-002)"} />
        <Stat label="Governed Change Requests" value={crCount ?? "—"} sub={crCount == null ? "governance next-phase" : "in the pipeline (WCE-004)"} />
        <Stat label="Catalogue Completeness" value={completeness == null ? "—" : `${completeness}%`} sub="widget config contracts (WCE-005)" />
        <Stat label="Platform Components Live" value={`${liveCount}/${COMPONENTS.length}`} sub={`${partialCount} partial · foundation established`} tone="text-emerald-600" />
      </div>

      {/* Core platform components → real status */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-1">Core Platform Components</h2>
        <p className="text-[11px] text-gray-400 mb-4">The core platform components (§4), each mapped to its live implementation, a partial capability, or an honest next-phase build.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {COMPONENTS.map(c => {
            const inner = (
              <div className={`flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-3 ${c.href ? "hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors" : ""}`}>
                <div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{c.name}</p>{c.via && <p className="text-[10px] text-gray-400">{c.via}</p>}</div>
                <Badge s={c.status} />
              </div>
            );
            return c.href ? <Link key={c.name} href={c.href}>{inner}</Link> : <div key={c.name}>{inner}</div>;
          })}
        </div>
      </div>

      {/* Detailed builders (NCP-001..011) */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-1">Configuration Builders <span className="text-gray-300 font-normal">(NCP-001..011)</span></h2>
        <p className="text-[11px] text-gray-400 mb-3">The Phase-3 no-code builders, each with a detailed spec — built in dependency order (data binding first).</p>
        <Link href="/super-admin/platform-ops/studio" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-700 bg-indigo-50 rounded-lg px-2.5 py-1 mb-4 hover:bg-indigo-100">🛠️ Author any of these as a governed object in the Configuration Studio →</Link>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {BUILDERS.map(b => {
            const inner = (
              <div className={`flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-3 ${b.href ? "hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors" : ""}`}>
                <div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{b.name}</p><p className="text-[10px] text-gray-400">{b.code}{b.via ? ` · ${b.via}` : ""}</p></div>
                <Badge s={b.status} />
              </div>
            );
            return b.href ? <Link key={b.code} href={b.href}>{inner}</Link> : <div key={b.code}>{inner}</div>;
          })}
        </div>
      </div>

      {/* §6 Runtime flow */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-1">Runtime Flow</h2>
        <p className="text-[11px] text-gray-400 mb-3">At login the runtime composes the interface from metadata — no hard-coded screens.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold bg-gray-900 text-white rounded px-2 py-1">Login</span>
          {RUNTIME_FLOW.map(s => <span key={s} className="flex items-center gap-1.5"><span className="text-gray-300 text-[10px]">→</span><span className="text-[11px] bg-indigo-50 text-indigo-700 rounded px-2 py-1">{s}</span></span>)}
        </div>
      </div>

      {/* Architecture: object model · inheritance · lifecycle */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Metadata Object Model</h2>
          <p className="text-[11px] text-gray-400 mb-3">Every object carries GUID, version, owner, tenant, lifecycle state, permissions, dependencies and audit metadata.</p>
          <div className="flex flex-wrap gap-1.5">{META_OBJECTS.map(o => <span key={o} className="text-[11px] bg-gray-50 border border-gray-100 rounded px-2 py-1 text-gray-600">{o}</span>)}</div>
        </div>
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Multi-Tenant Inheritance</h2>
          <p className="text-[11px] text-gray-400 mb-3">Objects may inherit, override, extend, disable or reset to parent defaults.</p>
          <div className="flex flex-col gap-1">{INHERITANCE.map((l, i) => <div key={l} className="flex items-center gap-2" style={{ paddingLeft: `${i * 10}px` }}><span className="text-gray-300 text-xs">{i ? "└" : "▸"}</span><span className="text-xs text-gray-700">{l}</span></div>)}</div>
        </div>
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Configuration Lifecycle</h2>
          <p className="text-[11px] text-gray-400 mb-3">Publishing validates dependencies, schema &amp; permissions and snapshots for rollback (WCE-004).</p>
          <div className="flex flex-wrap items-center gap-1">{LIFECYCLE.map((s, i) => <span key={s} className="flex items-center gap-1"><span className="text-[11px] bg-indigo-50 text-indigo-700 rounded px-2 py-0.5">{s}</span>{i < LIFECYCLE.length - 1 && <span className="text-gray-300 text-[10px]">→</span>}</span>)}</div>
        </div>
      </div>

      {/* §10 Publishing pipeline */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-1">Publishing Pipeline</h2>
        <p className="text-[11px] text-gray-400 mb-3">The eleven-stage publish path (§10). Draft, Review, Approval and Publish are governed live by WCE-004; the remaining stages are next-phase.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {PIPELINE.map((p, i) => <span key={p.stage} className="flex items-center gap-1.5">{i > 0 && <span className="text-gray-300 text-[10px]">→</span>}<span className={`inline-flex items-center gap-1 text-[11px] rounded px-2 py-1 border ${ST[p.status].cls}`}><span className={`w-1.5 h-1.5 rounded-full ${ST[p.status].dot}`} />{p.stage}</span></span>)}
        </div>
      </div>

      {/* Implementation roadmap → real status */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-4">Implementation Roadmap</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROADMAP.map(p => (
            <div key={p.n} className="rounded-lg border border-gray-100 p-3.5">
              <div className="flex items-center justify-between mb-1.5"><span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center">{p.n}</span><Badge s={p.status} /></div>
              <p className="text-sm font-semibold text-gray-800">{p.capability}</p>
              <p className="text-[11px] text-gray-400">{p.outcome}</p>
            </div>
          ))}
        </div>
      </div>

      {/* §8 APIs + §11 performance targets */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Configuration APIs</h2>
          <div className="space-y-1.5">
            {APIS.map(a => (
              <div key={a.endpoint} className="flex items-center gap-2 text-[11px]">
                <span className={`font-bold w-10 shrink-0 ${a.method === "GET" ? "text-sky-600" : "text-orange-600"}`}>{a.method}</span>
                <code className="text-gray-700 font-mono shrink-0">{a.endpoint}</code>
                <span className="text-gray-400 truncate hidden sm:inline">{a.purpose}{a.via ? ` · ${a.via}` : ""}</span>
                <span className="ml-auto shrink-0"><Badge s={a.status} /></span>
              </div>
            ))}
          </div>
        </div>
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Performance Targets</h2>
          <div className="space-y-1.5">{PERF.map(([m, t]) => <div key={m} className="flex items-center justify-between text-[11px]"><span className="text-gray-500">{m}</span><b className="tabular-nums text-gray-800">{t}</b></div>)}</div>
          <p className="text-[10px] text-gray-400 mt-2">Targets (§11) — not yet instrumented.</p>
        </div>
      </div>

      {/* Principles */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Architectural Principles</h2>
        <div className="flex flex-wrap gap-1.5">{PRINCIPLES.map(p => <span key={p} className="text-[11px] bg-indigo-50/60 text-indigo-700 rounded-full px-2.5 py-1">{p}</span>)}</div>
        <p className="text-[11px] text-gray-400 mt-3">Security: RBAC + ABAC, tenant isolation, immutable audit log, approval workflows and rollback snapshots — enforced by the WCE-004 governance service. Full encrypted-store + digital-signature publishing is next-phase.</p>
        <div className="mt-3 rounded-lg bg-indigo-50/60 border border-indigo-100 p-3"><p className="text-[11px] text-indigo-800"><b>Platform mandate (§13):</b> all future functional modules consume NCP configuration services rather than hard-coded implementations.</p></div>
      </div>
    </div>
  );
}
