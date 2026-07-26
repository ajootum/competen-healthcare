import { hexGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Bars, Table, Foot } from "../_ui";
import { loadExecAdministration } from "@/lib/hex/administration";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HEX-012 Executive Configuration & Administration — no-code admin over the real config substrate.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Workspaces", "Users & Roles", "Configuration", "Workflows", "Policies", "AI & Automation", "Templates", "Audit", "Integrations"];
const band = (n: number | null) => (n == null ? "" : n >= 90 ? "Excellent" : n >= 75 ? "Good" : n >= 60 ? "Fair" : "Needs attention");

export default async function ExecAdminPage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecAdministration(admin, hid, isSuper);
  const head = <Head code="HEX-012 · Hospital Executive" title="Executive Configuration & Administration" sub="Configure. Control. Govern. Optimize." action={{ label: "Configuration engine →", href: "/super-admin/platform-ops/configuration" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The configuration store (<code>adm_*</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat icon="🩺" tone={k.configHealth != null && k.configHealth >= 90 ? "emerald" : "amber"} label="Config health score" value={k.configHealth != null ? k.configHealth : "—"} sub={band(k.configHealth)} />
        <Stat icon="🏢" tone="blue" label="Active workspaces" value={k.activeWorkspaces} />
        <Stat icon="👥" tone="teal" label="Active users" value={k.activeUsers} />
        <Stat icon="📜" tone="indigo" label="Policies active" value={k.policies} />
        <Stat icon="🔀" tone="violet" label="Workflows" value={k.workflows} />
        <Stat icon="📊" tone="emerald" label="Dashboards & widgets" value={k.dashboards} />
        <Stat icon="🕓" tone="amber" label="Pending approvals" value={k.pendingApprovals} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Configuration overview" right={`${k.registryTotal.toLocaleString()} objects`}>
          {d.overviewDonut.length ? <div className="flex items-center gap-2"><Donut segments={d.overviewDonut} total={k.registryTotal} label="Config items" size={130} /><Legend items={d.overviewDonut.map((x: any) => ({ label: x.label, value: x.value, tone: x.tone, pct: k.registryTotal ? Math.round((x.value / k.registryTotal) * 100) : 0 }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">Configuration registry empty.</p>}
        </Card>

        <Card title="Recent configuration changes">
          <Table cols={["Change", "Type", "Risk", "Status"]} rows={d.recentChanges.map((c: any) => [
            <span key="t" className="font-medium text-gray-800 truncate block max-w-[160px]">{c.title}</span>,
            <span key="ty" className="text-gray-500 capitalize">{c.type}</span>,
            <Pill key="r" text={c.risk} tone={c.riskTone} />,
            <Pill key="s" text={(c.status ?? "").replace(/_/g, " ")} tone={c.statusTone} />,
          ])} empty="No changes recorded." />
        </Card>

        <Card title="Pending approvals" right={`${k.pendingApprovals}`}>
          <Table cols={["Item", "Type", "Risk"]} rows={d.pending.map((c: any) => [
            <span key="t" className="text-gray-800 truncate block max-w-[170px]">{c.title}</span>,
            <span key="ty" className="text-gray-500 capitalize">{c.type}</span>,
            <Pill key="r" text={c.risk} tone={c.riskTone} />,
          ])} empty="Nothing awaiting approval. ✅" />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Workspace status">
          <Table cols={["Workspace", "Status"]} rows={d.workspaces.map((w: any) => [
            <span key="n" className="font-medium text-gray-800">{w.name}</span>,
            <Pill key="s" text={(w.status ?? "").replace(/_/g, " ")} tone={["active", "published"].includes(w.status) ? "emerald" : w.status === "draft" ? "amber" : "slate"} />,
          ])} empty="No workspaces in the registry." />
        </Card>

        <Card title="Role distribution">
          {d.roleDist.length ? <div className="flex items-center gap-2"><Donut segments={d.roleDist} total={k.activeUsers} label="Users" size={120} /><Legend items={d.roleDist.slice(0, 6).map((r: any) => ({ label: r.label, value: r.value, tone: r.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No role data.</p>}
        </Card>

        <Card title="System health" right="data-backed">
          <Bars items={d.health.map((h: any) => ({ label: h.label, pct: h.pct, value: `${h.pct}%` }))} />
          <p className="text-[10px] text-gray-400 mt-2">Derived from the live config substrate (coverage, governance, automation, forms) — infrastructure service telemetry is a platform-ops concern, surfaced in <Link href="/super-admin/system" className="text-teal-600 hover:underline">System & Security</Link>.</p>
        </Card>
      </div>

      <Foot>HEX-012 — live over the real no-code configuration substrate: <code>adm_config_items</code> / <code>adm_changes</code> / <code>adm_automations</code> / <code>adm_forms</code> (<code>fetchAdmin</code>) plus the platform <code>configuration_registry_objects</code> catalogue, user/role distribution from real profiles. Config health and system-health bars are transparent data-backed composites (not fabricated infra metrics). Per HEX-000 §14, authoring reuses the platform <Link href="/super-admin/platform-ops/configuration" className="text-teal-600 hover:underline">Configuration Engine</Link> rather than a bespoke editor.</Foot>
    </div>
  );
}
