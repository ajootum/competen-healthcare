import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Amendments, Swaps & Replacements (UMW-WFM-004 §16) — controls all changes after roster
// publication. The amendment/swap workflow needs a roster_amendment store (§21.11) that is not
// yet provisioned, so this renders an honest next-phase surface: the intended amendment types,
// workflow, swap rules and versioning behaviour, plus a real cross-link to where replacement
// search runs today (the Scheduling Engine solver). No fabricated amendments.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const TYPES = ["Staff-requested swap", "Manager reassignment", "Sickness replacement", "Leave replacement", "Emergency cover", "Supervisor replacement", "Cross-unit deployment", "Agency assignment", "Overtime assignment", "Cancelled shift", "Changed shift time", "Changed role"];
const WORKFLOW = ["Amendment requested", "Eligibility & constraint validation", "Impact assessment", "Required approval", "Roster version updated", "Affected staff notified", "Acknowledgement recorded", "Downstream systems updated"];
const SWAP_RULES = ["Both staff eligible", "Competencies remain sufficient", "Supervisor coverage remains valid", "Working-time rules satisfied", "No leave conflict created", "Contract rules satisfied", "Cost impact acceptable", "Required approvals completed"];

export default async function AmendmentsSwaps() {
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
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Amendments &amp; Swaps</h1><p className="text-sm text-gray-500">Controlled changes after roster publication.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {["Pending amendments", "Swap requests", "Emergency changes", "Applied this cycle"].map(l => (<div key={l} className={`${card} p-4`}><p className="text-xs text-gray-500">{l}</p><p className="text-2xl font-bold text-gray-300 mt-1">—</p><p className="text-[11px] text-gray-400 mt-0.5">Awaiting store</p></div>))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Post-publication amendment workflow — next phase</p>
        <p className="text-sm text-amber-800 mt-1">A controlled amendment/swap store (<span className="font-mono text-[11px]">roster_amendment</span> per §21.11 — type, reason, impact assessment, required approval, version update, targeted notification, acknowledgement) is not yet provisioned. Every post-publication change must create an amendment record and preserve the originally published roster (BR-009 / BR-010). Replacement candidate search runs today via the <Link href="/unit-manager/scheduling-engine" className="text-amber-800 underline font-medium">Scheduling Engine</Link> solver.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Amendment types <span className="text-[10px] text-gray-400 font-normal">§16.2</span></h3>
          <div className="flex flex-wrap gap-1.5">{TYPES.map(t => (<span key={t} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{t}</span>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Amendment workflow <span className="text-[10px] text-gray-400 font-normal">§16.3</span></h3>
          <ol className="space-y-1">{WORKFLOW.map((w, i) => (<li key={w} className="flex items-center gap-2 text-[11px] text-gray-600"><span className="w-4 h-4 rounded-full bg-gray-100 text-gray-500 text-[9px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>{w}</li>))}</ol>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shift-swap rules <span className="text-[10px] text-gray-400 font-normal">§16.4</span></h3>
          <ul className="space-y-1">{SWAP_RULES.map(r => (<li key={r} className="flex items-start gap-1.5 text-[11px] text-gray-600"><span className="text-emerald-500 mt-0.5">✓</span>{r}</li>))}</ul>
          <p className="text-[10px] text-gray-400 mt-2">A swap is never a simple exchange of names (§16.4) — it revalidates coverage, competency, supervisor and working-time (BR-011).</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Amendments, Swaps &amp; Replacements (UMW-WFM-004 §16). Shown honestly as next-phase rather than with placeholder amendments. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
