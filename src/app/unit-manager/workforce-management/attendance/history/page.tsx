import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Attendance History (UMW-WFM-005 §20) — authorised longitudinal record. The audit ledger of
// attendance-relevant events is real over audit_log; the per-staff attendance profile
// (attendance rate, punctuality, no-shows over time) needs a persisted attendance-event store
// → honest next-phase. Attendance history is sensitive — access is restricted to managed units.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";
const ACT: Record<string, { label: string; tone: string }> = {
  record_attendance: { label: "Attendance recorded", tone: "bg-emerald-50 text-emerald-700" },
  deploy_staff: { label: "Staff deployed / status change", tone: "bg-teal-50 text-teal-700" },
  open_shift: { label: "Shift opened", tone: "bg-blue-50 text-blue-700" },
  schedule_break: { label: "Break scheduled", tone: "bg-sky-50 text-sky-700" },
  raise_escalation: { label: "Escalation raised", tone: "bg-amber-50 text-amber-700" },
};
const ACT_KEYS = Object.keys(ACT);
const weekAgoISO = () => new Date(Date.now() - 7 * 864e5).toISOString();
function when(iso: string): string { const mins = Math.round((new Date().getTime() - new Date(iso).getTime()) / 60000); if (mins < 60) return `${Math.max(1, mins)}m ago`; const h = Math.round(mins / 60); if (h < 24) return `${h}h ago`; return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function AttendanceHistory() {
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

  const weekAgo = weekAgoISO();
  let rows: any[] = [];
  let provisioned = true;
  const q = admin.from("audit_log").select("actor_name, action, entity_name, created_at").in("action", ACT_KEYS).order("created_at", { ascending: false }).limit(60);
  const res = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  if (res.error) { provisioned = !/does not exist|schema cache/i.test(res.error.message ?? ""); rows = []; }
  else rows = res.data ?? [];
  const recent = rows.filter(r => r.created_at >= weekAgo).length;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Attendance History</h1><p className="text-sm text-gray-500">Authorised longitudinal attendance record for staff under your management.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />
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
          <Kpi label="Total logged" value={rows.length} />
          <Kpi label="Attendance rate" value="—" tone="text-gray-300" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className={`${card} p-5 xl:col-span-2`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Attendance event ledger <span className="text-[10px] text-gray-400 font-normal">latest {rows.length}</span></h3>
            {rows.length === 0 ? <p className="text-sm text-gray-400">No attendance events recorded yet.</p> : <ol className="space-y-0">{rows.map((r, i) => { const a = ACT[r.action] ?? { label: r.action, tone: "bg-gray-100 text-gray-600" }; return (<li key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0"><span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className={`text-[9px] px-1.5 py-0.5 rounded ${a.tone}`}>{a.label}</span><span className="text-xs text-gray-700 truncate">{r.entity_name || "shift"}</span></div><p className="text-[11px] text-gray-400 mt-0.5">{r.actor_name || "System"} · {when(r.created_at)}</p></div></li>); })}</ol>}
          </div>

          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Staff attendance profile <span className="text-[10px] text-gray-400 font-normal">§20.1</span></h3>
            <p className="text-[11px] text-gray-500">Per-staff attendance rate, punctuality, late arrivals, no-shows, overtime and corrections over time need a persisted attendance-event store (op_shift_staff records current state only, not history).</p>
            <span className="mt-2 inline-block text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Next phase</span>
            <p className="text-[10px] text-gray-400 mt-3">Attendance history is sensitive (§20.3) — access is restricted to staff under your management and audited. No operational user can delete attendance history (BR-ATT-010).</p>
          </div>
        </div>
      </>)}
      <p className="text-[11px] text-gray-400 pb-4">Attendance History (UMW-WFM-005 §20) surfaces the attendance event trail from audit_log; the longitudinal per-staff profile is next-phase. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
