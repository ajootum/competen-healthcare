import { loadAdmConfig } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Donut, Ring, Pill, HBar, Provision, Foot } from "../_ui";
import { STATUS_TONE } from "@/lib/admin/admin-suite";

export const dynamic = "force-dynamic";

// UMW-ADM-006 Unit Configuration & Customization Centre — no-code customization of workspace, dashboards, workflows,
// terminology, notifications, branding and integrations. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPE_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#14b8a6", "#ef4444", "#6366f1"];

export default async function ConfigurationPage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmConfig(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-006 · Administration & Configuration" title="Unit Configuration & Customization Centre" sub="Configure and personalize your unit workspace, workflows, terminology, integrations and user experience — no-code, governed by inheritance." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="006" /><Provision module="Configuration Centre" part="part 2" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="006" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={k.health} size={56} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">Config Health</p><p className="text-[11px] text-[var(--cmp-text-success)] font-medium">Good</p></div></div>
        <Kpi label="Active Configs" value={k.active} sub="live" />
        <Kpi label="Pending Changes" value={k.pending} sub="in review" tone={k.pending ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Kpi label="Published" value={k.published} sub="deployed" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Local Overrides" value={k.local} sub="unit-specific" />
        <Kpi label="Inherited" value={k.inherited} sub="from org" />
        <Kpi label="Total Items" value={k.total} sub="configurations" />
        <Kpi label="Override %" value={`${k.total ? Math.round((k.local / k.total) * 100) : 0}%`} sub="local vs total" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Configuration Overview">
          <div className="flex items-center gap-3">
            <Donut segs={d.byType.map((t: any, i: number) => ({ n: t.n, color: TYPE_COLORS[i % TYPE_COLORS.length] }))} total={k.total} centre={k.total} sub="items" size={100} />
            <div className="flex-1 space-y-0.5 text-[11px]">{d.byType.map((t: any, i: number) => <div key={t.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} /><span className="text-gray-600 flex-1 truncate">{t.label}</span><span className="font-semibold text-gray-900">{t.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Top Workflows" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by runs</span>}>
          {d.workflows.length ? <div className="space-y-1.5">{d.workflows.slice(0, 6).map((w: any) => (
            <div key={w.name} className="flex items-center gap-2 text-[12px]"><span className="text-gray-800 flex-1 truncate">{w.name}</span><Pill text={w.status} tone={STATUS_TONE[w.status]} /><span className="text-gray-400 tabular-nums w-16 text-right">{w.runs} runs</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No workflows.</p>}
        </Card>

        <Card title="Integration Status">
          {d.integrations.length ? <div className="space-y-2 text-[12px]">{d.integrations.map((i: any) => (
            <div key={i.name} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${i.status === "active" || i.status === "published" ? "bg-[var(--cmp-color-success)]" : i.status === "in_review" ? "bg-[var(--cmp-color-warning)]" : "bg-gray-400"}`} /><span className="text-gray-700 flex-1 truncate">{i.name}</span><Pill text={i.status === "active" || i.status === "published" ? "connected" : i.status} tone={i.status === "active" || i.status === "published" ? "emerald" : "amber"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No integrations.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Most Modified Areas">
          <div className="space-y-2">{d.byType.slice(0, 5).map((t: any, i: number) => <HBar key={t.label} label={t.label} value={t.n} max={Math.max(...d.byType.map((x: any) => x.n))} tone={TYPE_COLORS[i % TYPE_COLORS.length]} right={`${t.n}`} />)}</div>
        </Card>

        <Card title="Inheritance & Overrides">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-[var(--cmp-surface-information)] p-3"><p className="text-2xl font-bold text-blue-700 tabular-nums">{k.inherited}</p><p className="text-[10px] text-gray-500">Inherited from org</p></div>
            <div className="rounded-lg bg-[var(--cmp-surface-warning)] p-3"><p className="text-2xl font-bold text-[var(--cmp-text-warning)] tabular-nums">{k.local}</p><p className="text-[10px] text-gray-500">Local overrides</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Precedence: Platform → Enterprise → Organization → Unit → Role → User (WCE).</p>
        </Card>

        <Card title="Recent Changes">
          <div className="space-y-2">{d.recent.map((c: any) => (
            <div key={c.id} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-information)] shrink-0" /><span className="text-[12px] text-gray-800 flex-1 truncate">{c.name}</span><Pill text={c.status} tone={STATUS_TONE[c.status]} /></div>
          ))}</div>
        </Card>
      </div>

      <Foot>UMW-ADM-006 — configuration over adm_config_items (workspace / dashboards / workflows / terminology / notifications / integrations / branding). Item inventory, inherited-vs-local split and workflow runs are real; the live config editors + Draft→Validate→Publish→Rollback pipeline compose with the platform WCE (next phase).</Foot>
    </div>
  );
}
