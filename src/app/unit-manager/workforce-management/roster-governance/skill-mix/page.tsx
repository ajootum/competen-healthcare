import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCompetencyMatching } from "@/lib/operations/competency-matching";
import { loadRosterForWeek, mondayOf } from "@/lib/operations/roster-solver";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Skill Mix & Supervisor Validation (UMW-WFM-004 §12) — ensures every shift has the required
// professional categories, competencies and an authorised Shift Supervisor. Reuses the
// Competency Matching Engine (WSE-001D) for skill mix + computes supervisor coverage directly
// from the roster (is_supervisor posts). Real. Competency authoring is owned by CME.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function SkillMixSupervisor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, rw, departments] = await Promise.all([
    loadCompetencyMatching(admin, hid, isSuper) as Promise<any>,
    loadRosterForWeek(admin, hid, isSuper, mondayOf()) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper),
  ]);

  // Supervisor coverage from roster (is_supervisor posts per shift)
  const asg: any[] = rw?.assignments ?? [];
  const shiftMap = new Map<string, { supPost: boolean; supFilled: boolean }>();
  for (const a of asg) { const key = `${a.unit_name}|${a.shift_date}|${a.shift_type}`; const s = shiftMap.get(key) ?? { supPost: false, supFilled: false }; if (a.is_supervisor) { s.supPost = true; if (a.status === "assigned") s.supFilled = true; } shiftMap.set(key, s); }
  const shifts = [...shiftMap.values()];
  const supRequired = shifts.filter(s => s.supPost).length;
  const supConfirmed = shifts.filter(s => s.supFilled).length;
  const supUncovered = supRequired - supConfirmed;
  const supNoPost = shifts.length - supRequired;
  const supScore = supRequired ? Math.round((supConfirmed / supRequired) * 100) : null;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Skill Mix &amp; Supervisor</h1><p className="text-sm text-gray-500">Every shift has the required competencies and an authorised Shift Supervisor.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  const match = d.match;
  if (!match) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Skill-mix match" value={match.matchScore != null ? `${match.matchScore}%` : "—"} sub={`${match.validated}/${match.assigned} validated`} tone={match.matchScore != null && match.matchScore >= 90 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Supervisor coverage" value={supScore != null ? `${supScore}%` : "—"} sub={`${supConfirmed}/${supRequired} shifts`} tone={supUncovered ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Competency gaps" value={match.unvalidatedCount} sub="Unvalidated assignments" tone={match.unvalidatedCount ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Expired certs" value={d.kpis.expiredCerts} sub="Workforce-wide" tone={d.kpis.expiredCerts ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Expiring ≤30d" value={d.kpis.expiringCerts} sub="Schedule reassessment" tone={d.kpis.expiringCerts ? "text-amber-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Role competency coverage */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Competency coverage by role</h3>
          {(d.roleCoverage ?? []).length === 0 ? <p className="text-sm text-gray-400">No role data.</p> : <div className="space-y-2">{d.roleCoverage.map((r: any) => (<div key={r.role} className="flex items-center gap-3 text-xs"><span className="text-gray-700 w-28 truncate">{r.label}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${(r.pct ?? 0) >= 90 ? "bg-emerald-500" : (r.pct ?? 0) >= 75 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${r.pct ?? 0}%` }} /></div><span className="text-gray-600 w-14 text-right">{r.current}/{r.total}{r.pct != null ? ` · ${r.pct}%` : ""}</span></div>))}</div>}
        </div>

        {/* Supervisor coverage */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shift Supervisor coverage</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div><p className="text-[10px] text-gray-500 uppercase">Confirmed</p><p className="text-xl font-bold text-emerald-600">{supConfirmed}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Uncovered</p><p className={`text-xl font-bold ${supUncovered ? "text-rose-600" : "text-gray-300"}`}>{supUncovered}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">No sup. post</p><p className={`text-xl font-bold ${supNoPost ? "text-amber-600" : "text-gray-300"}`}>{supNoPost}</p></div>
          </div>
          <p className="text-[11px] text-gray-500">A staff member may be rostered as Shift Supervisor only when in the authorised supervisor pool and meeting active eligibility (§12.4). Missing-supervisor shifts are a hard publish block (BR-003).</p>
          {supNoPost > 0 && <p className="text-[10px] text-amber-600 mt-1">{supNoPost} shift(s) have no supervisor post at all — confirm whether tenant rules require one.</p>}
        </div>
      </div>

      {/* Competency gap queue with recommended replacement */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Competency gap queue <span className="text-[10px] text-gray-400 font-normal">unvalidated roster assignments · recommended cover</span></h3>
        {match.highRisk.length === 0 ? <p className="text-sm text-gray-400">Every roster assignment has a validated competency. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Shift</th><th className="py-2 pr-3 font-medium">Assigned</th><th className="py-2 font-medium">Recommended replacement</th></tr></thead>
            <tbody>{match.highRisk.map((h: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{h.unit}</td><td className="py-2 pr-3 text-gray-600">{h.role}</td><td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td><td className="py-2 pr-3 text-gray-500 capitalize">{h.shift}</td><td className="py-2 pr-3 text-gray-700">{h.staff}</td><td className="py-2">{h.replacement ? <span className="text-emerald-700 font-medium">{h.replacement}</span> : <span className="text-gray-400">No current-competency alternative</span>}</td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Mandatory clinical/statutory competencies cannot be bypassed by a simple manager override (§12.6). Competency authoring &amp; evidence are owned by the <Link href="/unit-manager/scheduling-engine/competency-matching" className="text-emerald-700 hover:underline">Competency Engine</Link>.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Skill Mix &amp; Supervisor Validation (UMW-WFM-004 §12) reuses the Competency Matching Engine (WSE-001D) over the current roster and computes supervisor coverage from is_supervisor posts. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
