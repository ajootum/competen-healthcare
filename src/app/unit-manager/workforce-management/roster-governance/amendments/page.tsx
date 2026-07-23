import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRosterAmendmentsView } from "@/lib/operations/roster-governance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";
import { NewAmendment, AmendmentRegister } from "./AmendmentActions";

export const dynamic = "force-dynamic";

// Amendments, Swaps & Replacements (UMW-WFM-004 §16) — real over op_roster_amendments (082).
// Post-publication changes create an amendment record and preserve the originally published
// roster (BR-EXA-006/010). A swap revalidates coverage/competency/supervisor/working-time.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SWAP_RULES = ["Both staff eligible", "Competencies remain sufficient", "Supervisor coverage remains valid", "Working-time rules satisfied", "No leave conflict created", "Contract rules satisfied", "Cost impact acceptable", "Required approvals completed"];

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function AmendmentsSwaps() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadRosterAmendmentsView(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Amendments &amp; Swaps</h1><p className="text-sm text-gray-500">Controlled changes after roster publication.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Open amendments" value={d.open.length} tone={d.open.length ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Applied" value={d.appliedCount} tone="text-emerald-600" />
        <Kpi label="Total logged" value={d.amendments.length} />
        <Kpi label="Roster status" value={d.rosterStatus} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Create amendment</h3>
          <NewAmendment rosterId={d.rosterId} />
          <p className="text-[10px] text-gray-400 mt-3">Every post-publication change creates an amendment record and preserves the originally published roster (BR-EXA-006/010).</p>
        </div>
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Amendment register <span className="text-[10px] text-gray-400 font-normal">request → validate → approve → apply</span></h3>
          <AmendmentRegister rows={d.open} />
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Shift-swap rules <span className="text-[10px] text-gray-400 font-normal">§16.4</span></h3>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">{SWAP_RULES.map(r => (<li key={r} className="flex items-start gap-1.5 text-[11px] text-gray-600"><span className="text-emerald-500 mt-0.5">✓</span>{r}</li>))}</ul>
        <p className="text-[10px] text-gray-400 mt-2">A swap is never a simple exchange of names — it revalidates coverage, competency, supervisor and working-time. Automated pre-apply revalidation + new roster-version creation are next-phase.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Amendments, Swaps &amp; Replacements (UMW-WFM-004 §16) is real over op_roster_amendments. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
