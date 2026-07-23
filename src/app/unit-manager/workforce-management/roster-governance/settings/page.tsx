import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Governance Settings (UMW-WFM-004 §19) — configure roster-governance rules without changing
// code. Tenant planning parameters (contracted hours, leave, ratios, working-time,
// multipliers) ARE configurable today in the Workforce Planning Studio (WPS-001) → cross-
// linked and real. The remaining governance-config areas (approval chains, publication,
// locking, fairness weighting) with versioning + effective dating + rollback (§19.3) need a
// governance-config store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const AREAS = [
  { name: "Roster-cycle settings", cfg: "Cycle length, planning lead time, approval/publication deadlines", live: false },
  { name: "Shift settings", cfg: "Shift names, times, night/weekend definition, overlap rules", live: false },
  { name: "Coverage rules", cfg: "Minimum staffing, role/care-area minimums, acuity & surge rules", live: true },
  { name: "Skill-mix rules", cfg: "Professional categories, grade mix, mandatory competencies, ratios", live: true },
  { name: "Working-time rules", cfg: "Max weekly hours, minimum rest, consecutive shift/night limits", live: true },
  { name: "Fairness settings", cfg: "Measurement period, undesirable-shift weighting, preference priority", live: false },
  { name: "Approval settings", cfg: "Approval chain, conditional approvers, delegation, override authorities", live: false },
  { name: "Publication settings", cfg: "Channels, acknowledgement requirement, reminders, visibility", live: false },
  { name: "Locking settings", cfg: "Shift/date lock, cycle freeze, amendment cutoff, emergency unlock", live: false },
];

export default async function GovernanceSettings() {
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
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Governance Settings</h1><p className="text-sm text-gray-500">Configure roster-governance rules without changing application code.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
        <p className="font-semibold text-emerald-900">✓ Planning parameters are live in the Workforce Planning Studio</p>
        <p className="text-sm text-emerald-800 mt-1">Contracted hours, leave, staffing ratios, working-time limits and cost multipliers that drive coverage, skill-mix and working-time governance are already tenant-configurable and versioned in <Link href="/unit-manager/planning-studio" className="text-emerald-900 underline font-medium">Workforce Planning Studio (WPS-001)</Link>. Changes flow through the Establishment engine into the whole scheduling &amp; governance chain.</p>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Configurable areas <span className="text-[10px] text-gray-400 font-normal">§19.2</span></h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{AREAS.map(a => (
          <div key={a.name} className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 p-3">
            <div className="min-w-0"><p className="text-xs font-semibold text-gray-800">{a.name}</p><p className="text-[10px] text-gray-400 mt-0.5">{a.cfg}</p></div>
            <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded ${a.live ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>{a.live ? "Live" : "Next phase"}</span>
          </div>
        ))}</div>
        <p className="text-[10px] text-gray-400 mt-3">Every configuration change must be versioned, effective-dated, attributable, rollback-able and must not retroactively alter a previously approved roster (§19.3 / BR-017) — this governance-config store is next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Governance Settings (UMW-WFM-004 §19). Coverage / skill-mix / working-time rules are live via WPS-001; approval, publication, locking and fairness configuration are next-phase. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
