import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import TeamGovTabs from "../TeamGovTabs";

export const dynamic = "force-dynamic";

// Cross-Unit Deployments (TAG-001 §8) — request and govern temporary staff movement between
// units. The deployment workflow needs a dedicated request/approval store (deployment_request
// per §11) that is not yet provisioned, so this renders an honest next-phase surface: the
// intended workflow + real cross-links to the staffing approval path that exists today,
// rather than fabricated deployment requests.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

const WORKFLOW = [
  { step: "Identify need", owner: "Destination manager", out: "Role, quantity, window, reason, priority" },
  { step: "Search supply", owner: "System / origin", out: "Eligible available workers" },
  { step: "Origin review", owner: "Origin manager", out: "Release decision + impact" },
  { step: "Destination review", owner: "Destination manager", out: "Competency confirmation" },
  { step: "Worker acceptance", owner: "Worker", out: "Accept / decline" },
  { step: "Activate", owner: "System / supervisor", out: "Temporary assignment + updates" },
  { step: "Monitor", owner: "Both units", out: "Attendance, workload, exceptions" },
  { step: "Release / return", owner: "Destination / origin", out: "End time + handback" },
];

export default async function CrossUnitDeployments() {
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
        <div className="flex items-center gap-2"><span className="text-xl">🧩</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Team Assignments · Cross-Unit Deployments</h1><p className="text-sm text-gray-500">Request and govern temporary staff movement between units.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <TeamGovTabs />

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {["Pending", "Approved", "Active", "Overdue response", "Completed today"].map(l => (
          <div key={l} className={`${card} p-4`}><p className="text-xs text-gray-500">{l}</p><p className="text-2xl font-bold text-gray-300 mt-1">—</p><p className="text-[11px] text-gray-400 mt-0.5">Awaiting store</p></div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Cross-unit deployment workflow — next phase</p>
        <p className="text-sm text-amber-800 mt-1">A formal cross-unit deployment request/approval store (<span className="font-mono text-[11px]">deployment_request</span> per TAG §11 — origin/destination, role &amp; quantity, time window, competency confirmation, worker acceptance and full lifecycle) is not yet provisioned. Rather than show fabricated requests, this surface stays honest. Today, staffing movement approvals run through <Link href="/unit-manager/approvals" className="text-emerald-800 underline font-medium">Executive Actions › Approvals</Link>.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Intended deployment workflow <span className="text-[10px] text-gray-400 font-normal">TAG §8.1</span></h3>
          <ol className="space-y-0">{WORKFLOW.map((w, i) => (
            <li key={w.step} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
              <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
              <div className="flex-1 min-w-0"><div className="flex items-center justify-between gap-2 flex-wrap"><p className="text-xs font-semibold text-gray-800">{w.step}</p><span className="text-[10px] text-gray-400">{w.owner}</span></div><p className="text-[11px] text-gray-500">{w.out}</p></div>
            </li>))}</ol>
        </div>
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Where movement runs today</h3>
            <div className="space-y-1.5">
              {[["Executive Actions › Approvals", "/unit-manager/approvals"], ["Staffing Engine", "/unit-manager/workforce-management/staffing-engine"], ["Staff Availability", "/unit-manager/workforce-management/staffing-engine/availability"]].map(([l, h]) => (<Link key={l} href={h} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-emerald-200 hover:bg-emerald-50/30"><span className="text-xs text-gray-700">{l}</span><span className="text-gray-300">›</span></Link>))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Cross-Unit Deployments (TAG-001 §8) will manage the request → origin/destination review → worker acceptance → activate → release lifecycle once the deployment workflow store is built. Shown honestly as next-phase rather than with placeholder requests. <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
