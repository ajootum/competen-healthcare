import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import WfmExcTabs from "../WfmExcTabs";

export const dynamic = "force-dynamic";

// Rules & Delegated Authority (UMW-WFM-006 §22/§32) — restricted to authorised administrators.
// The delegated-authority matrix + configurable routing rules need a governance-config store →
// honest next-phase; the example authority model is shown as reference. A requester can't
// approve their own request (BR-EXA-003, enforced in the approvals API today).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const AUTHORITY = [
  { role: "Shift Supervisor", may: "Minor same-shift adjustment, attendance verification, short break adjustment, minor correction within limits" },
  { role: "Unit Manager", may: "Routine shift swap, limited overtime, unit-level redeployment, minor roster change, routine attendance correction, replacement within budget" },
  { role: "Nursing Admin / Dept Head", may: "Cross-unit redeployment, high-cost overtime, staffing below standard, critical-role exception, agency request, extended hours" },
  { role: "Human Resources", may: "Leave classification, contractual exception, formal attendance correction, working-arrangement exception, policy interpretation" },
  { role: "Finance", may: "Agency cost, overtime above threshold, unbudgeted expenditure, allowance/payroll variance" },
  { role: "Credentialing / Clinical", may: "Supervised practice, credential exception, temporary role limitation, competency governance" },
];
const CONFIG = ["Exception categories", "Severity rules", "Approval levels", "Delegated authority limits", "Cost thresholds", "Escalation deadlines", "Emergency rules", "Retrospective deadlines", "Evidence requirements", "Notification rules", "Approval delegation", "Conditional approval options", "Automatic expiry", "Auto-escalation", "Bulk approval eligibility"];
const ROUTING = ["Single", "Sequential", "Parallel", "Majority", "Unanimous", "First-response", "Financial co-approval", "HR co-approval", "Clinical co-approval", "Conditional", "Emergency retrospective"];

export default async function RulesDelegatedAuthority() {
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
        <div className="flex items-center gap-2"><span className="text-xl">⚖️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Exceptions &amp; Approvals · Rules &amp; Authority</h1><p className="text-sm text-gray-500">Delegated authority and approval routing configuration.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <WfmExcTabs />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Delegated-authority configuration — next phase</p>
        <p className="text-sm text-amber-800 mt-1">The authority matrix (who approves what, by request type / unit / cost / duration / risk) and configurable routing rules need a governance-config store. The example authority model + routing patterns are shown as reference. Today the approvals API enforces the core control: a requester can&apos;t approve their own request (BR-EXA-003), and decisions are audited.</p>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Example authority model <span className="text-[10px] text-gray-400 font-normal">§22.1</span></h3>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Authority</th><th className="py-2 font-medium">May approve</th></tr></thead>
          <tbody>{AUTHORITY.map(a => (<tr key={a.role} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium whitespace-nowrap">{a.role}</td><td className="py-2 text-gray-500">{a.may}</td></tr>))}</tbody>
        </table></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Configurable rules <span className="text-[10px] text-gray-400 font-normal">§32.1</span></h3>
          <div className="flex flex-wrap gap-1.5">{CONFIG.map(c => (<span key={c} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{c}</span>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Approval routing patterns <span className="text-[10px] text-gray-400 font-normal">§23</span></h3>
          <div className="flex flex-wrap gap-1.5">{ROUTING.map(r => (<span key={r} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{r}</span>))}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Rules &amp; Delegated Authority (UMW-WFM-006 §22/§32) — reference now; configurable matrix next-phase. <Link href="/unit-manager/workforce-management/exceptions-approvals" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
