import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import WfmTabs from "../WfmTabs";
import StaffingEngine from "./StaffingEngine";

export const dynamic = "force-dynamic";

// Staffing Engine (UMW-WFM-000 §Staffing Engine) — deploy staff, fill vacancies, float
// staff and manage deployment status for the active shift. Real deployment over
// op_shift_staff via the audited /api/operations/shift-staff route. Roster + available-
// staff picker from live data; role gaps from op_staffing_standards. Roster templates,
// recurring patterns and approval workflow are honest next-phase states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function StaffingEnginePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const presetRole = typeof sp.role === "string" ? sp.role : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [w, departments] = await Promise.all([
    loadWorkforceOps(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper),
  ]);
  const shiftId: string | null = w.ready ? (w.shiftId ?? null) : null;

  // Live roster for the active shift (op_shift_staff row ids for mutation) + available staff
  let roster: any[] = []; let available: any[] = [];
  if (shiftId) {
    const { data: rs } = await admin.from("op_shift_staff").select("id, staff_id, role, status, profiles!staff_id(full_name)").eq("shift_id", shiftId).limit(300);
    roster = (rs ?? []).map((r: any) => ({ id: r.id, staffId: r.staff_id, name: r.profiles?.full_name ?? "—", role: r.role, status: r.status })).sort((a: any, b: any) => a.name.localeCompare(b.name));
    const onShift = new Set(roster.map((r: any) => r.staffId));
    const staffQ = admin.from("profiles").select("id, full_name, role").order("full_name").limit(200);
    const { data: st } = await (isSuper ? staffQ : staffQ.eq("hospital_id", hid ?? NONE));
    available = (st ?? []).filter((s: any) => s.id && s.full_name && !onShift.has(s.id)).map((s: any) => ({ id: s.id, name: s.full_name, role: s.role ?? "" }));
  }

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Management</h1><p className="text-sm text-gray-500">Staffing Engine — deploy staff, fill vacancies and manage shift deployment.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmTabs />
    </>
  );

  if (!w.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift / operational data</p><p className="text-sm text-amber-800 mt-1">The Staffing Engine activates once an operational shift with staffing is running for this unit.</p></div></div>;

  const onDuty = roster.filter((r: any) => ["on_duty", "confirmed", "assigned"].includes(r.status)).length;
  const gaps = w.openShifts ?? [];
  const totalVacancies = gaps.reduce((n: number, g: any) => n + g.positions, 0);
  const floatAvail = (w.floatPool ?? []).filter((f: any) => f.status === "Available").length;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Staff deployed" value={roster.length} sub={`${onDuty} on duty`} tone="text-emerald-600" />
        <Kpi label="Open vacancies" value={totalVacancies} sub={`${gaps.length} role${gaps.length === 1 ? "" : "s"}`} tone={totalVacancies ? "text-rose-600" : undefined} />
        <Kpi label="Float available" value={floatAvail} sub="Ready to deploy" />
        <Kpi label="Coverage" value={w.overviewTotal.coverage != null ? `${w.overviewTotal.coverage}%` : "—"} sub="Overall" tone={w.overviewTotal.coverage != null && w.overviewTotal.coverage >= 90 ? "text-emerald-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Deploy + roster */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Deployment</h3>
          <StaffingEngine shiftId={shiftId} roster={roster} available={available} presetRole={presetRole} />
        </div>

        {/* Vacancies to fill */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Vacancies to fill</h3>
          {gaps.length === 0 ? <p className="text-sm text-gray-400">No open vacancies — all roles covered. 🎉</p> : (
            <div className="space-y-2">{gaps.map((g: any, i: number) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-gray-100 p-2.5">
                <div><p className="text-xs font-semibold text-gray-800">{g.role}</p><p className="text-[11px] text-gray-500">{g.positions} open · {g.urgency}</p></div>
                <Link href={`/unit-manager/workforce-management/staffing-engine?role=${String(g.role).toLowerCase().split(" ")[0]}`} className="text-[10px] font-semibold rounded-lg py-1.5 px-2.5 bg-emerald-600 text-white">Fill →</Link>
              </div>
            ))}</div>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-100">Gaps derive from op_staffing_standards (required) vs live on-duty staff. &quot;Fill&quot; pre-selects the role in the deploy panel.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Staffing Engine (UMW-WFM-000) performs real staff deployment over op_shift_staff via the audited /api/operations/shift-staff route — deploy a worker onto the active shift, confirm / stand up / stand down / mark absent, and remove from the roster; role vacancies come from op_staffing_standards. Every change is audit-logged. Roster templates, recurring patterns, shift swaps and a manager approval workflow are honest next-phase states. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Overview</Link></p>
    </div>
  );
}
