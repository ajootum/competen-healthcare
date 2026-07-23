import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import AttendanceTabs from "../AttendanceTabs";

export const dynamic = "force-dynamic";

// Late Arrival & Early Departure (UMW-WFM-005 §16) — needs actual arrival/departure timestamps
// (op_shift_staff stores attendance STATE only, not clock times), so this is an honest
// next-phase surface: the configurable lateness severity, early-departure workflow and pattern
// detection the module will run once an attendance-event store with timestamps exists.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEVERITY = [
  { band: "1–5 min", label: "Informational", tone: "bg-gray-100 text-gray-500" },
  { band: "6–15 min", label: "Minor", tone: "bg-sky-50 text-sky-700" },
  { band: "16–30 min", label: "Significant", tone: "bg-amber-50 text-amber-700" },
  { band: "> 30 min", label: "Severe", tone: "bg-orange-50 text-orange-700" },
  { band: "No contact", label: "Possible no-show", tone: "bg-rose-50 text-rose-700" },
];
const PATTERNS = ["Repeated late arrival", "Repeated early departure", "Frequent Monday/weekend absence", "Absence around leave", "Absence near public holidays", "Recurring missed clock-out", "Repeated correction", "Repeated no-show", "Abnormal attendance across units"];

export default async function LateEarly() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const departments = await loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🕒</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attendance · Late &amp; Early Departure</h1><p className="text-sm text-gray-500">Real-time management and pattern review of lateness and early departure.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <AttendanceTabs />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Lateness &amp; early-departure tracking — next phase</p>
        <p className="text-sm text-amber-800 mt-1">This tab needs actual arrival/departure timestamps. Today op_shift_staff records attendance <em>state</em> (present/absent) via Shift Supervisor confirmation, not clock times — so minutes-late, grace-period and early-departure detection are shown honestly as next-phase. They activate once an attendance-event store (check-in/out events) is added. Absent/no-show detection is live on <Link href="/unit-manager/workforce-management/attendance/today" className="text-amber-800 underline font-medium">Today&apos;s Attendance</Link>.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Lateness severity <span className="text-[10px] text-gray-400 font-normal">§16.1 · configurable</span></h3>
          <div className="space-y-1.5">{SEVERITY.map(s => (<div key={s.band} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-1.5"><span className="text-xs text-gray-700">{s.band}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${s.tone}`}>{s.label}</span></div>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Early-departure workflow <span className="text-[10px] text-gray-400 font-normal">§16.2</span></h3>
          <ul className="space-y-1 text-[11px] text-gray-600 list-disc list-inside">{["Requested departure time", "Reason", "Supervisor recommendation", "Remaining staffing impact", "Replacement/coverage plan", "Approval decision", "Actual departure time", "Hours completed", "Follow-up requirement"].map(x => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Pattern detection <span className="text-[10px] text-gray-400 font-normal">§16.3</span></h3>
          <div className="flex flex-wrap gap-1.5">{PATTERNS.map(p => (<span key={p} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{p}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Pattern detection produces a review prompt, never an automatic disciplinary conclusion (§16.3 / BR-ATT-012).</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Late &amp; Early Departure (UMW-WFM-005 §16) — next-phase pending an attendance-event timestamp store. <Link href="/unit-manager/workforce-management/attendance" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
