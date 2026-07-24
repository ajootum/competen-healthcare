import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceConfig } from "@/lib/operations/workforce-config";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import ConfigTabs from "../ConfigTabs";

export const dynamic = "force-dynamic";

// Establishment & Staffing Models config (UMW-WFM-009 §8) — the live establishment/staffing
// parameters over wps_config (WPS-001). Read-only here; edited (with versioning + publish) in the
// Workforce Planning Studio. Position establishment + budget ceilings need HR/finance stores.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Param({ label, value, unit }: { label: string; value: any; unit?: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"><span className="text-xs text-gray-600">{label}</span><span className="text-sm font-semibold text-gray-800 tabular-nums">{value}{unit ? <span className="text-[10px] text-gray-400 ml-0.5">{unit}</span> : null}</span></div>;
}

export default async function EstablishmentConfig() {
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

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚙️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration · Establishment &amp; Staffing</h1><p className="text-sm text-gray-500">Approved establishment parameters and staffing models.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <ConfigTabs />
    </>
  );

  return (
    <div className="space-y-4">
      {header}

      <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 text-xs text-emerald-800 flex items-center justify-between flex-wrap gap-2">
        <span>Live over wps_config v{d.profile.version} · {d.profile.published ? "published" : "defaults"}. Editing (versioned + published) happens in the Workforce Planning Studio.</span>
        <Link href="/unit-manager/planning-studio" className="font-semibold rounded-lg px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 shrink-0">Edit ↗</Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Contracted time <span className="text-[10px] text-gray-400 font-normal">§8</span></h3>
          <div className="space-y-1.5"><Param label="Contracted hours / week" value={s.contractedHoursWeek} unit="h" /><Param label="Annual leave" value={s.annualLeaveDays} unit="days" /><Param label="Study leave" value={s.studyLeaveDays} unit="days" /><Param label="Sickness allowance" value={s.sicknessDays} unit="days" /><Param label="Public holidays" value={s.publicHolidays} unit="days" /></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Coverage ratios <span className="text-[10px] text-gray-400 font-normal">staff : patient</span></h3>
          <div className="space-y-1.5"><Param label="Critical care" value={`1:${s.demandRatios?.critical_care ?? "—"}`} /><Param label="Theatre / recovery" value={`1:${s.demandRatios?.theatre ?? "—"}`} /><Param label="Paediatric" value={`1:${s.demandRatios?.paediatric ?? "—"}`} /><Param label="Standard" value={`1:${s.demandRatios?.standard ?? "—"}`} /><Param label="Float pool" value={s.floatPoolPct} unit="%" /></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Cost parameters <span className="text-[10px] text-gray-400 font-normal">{s.currency ?? "GBP"}/hr</span></h3>
          <div className="space-y-1.5">{Object.entries(s.roleRates ?? {}).slice(0, 4).map(([role, rate]: any) => (<Param key={role} label={`Rate · ${role}`} value={`£${rate}`} unit="/h" />))}<Param label="Night multiplier" value={`×${s.nightMultiplier}`} /><Param label="Overtime multiplier" value={`×${s.overtimeMultiplier}`} /><Param label="Agency multiplier" value={`×${s.agencyMultiplier}`} /></div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Establishment &amp; Staffing (UMW-WFM-009 §8) is real over wps_config — these parameters drive the Establishment engine and the whole scheduling chain. Position establishment (funded FTE per post), budget ceilings and acuity/workload bands need HR/finance stores → next-phase. <Link href="/unit-manager/workforce-management/configuration" className="text-emerald-700 hover:underline">← Dashboard</Link></p>
    </div>
  );
}
