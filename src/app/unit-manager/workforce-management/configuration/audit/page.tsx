import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import ConfigTabs from "../ConfigTabs";

export const dynamic = "force-dynamic";

// Audit & Configuration History (UMW-WFM-009 §27 CFG-AUD-01) — the immutable record of
// configuration actions. Real over audit_log (config publish events). Full before/after change
// history + evidence packages need the configuration-audit store → next-phase. Immutable to
// operational users (§21).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";
const ACT: Record<string, { label: string; tone: string }> = {
  publish_planning_config: { label: "Planning config published", tone: "bg-emerald-50 text-emerald-700" },
  publish_roster: { label: "Roster published", tone: "bg-blue-50 text-blue-700" },
  archive_roster: { label: "Roster archived", tone: "bg-gray-100 text-gray-600" },
  submit_roster_approval: { label: "Approval submitted", tone: "bg-sky-50 text-sky-700" },
  decide_roster_approval: { label: "Approval decided", tone: "bg-emerald-50 text-emerald-700" },
};
const ACT_KEYS = Object.keys(ACT);
const weekAgoISO = () => new Date(Date.now() - 7 * 864e5).toISOString();
function when(iso: string): string { const mins = Math.round((new Date().getTime() - new Date(iso).getTime()) / 60000); if (mins < 60) return `${Math.max(1, mins)}m ago`; const h = Math.round(mins / 60); if (h < 24) return `${h}h ago`; return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function ConfigAudit() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const departments = await loadUnitDepartments(admin, hid, isSuper);

  let rows: any[] = [];
  let provisioned = true;
  const q = admin.from("audit_log").select("actor_name, action, entity_name, created_at").in("action", ACT_KEYS).order("created_at", { ascending: false }).limit(80);
  const res = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  if (res.error) { provisioned = !/does not exist|schema cache/i.test(res.error.message ?? ""); rows = []; }
  else rows = res.data ?? [];
  const recent = rows.filter(r => r.created_at >= weekAgoISO()).length;
  const publishes = rows.filter(r => r.action === "publish_planning_config").length;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚙️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration · Audit History</h1><p className="text-sm text-gray-500">Immutable record of configuration actions and affected modules.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <ConfigTabs />
    </>
  );

  return (
    <div className="space-y-4">
      {header}
      {!provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Audit store not provisioned</p></div>
      ) : (<>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Kpi label="Events (7d)" value={recent} />
          <Kpi label="Config publishes" value={publishes} tone="text-emerald-600" />
          <Kpi label="Total logged" value={rows.length} />
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Configuration audit explorer <span className="text-[10px] text-gray-400 font-normal">CFG-AUD-01 · latest {rows.length}</span></h3>
          {rows.length === 0 ? <p className="text-sm text-gray-400">No configuration events recorded yet.</p> : <ol className="space-y-0">{rows.map((r, i) => { const a = ACT[r.action] ?? { label: r.action, tone: "bg-gray-100 text-gray-600" }; return (<li key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0"><span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className={`text-[9px] px-1.5 py-0.5 rounded ${a.tone}`}>{a.label}</span><span className="text-xs text-gray-700 truncate">{r.entity_name || "—"}</span></div><p className="text-[11px] text-gray-400 mt-0.5">{r.actor_name || "System"} · {when(r.created_at)}</p></div></li>); })}</ol>}
          <p className="text-[10px] text-gray-400 mt-2">Audit records are immutable to operational users (§21). Full before/after values, reason, approvals + exportable evidence packages (Appendix C) need the configuration-audit store → next-phase.</p>
        </div>
      </>)}
      <p className="text-[11px] text-gray-400 pb-4">Audit &amp; Configuration History (UMW-WFM-009 §27) over audit_log. <Link href="/unit-manager/workforce-management/configuration" className="text-emerald-700 hover:underline">← Dashboard</Link></p>
    </div>
  );
}
