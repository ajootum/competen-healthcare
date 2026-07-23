import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import TeamGovTabs from "../TeamGovTabs";

export const dynamic = "force-dynamic";

// Rules & Templates (TAG-001 §9) — configure assignment governance rules. The effective
// coverage/ratio rules that DO exist today (op_staffing_standards) are shown read-only and
// real; tenant planning parameters are owned by the Workforce Planning Studio (WPS-001). The
// schema-driven rule editor, versioning/effective-dating, simulation and approval queue need
// a rules store (assignment_rule per §11) → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";
const cap = (s: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "—");

const FAMILIES = [
  { name: "Coverage", cfg: "Minimum headcount/FTE, role & skill mix by unit/shift/acuity", live: true },
  { name: "Patient assignment", cfg: "Max patients, accountable uniqueness, team structure", live: false },
  { name: "Acuity", cfg: "High-acuity competency, observation & senior coverage", live: false },
  { name: "Competency", cfg: "Required competencies, substitutions, supervision, expiry", live: false },
  { name: "Workload", cfg: "Point weights, thresholds, imbalance tolerance", live: false },
  { name: "Availability", cfg: "Attendance, leave, overtime, fatigue, concurrency", live: false },
  { name: "Breaks", cfg: "Break duration/window and safe coverage during break", live: false },
  { name: "Deployment", cfg: "Permitted origin/destination, approval path, duration", live: false },
  { name: "Exception", cfg: "Severity, SLA, escalation, override permission & reason", live: false },
  { name: "Approval", cfg: "Role-based routes, thresholds, delegation, quorum", live: false },
  { name: "Notification", cfg: "Recipients, channels, throttling, escalation timing", live: false },
  { name: "Data quality", cfg: "Freshness, completeness and conflict treatment", live: false },
];

export default async function RulesTemplates() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const departments = await loadUnitDepartments(admin, hid, isSuper);

  // Effective coverage/ratio rules (real, read-only) from op_staffing_standards.
  let standards: any[] = [];
  let provisioned = true;
  const q = admin.from("op_staffing_standards").select("role, target_ratio, min_count, shift_type, departments!department_id(name)").order("role").limit(200);
  const res = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  if (res.error) { provisioned = !/does not exist|schema cache/i.test(res.error.message ?? ""); standards = []; }
  else standards = res.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧩</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Team Assignments · Rules &amp; Templates</h1><p className="text-sm text-gray-500">Configure the governance rules that drive coverage, competency, workload and exceptions.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <TeamGovTabs />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Effective coverage rules (real) */}
        <div className={`${card} p-5 xl:col-span-3`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Effective coverage &amp; ratio rules <span className="text-[10px] text-gray-400 font-normal">live · op_staffing_standards</span></h3>
          {!provisioned ? <p className="text-sm text-gray-400">Staffing standards store not provisioned yet.</p> : standards.length === 0 ? <p className="text-sm text-gray-400">No coverage/ratio standards configured for your units yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Shift</th><th className="py-2 pr-3 font-medium text-right">Target ratio</th><th className="py-2 font-medium text-right">Min count</th></tr></thead>
              <tbody>{standards.map((s: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{s.departments?.name ?? "All units"}</td><td className="py-2 pr-3 text-gray-600 capitalize">{s.role}</td><td className="py-2 pr-3 text-gray-500">{cap(s.shift_type)}</td><td className="py-2 pr-3 text-right text-gray-700 font-semibold">{s.target_ratio != null ? `1:${s.target_ratio}` : "—"}</td><td className="py-2 text-right text-gray-700 font-semibold">{s.min_count ?? "—"}</td></tr>))}</tbody>
            </table></div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Coverage &amp; ratio rules are live and drive the Staffing Engine, exceptions and workload. Editing them (and the schema-driven editor for the other families) is next-phase — tenant planning parameters are configured in <Link href="/unit-manager/planning-studio" className="text-emerald-700 hover:underline">Workforce Planning Studio</Link>.</p>
        </div>

        {/* Rule families */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Rule families <span className="text-[10px] text-gray-400 font-normal">TAG §9.1</span></h3>
          <div className="space-y-1.5 max-h-[22rem] overflow-y-auto pr-1">{FAMILIES.map(f => (
            <div key={f.name} className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 p-2.5">
              <div className="min-w-0"><p className="text-xs font-semibold text-gray-800">{f.name}</p><p className="text-[10px] text-gray-400">{f.cfg}</p></div>
              <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded ${f.live ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>{f.live ? "Live" : "Next phase"}</span>
            </div>))}</div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="font-semibold text-amber-900">⚙️ Rule editor, versioning &amp; simulation — next phase</p>
        <p className="text-sm text-amber-800 mt-1">The schema-driven rule/template editor, effective-dated versioning (draft → review → approved → scheduled → active → superseded), sandbox simulation and the approval/publication queue need a governance rules store (<span className="font-mono text-[11px]">assignment_rule</span> / <span className="font-mono text-[11px]">assignment_template</span> per TAG §11). Coverage &amp; ratio rules are already live and editable in the planning parameters; the rest are shown honestly as reference.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Rules &amp; Templates (TAG-001 §9) governs the twelve rule families. Effective coverage/ratio rules are live over op_staffing_standards; tenant planning parameters live in <Link href="/unit-manager/planning-studio" className="text-emerald-700 hover:underline">Workforce Planning Studio</Link>. The full rule editor, versioning, simulation and approval queue are next-phase. <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
    </div>
  );
}
