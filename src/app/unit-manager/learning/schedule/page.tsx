import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEducationPlanning } from "@/lib/operations/education-planning";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import LearningTabs from "../LearningTabs";
import EducationConsole from "./EducationConsole";

export const dynamic = "force-dynamic";

// Education Planning Centre (LDS-005) — the Unit Manager's oversight of formal education plans,
// milestones, study leave and sponsorship over the core stores (migration 090), with a lightweight
// create/manage surface. Real over live data; honest empty state until a plan is created. The fuller
// domain (applications, institutional partnerships, qualification verification, pipeline analytics)
// is next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";
const money = (n: number, cur: string) => `${cur} ${(n / 1_000_000).toFixed(2)}M`;

function Kpi({ icon, tint, label, value, sub, tone }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div><div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>{sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}</div>;
}

export default async function EducationPlanning() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments, staffRes] = await Promise.all([
    loadEducationPlanning(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper),
    admin.from("profiles").select("id, full_name").eq("hospital_id", hid ?? NONE).order("full_name").limit(2000),
  ]);
  const staff = ((staffRes.data ?? []) as any[]).map(s => ({ id: s.id, name: s.full_name ?? "—" }));

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Education Planning</h1><p className="text-sm text-gray-500">Oversee formal education plans, milestones, study leave and sponsorship across the unit.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <LearningTabs />
    </>
  );
  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Education planning store not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 090 (education_plans / milestones / study_leave / sponsorship) to enable this centre.</p></div></div>;

  const k = d.kpis, cur = d.currency;
  const studyPct = k.studyEntitlement ? Math.round((k.studyDaysApproved / k.studyEntitlement) * 100) : 0;

  return (
    <div className="space-y-4">
      {header}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi icon="🎓" tint="bg-violet-50" label="Active Education Plans" value={k.activePlans} sub="in progress" />
        <Kpi icon="📖" tint="bg-[var(--cmp-surface-information)]" label="Programme Progress" value={`${k.avgProgress}%`} sub="avg completion" />
        <Kpi icon="✅" tint="bg-[var(--cmp-surface-success)]" label="Milestones" value={`${k.milestonesCompleted}/${k.milestonesTotal}`} sub="completed" />
        <Kpi icon="💰" tint="bg-[var(--cmp-surface-warning)]" label="Funding Approved" value={money(k.fundingApproved, cur)} sub="total" />
        <Kpi icon="💵" tint="bg-teal-50" label="Funding Utilised" value={money(k.fundingUtilised, cur)} sub={k.fundingApproved ? `${Math.round((k.fundingUtilised / k.fundingApproved) * 100)}% used` : "—"} />
        <Kpi icon="📅" tint="bg-indigo-50" label="Study Leave" value={`${k.studyDaysApproved}/${k.studyEntitlement}`} sub={`${studyPct}% days`} />
        <Kpi icon="⚠️" tint="bg-[var(--cmp-surface-error)]" label="Plans at Risk" value={k.plansAtRisk} tone={k.plansAtRisk ? "text-[var(--cmp-text-error)]" : "text-gray-400"} sub="need attention" />
        <Kpi icon="🕐" tint="bg-[var(--cmp-surface-warning)]" label="Pending Approvals" value={k.pendingApprovals} tone={k.pendingApprovals ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} sub="awaiting" />
      </div>

      {!d.hasData && <div className="bg-white border border-dashed border-gray-200 rounded-xl p-4 text-center text-sm text-gray-500">No education plans yet — create one below to start tracking programmes, milestones, study leave and sponsorship.</div>}

      {/* Funding + study leave + risk */}
      {d.hasData && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className={`${card} p-5`}>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Funding Overview</h3>
            {d.fundingBySource.length === 0 ? <p className="text-sm text-gray-400">No approved funding yet.</p> : (
              <div className="space-y-2">{d.fundingBySource.map((s: any) => (<div key={s.source} className="flex items-center justify-between text-xs"><span className="text-gray-700 capitalize">{s.source}</span><b className="tabular-nums">{money(s.amount, cur)}</b></div>))}<div className="border-t border-gray-100 pt-2 flex items-center justify-between text-xs"><span className="text-gray-500">Utilised</span><b className="tabular-nums text-teal-700">{money(k.fundingUtilised, cur)}</b></div></div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Study Leave Overview</h3>
            {d.leaveByType.length === 0 ? <p className="text-sm text-gray-400">No approved study leave yet.</p> : (
              <div className="space-y-2">{d.leaveByType.map((l: any) => (<div key={l.type} className="flex items-center justify-between text-xs"><span className="text-gray-700 capitalize">{l.type}</span><b className="tabular-nums">{l.days} days</b></div>))}<div className="border-t border-gray-100 pt-2 flex items-center justify-between text-xs"><span className="text-gray-500">Used / entitlement</span><b className="tabular-nums">{k.studyDaysApproved}/{k.studyEntitlement}</b></div></div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Education Plan Risk</h3>
            {d.risks.length === 0 ? <p className="text-sm text-gray-400">No education risks. 🎉</p> : (
              <div className="space-y-2">{d.risks.map((r: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${r.severity === "high" ? "bg-[var(--cmp-color-error)]" : "bg-[var(--cmp-color-warning)]"}`} /><div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{r.label}</p><p className="text-[11px] text-gray-500 truncate">{r.detail}</p></div></div>))}</div>
            )}
          </div>
        </div>
      )}

      {/* Upcoming milestones */}
      {d.hasData && d.upcoming.length > 0 && (
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Upcoming Academic Activities</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{d.upcoming.map((u: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs"><span className="text-gray-700 truncate">{u.name}</span><span className="text-gray-400 shrink-0 tabular-nums">{u.date ?? "—"}</span></div>))}</div>
        </div>
      )}

      {/* Create + manage */}
      <EducationConsole staff={staff} plans={d.plansList} pending={d.pendingList} />

      <p className="text-[11px] text-gray-400 pb-4">Education Planning Centre (LDS-005) over the core education stores (education_plans / education_milestones / study_leave_requests / sponsorship_requests, migration 090). Real: active plans, programme progress, milestones, funding approved / utilised, study leave (default {k.studyEntitlement}-day entitlement), plans-at-risk (overdue milestones), pending approvals and the create/manage surface. Sponsorship approval is separate from disbursement (§9); every decision is audited. Honest next-phase: programme applications, institutional partnerships, qualification verification and the fuller pipeline analytics. Each learner&apos;s own plan is in their <Link href="/dashboard/career" className="text-emerald-700 hover:underline">Career Growth</Link> page.</p>
    </div>
  );
}
