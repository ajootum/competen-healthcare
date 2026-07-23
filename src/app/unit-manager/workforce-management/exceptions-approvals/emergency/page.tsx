import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import WfmExcTabs from "../WfmExcTabs";

export const dynamic = "force-dynamic";

// Emergency & Retrospective Approvals (UMW-WFM-006 §19) — decisions taken during urgent
// situations where prospective approval wasn't possible. Needs an emergency-workforce-action
// register (with the §19.2 capture fields) → honest next-phase. Retrospective approval must not
// erase that the action was taken before approval (§19.3 / BR-EXA-009).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const ACTIONS = ["Emergency overtime", "Emergency redeployment", "Emergency shift extension", "Temporary staffing below standard", "Temporary assignment change", "Call-in without prior approval", "Emergency agency engagement", "Emergency break interruption", "Emergency schedule change", "Temporary supervised competency"];
const CAPTURE = ["Emergency reason", "Decision-maker", "Affected unit & staff", "Action taken", "Start time & expected duration", "Risks & immediate safeguards", "Higher authority notified", "Retrospective approval deadline"];
const REVIEW = ["Did an emergency exist?", "Was the action proportionate?", "Did safer alternatives exist?", "Were policy requirements followed as far as possible?", "Were staff-welfare protections maintained?", "Was cost reasonable?", "Is further action required?", "Should the rule/process be improved?"];

export default async function EmergencyRetrospective() {
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
        <div className="flex items-center gap-2"><span className="text-xl">⚖️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Exceptions &amp; Approvals · Emergency &amp; Retrospective</h1><p className="text-sm text-gray-500">Urgent actions taken before approval, awaiting retrospective review.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmExcTabs />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Emergency-action register — next phase</p>
        <p className="text-sm text-amber-800 mt-1">Recording an emergency workforce action at the time it&apos;s taken (§19.2) and its retrospective review (§19.3) need an emergency-workforce-action register. Shown honestly as next-phase. Emergency actions must enter retrospective review within the configured deadline (BR-EXA-009); retrospective approval never erases that the action was taken before approval. Escalations that arise today are on the <Link href="/unit-manager/workforce-management/exceptions-approvals/escalations" className="text-amber-800 underline font-medium">Escalations</Link> tab.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Emergency actions <span className="text-[10px] text-gray-400 font-normal">§19.1</span></h3>
          <div className="flex flex-wrap gap-1.5">{ACTIONS.map(a => (<span key={a} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{a}</span>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Capture at time of action <span className="text-[10px] text-gray-400 font-normal">§19.2</span></h3>
          <ul className="space-y-1 text-[11px] text-gray-600 list-disc list-inside">{CAPTURE.map(x => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Retrospective review <span className="text-[10px] text-gray-400 font-normal">§19.3</span></h3>
          <ul className="space-y-1 text-[11px] text-gray-600 list-disc list-inside">{REVIEW.map(x => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Emergency &amp; Retrospective Approvals (UMW-WFM-006 §19) — next-phase pending an emergency-action register. <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
