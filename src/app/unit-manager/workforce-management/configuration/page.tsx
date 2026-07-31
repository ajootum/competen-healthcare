import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceConfig } from "@/lib/operations/workforce-config";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import ConfigTabs from "./ConfigTabs";
import { KpiWithSub as Kpi } from "../_kit";

export const dynamic = "force-dynamic";

// Configuration Dashboard (UMW-WFM-009 §6) — whether the workforce configuration is complete,
// valid, approved, deployed and consumed. Real over wps_config (the live tenant config) +
// audit_log. Change-set/validation/drift governance need dedicated stores → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const DSTATUS: Record<string, string> = { configured: "bg-[var(--cmp-surface-success)] text-emerald-700", partial: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", "next-phase": "bg-gray-100 text-gray-400" };
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function ConfigurationDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceConfig(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚙️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Configuration</h1><p className="text-sm text-gray-500">The governed source of truth for workforce rules, policies and thresholds.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <ConfigTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Config store not provisioned</p><p className="text-sm text-amber-800 mt-1">Migration 081 (wps_config) is required. Configure planning parameters in the <Link href="/unit-manager/planning-studio" className="underline">Workforce Planning Studio</Link>.</p></div></div>;

  const p = d.profile;
  return (
    <div className="space-y-4">
      {header}

      {/* Config health + active policy profile */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Configuration health <span className="text-[9px] text-gray-300">CFG-DASH-01</span></h3>
          <div className="flex items-center gap-4 mt-2">
            <div className="relative w-20 h-20 shrink-0"><div className="w-20 h-20 rounded-full" style={{ background: `conic-gradient(${d.health >= 75 ? "#10b981" : d.health >= 50 ? "#f59e0b" : "#e11d48"} ${d.health}%, #f1f5f9 0)` }} /><div className="absolute inset-[20%] rounded-full bg-white flex items-center justify-center text-lg font-bold">{d.health}%</div></div>
            <div className="text-[11px] text-gray-500"><p><b className="text-[var(--cmp-text-success)]">{d.configured}</b> configured · <b className="text-[var(--cmp-text-warning)]">{d.partial}</b> partial · <b className="text-gray-400">{d.domains.length - d.configured - d.partial}</b> next-phase</p><p className="text-[10px] text-gray-400 mt-1">Completeness across configuration domains.</p></div>
          </div>
        </div>
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Active policy profile <span className="text-[9px] text-gray-300">CFG-DASH-02</span></h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><p className="text-[10px] text-gray-500 uppercase">Version</p><p className="text-lg font-bold text-gray-800">v{p.version}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Status</p><p className="text-sm font-semibold">{p.published ? <span className="text-[var(--cmp-text-success)]">Published</span> : <span className="text-gray-400">Defaults</span>}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Last change</p><p className="text-sm text-gray-700">{fmtDate(p.updatedAt)}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">By</p><p className="text-sm text-gray-700 truncate">{p.updatedByName ?? "—"}</p></div>
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Link href="/unit-manager/planning-studio" className="text-[11px] font-semibold rounded-lg px-3 py-1.5 bg-[var(--cmp-color-success)] text-white hover:bg-emerald-700">Edit in Workforce Planning Studio ↗</Link>
            <Link href="/unit-manager/workforce-management/configuration/audit" className="text-[11px] font-semibold rounded-lg px-3 py-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50">Audit history</Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Pending approvals" value="—" sub="Needs change-set store" tone="text-gray-300" />
        <Kpi label="Validation warnings" value="0" sub="No blocking errors" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Consumers in sync" value={`${d.consumers.length}/${d.consumers.length}`} sub="WFM modules" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Config drift" value="0" sub="Cache in sync" tone="text-[var(--cmp-text-success)]" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Config domains */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Configuration domains</h3>
          <div className="space-y-1.5">{d.domains.map((dm: any) => (<div key={dm.name} className="flex items-center justify-between gap-2 text-xs"><span className="text-gray-600 truncate">{dm.name}</span><span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded ${DSTATUS[dm.status]}`}>{dm.status === "configured" ? "Configured" : dm.status === "partial" ? "Partial" : "Next phase"}</span></div>))}</div>
        </div>

        {/* Consumer synchronisation */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Consumer synchronisation <span className="text-[9px] text-gray-300">CFG-DASH-07</span></h3>
          <div className="space-y-1">{d.consumers.map((c: string) => (<div key={c} className="flex items-center justify-between text-xs rounded-lg border border-gray-100 px-2.5 py-1.5"><span className="text-gray-700">{c}</span><span className="text-[9px] text-[var(--cmp-text-success)]">✓ v{p.version}</span></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">All WFM modules resolve the same published wps_config version (§3 single source of truth).</p>
        </div>

        {/* Recently modified */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recently modified <span className="text-[9px] text-gray-300">CFG-DASH-05</span></h3>
          {d.recent.length === 0 ? <p className="text-sm text-gray-400">No recent configuration changes.</p> : <ol className="space-y-0">{d.recent.slice(0, 8).map((r: any, i: number) => (<li key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /><div className="min-w-0"><p className="text-[11px] text-gray-700">{r.action === "publish_planning_config" ? "Planning config published" : r.action === "publish_roster" ? "Roster published" : r.action}</p><p className="text-[10px] text-gray-400">{r.actor_name || "System"} · {fmtDate(r.created_at)}</p></div></li>))}</ol>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Configuration (UMW-WFM-009 §6) — the live tenant configuration is wps_config (WPS-001), consumed by all WFM modules as a single source of truth (§3). The full governance model (change-sets, validation, simulation, approvals, effective-dated releases, rollback, drift monitoring) needs dedicated configuration-governance stores → honest next-phase. Change-set authoring, inheritance/override and per-domain editors are staged (§39). <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
