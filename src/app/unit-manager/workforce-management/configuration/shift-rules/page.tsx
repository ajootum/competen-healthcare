import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceConfig } from "@/lib/operations/workforce-config";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import ConfigTabs from "../ConfigTabs";

export const dynamic = "force-dynamic";

// Shift & Roster Rules config (UMW-WFM-009 §9-10/§14) — the live shift/working-time parameters
// over wps_config. Read-only here; edited in the Workforce Planning Studio. The full shift-
// template library + rule engine (rest/break/handover/swap/publication rules) need a shift-config
// store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Param({ label, value, unit }: { label: string; value: any; unit?: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"><span className="text-xs text-gray-600">{label}</span><span className="text-sm font-semibold text-gray-800 tabular-nums">{value}{unit ? <span className="text-[10px] text-gray-400 ml-0.5">{unit}</span> : null}</span></div>;
}

export default async function ShiftRulesConfig() {
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
  const s = d.settings ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚙️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration · Shift &amp; Roster Rules</h1><p className="text-sm text-gray-500">Shift templates, working-time rules, rest, breaks and roster governance.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <ConfigTabs />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Working-time rules <span className="text-[10px] text-emerald-600 font-normal">live · wps_config</span></h3>
          <div className="space-y-1.5"><Param label="Shift length" value={s.shiftHours} unit="h" /><Param label="Shifts / day" value={s.shiftsPerDay} /><Param label="Max shifts / week" value={s.maxShiftsWeek} /><Param label="Max weekly hours" value={(s.shiftHours ?? 0) * (s.maxShiftsWeek ?? 0)} unit="h" /></div>
          <Link href="/unit-manager/planning-studio" className="mt-3 inline-block text-[11px] font-semibold text-emerald-700 hover:underline">Edit in Planning Studio ↗</Link>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shift templates <span className="text-[10px] text-gray-400 font-normal">§9</span></h3>
          <div className="flex flex-wrap gap-1.5">{["Code / name", "Start / end", "Spans midnight", "Paid hours", "Handover overlap", "Active days", "Category (day/night/…)", "Eligibility (role/grade)"].map(x => (<span key={x} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{x}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">The shift-template library (CFG-SHF-01) + rest/break/handover/tolerance rules need a shift-config store → next-phase.</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Roster governance <span className="text-[10px] text-gray-400 font-normal">§14</span></h3>
          <div className="flex flex-wrap gap-1.5">{["Roster method", "Planning horizon", "Publication lead time", "Freeze / lock", "Swap policy", "Open-shift policy", "Post-publication changes", "Emergency changes", "Acknowledgement"].map(x => (<span key={x} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{x}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Roster-governance rule config needs a roster-rules store; roster governance itself runs in <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">Roster Governance</Link>.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Shift &amp; Roster Rules (UMW-WFM-009 §9-14). Working-time parameters are live over wps_config; the shift-template library + rule engine are next-phase. Rules classified hard/soft/preference/objective (§10). <Link href="/unit-manager/workforce-management/configuration" className="text-emerald-700 hover:underline">← Dashboard</Link></p>
    </div>
  );
}
