import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadLearningCentre } from "@/lib/operations/learning-centre";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import LearningTabs from "./LearningTabs";

export const dynamic = "force-dynamic";

// Learning Oversight & Development Centre (UMG-005) — the Unit Manager's learning oversight layer.
// Real over the competency spine (competency_decisions → learning compliance, competency gaps that
// drive learning needs, by-role heat map, priority queue) + the learning catalogue (curricula /
// pathways / resources → recommended learning). Honest next-phase: per-staff learning assignment
// tracking, protected-learning-time, IDPs and career-pathway progression — none has a store yet.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (n: number) => (n >= 90 ? "text-emerald-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const cellTone = (n: number) => (n >= 90 ? "bg-emerald-500" : n >= 80 ? "bg-amber-400" : n >= 70 ? "bg-orange-400" : "bg-rose-500");
const todayLabel = () => new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

function Kpi({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href?: string }) {
  const inner = <div className={`${card} p-4 ${href ? "hover:border-emerald-300 transition-colors" : ""}`}><div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div><div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>{sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}</div>;
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function LearningCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadLearningCentre(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Learning Oversight &amp; Development</h1><p className="text-sm text-gray-500">Oversee unit learning, mandatory education and development while keeping competency readiness safe.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <LearningTabs />
    </>
  );
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No competency data yet</p><p className="text-sm text-amber-800 mt-1">Learning oversight activates once competency decisions are recorded for this unit.</p></div></div>;

  const g = d.gaps;
  const L = d.learning ?? { provisioned: false, total: 0 };
  const hasEnrol = L.provisioned && L.total > 0;
  const compliancePct = hasEnrol && L.mandatoryCompliance != null ? L.mandatoryCompliance : d.compliance.pct;
  const mandatoryOverdue = hasEnrol ? L.overdue : g.expired;
  const due30 = hasEnrol ? L.dueSoon : g.expiring;
  return (
    <div className="space-y-4">
      {header}

      {/* KPI cards — real over learning enrolments (LDS-001) when present, competency-proxy otherwise */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Overall Compliance" value={`${compliancePct}%`} tone={pctTone(compliancePct)} sub={hasEnrol ? "mandatory completion" : `${d.compliance.current}/${d.compliance.total} current`} href="/unit-manager/learning/mandatory" />
        <Kpi icon="⛔" tint="bg-rose-50" label="Mandatory Overdue" value={mandatoryOverdue} tone={mandatoryOverdue ? "text-rose-600" : "text-gray-400"} sub={hasEnrol ? "assignments overdue" : "expired competency"} href="/unit-manager/learning/mandatory" />
        <Kpi icon="📅" tint="bg-amber-50" label="Due in 30 Days" value={due30} tone={due30 ? "text-amber-600" : "text-gray-400"} sub={hasEnrol ? "assignments due" : "expiring competency"} href="/unit-manager/learning/mandatory" />
        <Kpi icon="📋" tint="bg-sky-50" label="Active Assignments" value={hasEnrol ? L.active : "—"} tone={hasEnrol ? (L.active ? "text-sky-600" : "text-gray-400") : "text-gray-300"} sub={hasEnrol ? `${L.activeAssignments} assignment rule(s)` : L.provisioned ? "none assigned yet" : "run migration 089"} href="#enrolment" />
        <Kpi icon="✅" tint="bg-teal-50" label="Completion Rate" value={hasEnrol ? `${L.completionRate}%` : "—"} tone={hasEnrol ? pctTone(L.completionRate) : "text-gray-300"} sub={hasEnrol ? `${L.completed}/${L.total - L.exempt} done` : "enrolment tracking"} href="#enrolment" />
        <Kpi icon="📚" tint="bg-violet-50" label="Learning Catalogue" value={d.catalogue.provisioned ? d.catalogue.resources : "—"} sub={d.catalogue.provisioned ? `${d.catalogue.pathways} pathways · ${d.catalogue.curricula} curricula` : "catalogue"} href="/admin/resources" />
      </div>

      {/* Assignment & Enrolment (LDS-001 operational layer) */}
      <div id="enrolment" className={`${card} p-5 scroll-mt-4`}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Assignment &amp; Enrolment <span className="text-[10px] font-normal text-gray-400">LDS-001 operational layer</span></h3><Link href="/admin/curricula" className="text-[11px] text-emerald-600 hover:underline">Assign →</Link></div>
        {!L.provisioned ? (
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-sm text-gray-500">The learning operations store (migration 089) isn&apos;t applied yet.</p><p className="text-[11px] text-gray-400 mt-1">Once applied, active assignments, completion and mandatory-overdue track over real enrolments.</p></div>
        ) : L.total === 0 ? (
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-sm text-gray-500">No learning enrolments yet — assignment tracking activates once learning is assigned.</p><p className="text-[11px] text-gray-400 mt-1">Compliance and overdue above fall back to competency currency until then.</p></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="grid grid-cols-4 gap-2 text-center content-start">
              <div className="rounded-lg bg-emerald-50 py-2"><p className="text-lg font-bold text-emerald-700 tabular-nums">{L.completed}</p><p className="text-[10px] text-emerald-600">Completed</p></div>
              <div className="rounded-lg bg-sky-50 py-2"><p className="text-lg font-bold text-sky-700 tabular-nums">{L.inProgress}</p><p className="text-[10px] text-sky-600">In progress</p></div>
              <div className="rounded-lg bg-gray-50 py-2"><p className="text-lg font-bold text-gray-700 tabular-nums">{L.notStarted}</p><p className="text-[10px] text-gray-500">Not started</p></div>
              <div className="rounded-lg bg-rose-50 py-2"><p className="text-lg font-bold text-rose-700 tabular-nums">{L.overdue}</p><p className="text-[10px] text-rose-600">Overdue</p></div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Overdue mandatory</p>
              {L.overdueList.length === 0 ? <p className="text-sm text-gray-400">No overdue mandatory learning. 🎉</p> : (
                <div className="space-y-1">{L.overdueList.slice(0, 5).map((o: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate"><span className="text-gray-700">{o.name}</span> <span className="text-gray-400">{o.course}</span></span><span className="text-rose-600 shrink-0">{o.due ?? "—"}</span></div>))}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Heat map + priority queue + recommended */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Learning Heat Map <span className="text-[10px] font-normal text-gray-400">competency currency by role</span></h3>
          {d.byRole.length === 0 ? <p className="text-sm text-gray-400">No competency data yet.</p> : (
            <div className="space-y-2">{d.byRole.map((r: any) => (<div key={r.role} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 capitalize truncate">{r.role}</span><span className={`tabular-nums font-semibold ${pctTone(r.pct)}`}>{r.pct}% <span className="text-gray-400 font-normal">({r.gaps} gaps)</span></span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${cellTone(r.pct)}`} style={{ width: `${r.pct}%` }} /></div></div>))}</div>
          )}
        </div>

        <div id="priority" className={`${card} p-5 scroll-mt-4`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Priority Queue</h3><Link href="/admin/curricula" className="text-[11px] text-emerald-600 hover:underline">Assign learning →</Link></div>
          {d.priorityStaff.length === 0 ? <p className="text-sm text-gray-400">No staff with learning gaps. 🎉</p> : (
            <div className="space-y-1.5">{d.priorityStaff.map((s: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 text-xs"><div className="flex items-center gap-2 min-w-0"><span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold shrink-0">{(s.name?.[0] ?? "?").toUpperCase()}</span><div className="min-w-0"><p className="text-gray-800 truncate">{s.name}</p><p className="text-[10px] text-gray-400 capitalize">{s.role}</p></div></div><span className="text-rose-600 font-semibold tabular-nums shrink-0">{s.gaps} gaps</span></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Recommended Learning <span className="text-[10px] font-normal text-gray-400">for gaps</span></h3>
          {d.recommended.length === 0 ? <p className="text-sm text-gray-400">No gap competencies mapped to learning resources.</p> : (
            <div className="space-y-2">{d.recommended.map((r: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 text-xs"><span className="text-gray-700 truncate">{r.competency}</span><span className="text-[10px] text-emerald-700 shrink-0">{r.resources} resource{r.resources === 1 ? "" : "s"}</span></div>))}</div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Gap competencies mapped to learning resources (resource_competencies).</p>
        </div>
      </div>

      {/* Honest next-phase development widgets + activity */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Professional Development</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-2xl mb-1 opacity-40">🚀</p><p className="text-xs text-gray-500">Individual Development Plans, CPD, mentorship and progress reviews need a development-plan store.</p><Link href="/unit-manager/learning/development" className="text-[11px] text-emerald-600 hover:underline mt-1 inline-block">Details →</Link></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Career Progress</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-2xl mb-1 opacity-40">🧗</p><p className="text-xs text-gray-500">Role-progression readiness (competencies + experience + milestones) needs a pathway-progression store.</p><Link href="/unit-manager/learning/pathways" className="text-[11px] text-emerald-600 hover:underline mt-1 inline-block">Details →</Link></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Recent Activity</h3>
          {d.activity.length === 0 ? <p className="text-sm text-gray-400">No recent learning activity.</p> : (
            <div className="divide-y divide-gray-50">{d.activity.slice(0, 8).map((a: any) => (<div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="text-gray-700 truncate">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 shrink-0">{a.actor?.full_name ?? "—"}</span></div>))}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Learning Oversight &amp; Development Centre (UMG-005) over the competency spine (competency_decisions) + learning catalogue (curricula / learning_pathways / learning_resources / resource_competencies). Real: learning compliance, mandatory-overdue &amp; due-30, active assignments and completion over the LDS-001 operational layer (learning_assignments / learning_enrolments, migration 089) — falling back to competency currency where no learning is assigned yet; plus learning gaps + affected staff, the by-role heat map, priority queue and gap-mapped recommended learning (always real). Honest next-phase: protected-learning-time (with safe-staffing validation before approval), individual development plans and career-pathway progression — each needs its store. Content &amp; assignment live in the <Link href="/admin/curricula" className="text-emerald-700 hover:underline">education workspace</Link>. Source: competency + learning services; calculated {todayLabel()}.</p>
    </div>
  );
}
