import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import WfmExcTabs from "../WfmExcTabs";

export const dynamic = "force-dynamic";

// History & Audit (UMW-WFM-006 §30) — immutable, searchable trail of workforce governance
// decisions over audit_log. Real. Case-level timeline + advanced filters need the full case
// model → next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";
const ACT: Record<string, { label: string; tone: string }> = {
  create_approval_request: { label: "Approval requested", tone: "bg-blue-50 text-blue-700" },
  decide_approval: { label: "Approval decided", tone: "bg-emerald-50 text-emerald-700" },
  record_replacement: { label: "Replacement", tone: "bg-violet-50 text-violet-700" },
  record_attendance_exception: { label: "Attendance exception", tone: "bg-amber-50 text-amber-700" },
  record_leave: { label: "Leave classified", tone: "bg-sky-50 text-sky-700" },
  record_correction: { label: "Attendance correction", tone: "bg-violet-50 text-violet-700" },
  raise_escalation: { label: "Escalation raised", tone: "bg-orange-50 text-orange-700" },
};
const ACT_KEYS = Object.keys(ACT);
const weekAgoISO = () => new Date(Date.now() - 7 * 864e5).toISOString();
function when(iso: string): string { const mins = Math.round((new Date().getTime() - new Date(iso).getTime()) / 60000); if (mins < 60) return `${Math.max(1, mins)}m ago`; const h = Math.round(mins / 60); if (h < 24) return `${h}h ago`; return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function HistoryAudit() {
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
  const weekAgo = weekAgoISO();
  const recent = rows.filter(r => r.created_at >= weekAgo).length;
  const decisions = rows.filter(r => r.action === "decide_approval").length;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚖️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Exceptions &amp; Approvals · History &amp; Audit</h1><p className="text-sm text-gray-500">Immutable, searchable trail of workforce governance decisions.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmExcTabs />
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
          <Kpi label="Decisions logged" value={decisions} tone="text-emerald-600" />
          <Kpi label="Total logged" value={rows.length} />
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Governance audit ledger <span className="text-[10px] text-gray-400 font-normal">latest {rows.length} · newest first</span></h3>
          {rows.length === 0 ? <p className="text-sm text-gray-400">No workforce governance events recorded yet.</p> : <ol className="space-y-0">{rows.map((r, i) => { const a = ACT[r.action] ?? { label: r.action, tone: "bg-gray-100 text-gray-600" }; return (<li key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0"><span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className={`text-[9px] px-1.5 py-0.5 rounded ${a.tone}`}>{a.label}</span><span className="text-xs text-gray-700 truncate">{r.entity_name || "—"}</span></div><p className="text-[11px] text-gray-400 mt-0.5">{r.actor_name || "System"} · {when(r.created_at)}</p></div></li>); })}</ol>}
          <p className="text-[10px] text-gray-400 mt-2">Audit records are immutable to operational users (§28). Per-case timeline (creation → submission → decisions → escalation → implementation → closure) + advanced filters need the full case model → next-phase.</p>
        </div>
      </>)}
      <p className="text-[11px] text-gray-400 pb-4">History &amp; Audit (UMW-WFM-006 §30) over audit_log. <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
