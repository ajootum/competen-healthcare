import Link from "next/link";
import { loadConfigRules } from "@/lib/operations/ops-config-rules";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, Pill, OpsFoot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-010 Operations Configuration & Rules — honest config surface over the WCE workspace_config_overrides + the
// built-in operational thresholds the OPC modules apply. Dark surface. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NEXT_PHASE = [["Workflow Rules", "Rule builder & lifecycle"], ["Automations", "Event-driven actions"], ["Conflict Detection", "Overlapping-rule analysis"], ["Approvals", "Change review & sign-off"]];
const CONFIG_LINKS = [["WCE Designer", "No-code workspace configuration", "/super-admin/platform-ops/configuration"], ["Patient Ops Config", "POS thresholds & rules", "/unit-manager/patient-operations/governance"], ["Workforce Config", "Staffing rules & establishment", "/unit-manager/workforce-management/configuration"], ["Quality Config", "Safety & incident settings", "/unit-manager/quality"]];

export default async function ConfigRulesPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadConfigRules(admin) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const k = d.kpis;
  return (
    <div className="space-y-3">
      <TopStrip code="UMW-OPC-010 · Operational Command" title="Operations Configuration & Rules" departments={departments} />
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Operations Configuration & Rules" meta={d.provisioned ? "WCE config engine" : "config engine not provisioned"} />

        {/* KPI ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Config Overrides" value={k.total} sub="workspace_config_overrides" />
          <Kpi label="Published" value={k.published} sub="live" tone="text-emerald-400" />
          <Kpi label="Draft" value={k.draft} sub="pending publish" tone={k.draft ? "text-amber-400" : "text-white"} />
          <Kpi label="UMW Overrides" value={k.umw} sub="unit-manager scope" />
          <Kpi label="Scopes in Use" value={k.scopes} sub="platform→user" />
          <Kpi label="Active Areas" value={k.areas} sub="config domains" />
        </div>

        {/* Config areas + thresholds */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <Card title="Configuration Areas" right={<span className="text-[9px] text-slate-500">WCE-resolved</span>}>
            <div className="space-y-1.5 text-[11px]">
              {d.configAreas.map((a: any) => (
                <div key={a.label} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${a.active ? "bg-[var(--cmp-color-success)]" : "bg-slate-600"}`} /><span className="text-slate-300 flex-1 truncate">{a.label}</span><span className="text-white tabular-nums">{a.overrides} override{a.overrides === 1 ? "" : "s"}</span><Pill text={a.active ? "configured" : "default"} tone={a.active ? "emerald" : "slate"} /></div>
              ))}
            </div>
            <p className="text-[9px] text-slate-500 mt-2">Areas with 0 overrides run on platform defaults.</p>
          </Card>

          <Card title="Operational Threshold Overview" right={<span className="text-[9px] text-slate-500">built-in · read-only</span>}>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center text-[9px] text-slate-500 uppercase tracking-wide"><span className="flex-1">Metric</span><span className="w-16 text-right">Amber</span><span className="w-16 text-right">Red</span><span className="w-24 text-right">Applied</span></div>
              {d.thresholds.map((t: any) => (
                <div key={t.metric} className="flex items-center"><span className="text-slate-300 flex-1 truncate">{t.metric}</span><span className="w-16 text-right text-amber-400 tabular-nums">{t.amber}</span><span className="w-16 text-right text-rose-400 tabular-nums">{t.red}</span><span className="w-24 text-right text-slate-500 text-[9px]">{t.applied}</span></div>
              ))}
            </div>
            <p className="text-[9px] text-slate-500 mt-2">These are the thresholds the OPC modules apply today. Making them tenant-configurable is part of the rules engine (next-phase).</p>
          </Card>
        </div>

        {/* Registry + config links + next-phase */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <Card title="Config Override Registry" right={<span className="text-[9px] text-slate-500">live rows</span>}>
            {d.registry.length ? <div className="space-y-1.5 text-[11px]">{d.registry.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-2 py-1.5"><span className="text-slate-300 flex-1 truncate font-mono text-[10px]">{r.path}</span><Pill text={r.scope} tone="blue" /><Pill text={r.state} tone={r.state === "published" ? "emerald" : "amber"} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-6 text-center">No config overrides — everything on platform defaults.</p>}
          </Card>

          <Card title="Configuration Surfaces">
            <div className="space-y-1.5">{CONFIG_LINKS.map(([name, desc, href]) => (
              <Link key={name} href={href} className="flex items-center gap-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/50 px-2.5 py-2"><div className="min-w-0 flex-1"><p className="text-[11px] text-slate-200 leading-tight">{name}</p><p className="text-[9px] text-slate-500 truncate">{desc}</p></div><span className="text-blue-400 text-[11px]">→</span></Link>
            ))}</div>
          </Card>

          <Card title="Rules Engine" right={<span className="text-[9px] text-slate-500">next-phase</span>}>
            <div className="space-y-2">{NEXT_PHASE.map(([name, desc]) => (
              <div key={name} className="flex items-start gap-2 rounded-lg bg-slate-800/30 border border-slate-700/40 px-2.5 py-2 opacity-80"><span className="text-slate-500 text-sm shrink-0">⚙️</span><div className="min-w-0"><p className="text-[11px] text-slate-300 leading-tight">{name}</p><p className="text-[9px] text-slate-500">{desc}</p></div><span className="text-[8px] font-bold uppercase tracking-wider bg-slate-700 text-slate-400 rounded px-1 py-0.5 self-center">soon</span></div>
            ))}</div>
            <p className="text-[9px] text-slate-500 mt-2">A dedicated operational-rules store (op_rules / thresholds / automations) is required before these go live — deliberately not faked.</p>
          </Card>
        </div>
      </div>

      <OpsFoot>UMW-OPC-010 — configuration surface over the real WCE workspace_config_overrides (the no-code config engine) plus the built-in operational thresholds the OPC modules apply. There is no operational-rules data store yet, so workflow rules, automations, conflict detection and approvals are surfaced as next-phase rather than fabricated. Authoring lives in the WCE Designer / UMW-CFG. Read-only manager lens.</OpsFoot>
    </div>
  );
}
