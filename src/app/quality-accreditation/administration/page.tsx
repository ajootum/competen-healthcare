import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Bars, Table, Foot } from "../_ui";
import { loadAdministration } from "@/lib/qaw/administration";
import Link from "next/link";

export const dynamic = "force-dynamic";

// QAW-013 Quality Configuration, Rules & Administration — no-code admin over the real config substrate.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Standards Config", "Scoring Models", "Workflow & Rules", "Forms & Data Model", "Dashboards & Reports", "Alerts", "User Roles", "Integrations", "Retention"];
const RISK_TONE: Record<string, string> = { high: "rose", medium: "amber", low: "emerald" };
const ST_TONE: Record<string, string> = { draft: "slate", in_review: "amber", pending_approval: "violet", approved: "blue", published: "emerald", rolled_back: "rose", cancelled: "slate" };
const AREAS = [
  { icon: "🎯", label: "Standards & Criteria", desc: "Frameworks, standards, criteria", href: "/quality-accreditation/standards" },
  { icon: "🧮", label: "Scoring Models & Thresholds", desc: "Weights, bands, targets", href: "/super-admin/platform-ops/configuration" },
  { icon: "🔀", label: "Workflow & Business Rules", desc: "Routing, conditions, rules", href: "/super-admin/platform-ops/configuration" },
  { icon: "📝", label: "Forms & Data Model", desc: "Fields, validations, lists", href: "/super-admin/platform-ops/configuration" },
  { icon: "📊", label: "Dashboards & Reports", desc: "Widgets, KPIs, reports", href: "/quality-accreditation/analytics" },
  { icon: "🔔", label: "Alerts & Notifications", desc: "Triggers, recipients, escalation", href: "/super-admin/platform-ops/configuration" },
  { icon: "👥", label: "User Roles & Permissions", desc: "Roles, data visibility, SoD", href: "/super-admin" },
  { icon: "🔌", label: "Integrations & Data Mapping", desc: "Connections, field mapping", href: "/super-admin/platform-ops" },
  { icon: "🗄️", label: "Retention & Archival", desc: "Retention, legal hold", href: "/quality-accreditation/audit-trail" },
  { icon: "🛡️", label: "Configuration Governance", desc: "Approval, versioning, rollback", href: "/super-admin/platform-ops/configuration" },
  { icon: "⚙️", label: "System Administration", desc: "Tenant settings, feature flags", href: "/super-admin/system" },
];

export default async function AdministrationPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadAdministration(admin, hid, isSuper);
  const head = <Head code="QAW-013 · Quality & Accreditation" title="Quality Configuration, Rules & Administration" sub="No-code configuration, rules, workflows and operational controls for the entire quality workspace." action={{ label: "Configuration engine →", href: "/super-admin/platform-ops/configuration" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The configuration store (<code>adm_config_items</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🧩" tone="teal" label="Config items" value={k.configItems} sub={`${k.activeConfig} active`} />
        <Stat icon="📝" tone="blue" label="Forms & registers" value={k.forms} />
        <Stat icon="🤖" tone="violet" label="Automations" value={k.automations} sub="active" />
        <Stat icon="🕓" tone="amber" label="Pending changes" value={k.pending} />
        <Stat icon="🚀" tone="emerald" label="Published changes" value={k.published} />
        <Stat icon="🗂️" tone="indigo" label="Configurable objects" value={k.registryTotal.toLocaleString()} sub="platform catalogue" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Configuration by type">
          {d.byType.length ? <div className="flex items-center gap-2"><Donut segments={d.byType} total={k.configItems} label="Config items" size={130} /><Legend items={d.byType.slice(0, 7).map((x: any) => ({ label: x.label, value: x.value, tone: x.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No config items yet.</p>}
        </Card>

        <Card title="Change control status">
          <Bars items={d.changeStatus.filter((s: any) => s.value > 0).map((s: any) => ({ label: s.label, pct: (k.pending + k.published) ? Math.round((s.value / Math.max(1, d.changeStatus.reduce((a: number, x: any) => a + x.value, 0))) * 100) : 0, tone: s.tone, value: s.value }))} />
          <p className="text-[10px] text-gray-400 mt-2">Every configuration change flows draft → review → approval → publish, with rollback — governed and versioned.</p>
        </Card>

        <Card title="Change risk">
          {d.changeRisk.some((r: any) => r.value) ? <div className="flex items-center gap-2"><Donut segments={d.changeRisk} total={d.changeRisk.reduce((a: number, r: any) => a + r.value, 0)} label="Changes" size={120} /><Legend items={d.changeRisk.filter((r: any) => r.value).map((r: any) => ({ label: r.label, value: r.value, tone: r.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No changes logged.</p>}
        </Card>
      </div>

      <Card title="Configuration areas" right="no-code">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {AREAS.map((a, i) => (
            <Link key={i} href={a.href} className="flex items-start gap-2.5 border border-gray-200 rounded-xl p-3 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
              <span className="text-lg shrink-0">{a.icon}</span>
              <span className="min-w-0"><span className="block text-[12.5px] font-medium text-gray-800 leading-tight">{a.label}</span><span className="block text-[10.5px] text-gray-400 leading-tight mt-0.5">{a.desc}</span></span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recent configuration changes" className="xl:col-span-2">
          <Table cols={["Code", "Change", "Type", "Version", "Risk", "Status"]} rows={d.recentChanges.map((c: any) => [
            <span key="c" className="font-mono text-[11px] text-gray-400">{c.code ?? "—"}</span>,
            <span key="t" className="font-medium text-gray-800">{c.title}</span>,
            <span key="ty" className="text-gray-500 capitalize">{c.type}</span>,
            <span key="v" className="text-gray-400 tabular-nums">{c.version ?? "—"}</span>,
            <Pill key="r" text={c.risk} tone={RISK_TONE[c.risk] ?? "slate"} />,
            <Pill key="s" text={(c.status ?? "").replace(/_/g, " ")} tone={ST_TONE[c.status] ?? "slate"} />,
          ])} empty="No configuration changes recorded." />
        </Card>

        <Card title="Automations">
          {d.automations.length ? <div className="space-y-2">{d.automations.map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px]"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.status === "active" ? "bg-[var(--cmp-color-success)]" : "bg-[var(--cmp-color-warning)]"}`} /><span className="text-gray-800 truncate flex-1">{a.name}</span><span className="text-gray-400 tabular-nums">{a.runs} runs</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No automations configured.</p>}
          <p className="text-[10px] text-gray-400 mt-3">Registry catalogue: {d.registryByClass.map((r: any) => `${r.label} ${r.value}`).join(" · ") || "—"}.</p>
        </Card>
      </div>

      <Foot>QAW-013 — live over the real configuration substrate: <code>adm_config_items</code> / <code>adm_changes</code> / <code>adm_automations</code> / <code>adm_forms</code> plus the platform <code>configuration_registry_objects</code> catalogue. Config inventory, change-control status/risk and the governed change register are real and tenant-scoped. Visual authoring (rule / workflow / form / scoring designers) runs through the platform <Link href="/super-admin/platform-ops/configuration" className="text-teal-600 hover:underline">Configuration Engine</Link>; deep in-workspace designers are the next build phase.</Foot>
    </div>
  );
}
